import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createTcpServer, createConnection } from 'node:net';
import { PINS, validateInvocation, localEnvironment, dockerPolicyArguments, validateNetwork,
  validateContainers, firewallPlan, stackConfig, readPinnedInputs, parseLocalStatus,
  runLocalStackCheck, cleanupInterruptedRun, sanitizedFailureDiagnostic, startupContainerStates,
  validatedProxyTarget, OwnedLoopbackProxy, DockerStackRuntime,
  integrationRequestDiagnostic, integrationFailureDiagnostic } from './local-stack-check.mjs';

const nonce = '123456abcdef';
const network = 'genie-local-' + nonce;
const projectId = 'genie_it_' + nonce;
const workspace = '/tmp/genie-local-stack-work-fixture';
const networkId = 'a'.repeat(64);
const identity = { projectId, nonce, network, networkId, workspace };
const approved = () => ({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux',
  GITHUB_REPOSITORY: 'jmpark0611-art/bestchoice', GITHUB_REF: 'refs/heads/codex/genie-android-native-check-20261123',
  GENIE_PUBLIC_REPOSITORY: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: '/tmp' });
const jwt = role => 'e30.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.fixture';
const sha = text => createHash('sha256').update(text).digest('hex');
const makeNetwork = () => ({ Id: 'a'.repeat(64), Name: network, Driver: 'bridge', Internal: true, EnableIPv6: false,
  Attachable: false, Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' },
  IPAM: { Config: [{ Subnet: PINS.networkCidr, Gateway: PINS.gateway }] } });
function makeContainers(edge = false) {
  const images = { db: 'postgres:17.12.0.000', auth: 'gotrue:v2.198.0', rest: 'postgrest:v16.5', kong: 'kong:2.8.1', edge_runtime: 'edge-runtime:v1.79.1' };
  return Object.entries(images).filter(([name]) => edge || name !== 'edge_runtime').map(([name, image], i) => ({
    Id: String(i + 1).repeat(64), Name: `/supabase_${name}_${projectId}`, State: { Running: true },
    Config: { Image: 'public.ecr.aws/supabase/' + image,
      Labels: { 'com.supabase.cli.project': projectId, 'genie.local.integration': nonce }, Env: ['LOCAL_TEST=true'] },
    HostConfig: { NetworkMode: network, Privileged: false, Dns: ['127.0.0.1'], PidMode: '', IpcMode: 'private' },
    NetworkSettings: { Networks: { [network]: { Aliases: [name], NetworkID: networkId,
      IPAddress: '172.30.240.' + (i + 2), IPPrefixLen: 24, GlobalIPv6Address: '' } }, Ports: {} },
    Mounts: [{ Type: 'bind', Source: workspace + '/supabase/config.toml', Destination: '/test/config.toml' }],
  }));
}
const proxyProof = () => [
  { service: 'db', host: '127.0.0.1', port: 55322, listening: true, forwardedConnections: 1,
    target: { containerId: '1'.repeat(64), ip: '172.30.240.2', port: 5432 } },
  { service: 'kong', host: '127.0.0.1', port: 55321, listening: true, forwardedConnections: 1,
    target: { containerId: '4'.repeat(64), ip: '172.30.240.5', port: 8000 } },
];

test('invocation accepts only the explicitly approved public hosted Linux build branch', () => {
  assert.doesNotThrow(() => validateInvocation(approved(), true, 'linux', 'x64'));
  for (const [key, value] of [['GITHUB_REF', 'refs/heads/main'], ['GENIE_PUBLIC_REPOSITORY', 'false'],
    ['RUNNER_ENVIRONMENT', 'self-hosted'], ['GITHUB_REPOSITORY', 'another/repo'], ['GITHUB_RUN_ID', '../1']]) {
    assert.throws(() => validateInvocation({ ...approved(), [key]: value }, true, 'linux', 'x64'));
  }
  assert.throws(() => validateInvocation(approved(), false, 'linux', 'x64'), /OPT_IN/);
  assert.throws(() => validateInvocation(approved(), true, 'darwin', 'arm64'), /LINUX_AMD64/);
  for (const key of ['OPENAI_API_KEY', 'VITE_SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN', 'GENIE_ANDROID_KEYSTORE_PASSWORD', 'DOCKER_HOST']) {
    assert.throws(() => validateInvocation({ ...approved(), [key]: 'never-print-this' }, true, 'linux', 'x64'), /REMOVE_HOSTED/);
  }
});

test('child environment drops ambient tokens, project identifiers and unrelated runner values', () => {
  const env = localEnvironment({ PATH: '/usr/bin', HOME: '/home/runner', GITHUB_TOKEN: 'secret',
    SUPABASE_ACCESS_TOKEN: 'secret', OPENAI_API_KEY: 'secret', GENIE_ANDROID_KEY_ALIAS: 'private' }, workspace);
  assert.equal(env.HOME, '/home/runner');
  assert.equal(env.SUPABASE_HOME, workspace + '/cli-home');
  assert.equal(env.SUPABASE_INTERNAL_IMAGE_REGISTRY, 'public.ecr.aws');
  assert.equal(JSON.stringify(env).includes('secret'), false);
  assert.equal(env.GITHUB_TOKEN, undefined);
});

test('startup diagnostics keep useful error names but redact credentials and never expose status or inspection bodies', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.signature';
  const result = { status: 1, stdout: 'never-print-any-stdout', stderr: [
    'Error: unknown flag: --example',
    'Error: ' + token + ' sb_secret_fakecredential postgres://user:private@db:5432/database',
    'Failed: known-local-credential PASSWORD="private-value"',
    '{"ANON_KEY":"private-body"}',
  ].join('\n') };
  const diagnostic = sanitizedFailureDiagnostic('LOCAL_CORE_START_FAILED', result, ['known-local-credential']);
  const text = JSON.stringify(diagnostic);
  assert.match(text, /unknown flag: --example/);
  for (const secret of [token, 'fakecredential', 'private@', 'private-value', 'known-local-credential', 'private-body', 'stdout']) {
    assert.equal(text.includes(secret), false);
  }
  assert.equal(sanitizedFailureDiagnostic('LOCAL_STATUS_FAILED', result), null);
  assert.equal(sanitizedFailureDiagnostic('DOCKER_OPERATION_FAILED', result), null);
  assert.equal(diagnostic.exitCode, 1);
});

test('structured pinned-CLI health failure exposes only redacted code/message, never success credentials or error context', () => {
  const result = { status: 1, stderr: 'ordinary progress only', stdout: [
    JSON.stringify({ API_URL: 'http://127.0.0.1:55321', ANON_KEY: 'private-status-key' }),
    JSON.stringify({ _tag: 'Error', error: { code: 'HealthCheckTimeoutError',
      message: 'supabase_rest_genie_it_test unexpected status 503\nsupabase_auth_genie_it_test postgres://user:private@db:5432/database',
      detail: 'private-detail', suggestion: 'private-suggestion' }, environment: { PRIVATE: 'private-context' } }),
  ].join('\n') };
  const diagnostic = sanitizedFailureDiagnostic('LOCAL_CORE_START_FAILED', result);
  assert.match(diagnostic.lines[0], /HealthCheckTimeoutError: supabase_rest_genie_it_test unexpected status 503/);
  assert.equal(diagnostic.lines.length, 2);
  assert.equal(JSON.stringify(diagnostic).includes('private'), false);
  assert.equal(sanitizedFailureDiagnostic('LOCAL_STATUS_FAILED', result), null);
  assert.deepEqual(sanitizedFailureDiagnostic('LOCAL_CORE_START_FAILED', { status: 1, stdout: JSON.stringify({
    error: { code: 'HealthCheckTimeoutError', message: 'untagged-private-message' } }), stderr: '' }).lines, []);
});

test('pinned image download diagnostics distinguish registry failures without exposing credentials or inspection stdout', () => {
  const result = { status: 1, stdout: '{"Config":{"Env":["SECRET=private"]}}', stderr: [
    'Error response from daemon: denied: access forbidden',
    'toomanyrequests: retry later',
    'Get "https://registry.invalid/v2/?token=private-value": net/http: TLS handshake timeout',
    'unauthorized: authentication required',
  ].join('\n') };
  const diagnostic = sanitizedFailureDiagnostic('PINNED_IMAGE_PULL_FAILED', result);
  assert.equal(diagnostic.lines.length, 4);
  assert.match(diagnostic.lines[0], /denied/);
  assert.match(diagnostic.lines[1], /toomanyrequests/);
  assert.equal(JSON.stringify(diagnostic).includes('private'), false);
  assert.equal(JSON.stringify(diagnostic).includes('Config'), false);
  assert.equal(diagnostic.category, 'RATE_LIMIT');
  assert.equal(diagnostic.httpStatus, null);
  const rateLimit = sanitizedFailureDiagnostic('PINNED_IMAGE_PULL_FAILED', { status: 1,
    stderr: 'Error response from daemon: unexpected HTTP status 429' });
  assert.equal(rateLimit.category, 'RATE_LIMIT');
  assert.equal(rateLimit.httpStatus, 429);
  assert.deepEqual(sanitizedFailureDiagnostic('PINNED_IMAGE_INSPECTION_FAILED', { status: 1,
    stdout: result.stdout, stderr: 'Error: No such image: pinned-example' }).lines, ['Error: No such image: pinned-example']);
  assert.equal(sanitizedFailureDiagnostic('DOCKER_OPERATION_FAILED', result), null);
});

test('startup state projection keeps owned service health and fixed error names without inspect secrets or output', () => {
  const values = makeContainers();
  values[0].State = { Running: true, Status: 'running', ExitCode: 0, OOMKilled: false,
    Error: 'postgres://user:private@db', Health: { Status: 'unhealthy', Log: [{ ExitCode: 1,
      Output: 'connection refused at postgres://user:private@db, Authorization: secret' }] } };
  values[0].Config.Env.push('SECRET_KEY=private');
  values.push({ Name: '/unrelated', Config: { Labels: { 'com.supabase.cli.project': 'other' } }, State: { Error: 'private' } });
  const snapshot = startupContainerStates(values, projectId, nonce);
  assert.equal(snapshot.length, 4);
  assert.equal(snapshot[0].health, 'unhealthy');
  assert.equal(snapshot[0].wrapperLabelPresent, true);
  assert.deepEqual(snapshot[0].recentHealth, [{ exitCode: 1, errorName: 'CONNECTION_REFUSED' }]);
  const text = JSON.stringify(snapshot);
  for (const secret of ['private', 'Authorization', 'SECRET_KEY', 'Mounts', 'Output', 'Env']) assert.equal(text.includes(secret), false);
});

test('CLI-scoped Docker policy pins every created container DNS and network without rewriting commands', () => {
  const args = ['create', '--name', 'fixture', '--network', network, '--network-alias', 'kong', 'image'];
  const guarded = dockerPolicyArguments(args, network, nonce);
  assert.deepEqual(guarded.slice(0, 5), ['create', '--dns', '127.0.0.1', '--label', 'genie.local.integration=' + nonce]);
  assert.deepEqual(guarded.slice(5), args.slice(1));
  assert.deepEqual(dockerPolicyArguments(['inspect', 'fixture'], network, nonce), ['inspect', 'fixture']);
  assert.equal(dockerPolicyArguments(['container', 'run', '--network', network, 'image'], network, nonce)[2], '--dns');
  for (const args of [['run', '--network', 'host', 'image'], ['run', '--network', network, '--privileged', 'image'],
    ['run', '--network', network, '--dns', '8.8.8.8', 'image'], ['run', '--network=' + network, 'image'],
    ['run', '--network', network, '--network', 'bridge', 'image'], ['pull', 'image'], ['image', 'pull', 'image'], ['system', 'prune']]) {
    assert.throws(() => dockerPolicyArguments(args, network, nonce));
  }
});

test('network inspection rejects a merely named network without internal, IPv4 and loopback controls', () => {
  assert.equal(validateNetwork(makeNetwork(), network).bridge, 'br-' + 'a'.repeat(12));
  for (const mutate of [v => { v.Internal = false; }, v => { v.EnableIPv6 = true; },
    v => { v.IPAM.Config[0].Subnet = '172.17.0.0/16'; }, v => { v.Options = {}; }]) {
    const v = makeNetwork(); mutate(v); assert.throws(() => validateNetwork(v, network), /ISOLATION_UNCONFIRMED/);
  }
});

test('container inspection requires exact services, loopback publication, isolated DNS and local-only mounts', () => {
  assert.equal(Object.keys(validateContainers(makeContainers(), { ...identity, loopbackProxies: proxyProof() })).length, 4);
  assert.equal(Object.keys(validateContainers(makeContainers(true), { ...identity, edge: true, loopbackProxies: proxyProof() })).length, 5);
  for (const mutate of [v => { v[0].HostConfig.Dns = ['8.8.8.8']; }, v => { v[0].HostConfig.Privileged = true; },
    v => { v[0].NetworkSettings.Networks.other = {}; }, v => { v[0].Mounts[0].Source = '/var/run/docker.sock'; },
    v => { v[0].Mounts[0].Source = '/home/runner/.env'; }, v => { v[0].Config.Env.push('OPENAI_API_KEY=never-print'); },
    v => { v[3].NetworkSettings.Ports['8000/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '55321' }]; }, v => { v.pop(); }]) {
    const values = makeContainers(); mutate(values);
    assert.throws(() => validateContainers(values, { ...identity, loopbackProxies: proxyProof() }));
  }
});

test('internal Docker port intent cannot substitute for a verified, working owned loopback listener', () => {
  const containers = makeContainers();
  containers[3].NetworkSettings.Ports['8000/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '55321' }];
  assert.throws(() => validateContainers(containers, identity), /APPROVED_LISTENER_UNCONFIRMED/);
  for (const mutate of [proof => { proof[0].listening = false; }, proof => { proof[1].host = '0.0.0.0'; },
    proof => { proof[0].target.ip = '172.30.240.200'; }, proof => { proof[1].forwardedConnections = 0; }]) {
    const proof = proxyProof(); mutate(proof);
    assert.throws(() => validateContainers(containers, { ...identity, loopbackProxies: proof }), /APPROVED_LISTENER_UNCONFIRMED/);
  }
});

test('loopback targets require exact run, service, image and single internal IPv4 network identity', () => {
  assert.deepEqual(validatedProxyTarget(makeContainers()[0], 'db', identity), proxyProof()[0].target);
  assert.deepEqual(validatedProxyTarget(makeContainers()[3], 'kong', identity), proxyProof()[1].target);
  assert.throws(() => validatedProxyTarget(makeContainers()[1], 'auth', identity), /UNAPPROVED_LOOPBACK_SERVICE/);
  for (const mutate of [v => { v.Config.Labels['genie.local.integration'] = 'other'; },
    v => { v.Config.Labels['com.supabase.cli.project'] = 'other'; }, v => { v.Config.Image = 'untrusted/image'; },
    v => { v.State.Running = false; }, v => { v.HostConfig.Dns = ['8.8.8.8']; },
    v => { v.NetworkSettings.Networks.other = {}; }, v => { v.NetworkSettings.Networks[network].NetworkID = 'b'.repeat(64); },
    v => { v.NetworkSettings.Networks[network].IPAddress = '127.0.0.1'; },
    v => { v.NetworkSettings.Networks[network].IPAddress = '172.30.240.1'; },
    v => { v.NetworkSettings.Networks[network].IPAddress = '172.30.240.255'; },
    v => { v.NetworkSettings.Networks[network].IPPrefixLen = 16; }]) {
    const item = makeContainers()[0]; mutate(item);
    assert.throws(() => validatedProxyTarget(item, 'db', identity));
  }
});

const listenLocal = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
});
const stopLocal = server => new Promise(resolve => server.close(() => resolve()));

test('owned loopback proxy rejects an unverified target, forwards actual TCP bytes only after approval, and closes its sockets', { timeout: 5000 }, async () => {
  const backendSockets = new Set();
  const backend = createTcpServer(socket => {
    backendSockets.add(socket); socket.on('close', () => backendSockets.delete(socket));
    socket.on('data', data => socket.write(data));
  });
  await listenLocal(backend);
  let dialCount = 0, client;
  const proxy = new OwnedLoopbackProxy('db', identity, { connect: options => {
    assert.deepEqual(options, { host: '172.30.240.2', port: 5432, family: 4 }); dialCount++;
    // Test transport is an owned random loopback echo endpoint, never a real DB.
    return createConnection({ host: '127.0.0.1', port: backend.address().port });
  } });
  try {
    await proxy.start();
    const denied = createConnection({ host: '127.0.0.1', port: 55322 }); denied.on('error', () => {});
    await new Promise(resolve => denied.once('close', resolve));
    assert.equal(dialCount, 0);
    proxy.setTarget(makeContainers()[0]);
    client = createConnection({ host: '127.0.0.1', port: 55322 }); client.on('error', () => {});
    const reply = new Promise((resolve, reject) => { client.once('data', data => resolve(data.toString())); client.once('error', reject); });
    client.write('synthetic-proxy-check');
    assert.equal(await reply, 'synthetic-proxy-check');
    assert.equal(proxy.proof().forwardedConnections, 1);
    proxy.clearTarget();
    const revoked = createConnection({ host: '127.0.0.1', port: 55322 }); revoked.on('error', () => {});
    await new Promise(resolve => revoked.once('close', resolve));
    assert.equal(dialCount, 1); assert.equal(proxy.proof().target, null);
    proxy.setTarget(makeContainers()[0]);
    const changed = makeContainers()[0]; changed.Id = 'b'.repeat(64);
    assert.throws(() => proxy.setTarget(changed), /LOOPBACK_TARGET_CHANGED/);
    const ended = new Promise(resolve => client.once('close', resolve));
    assert.equal(await proxy.close(), true); await ended;
    assert.equal(proxy.proof().listening, false); assert.equal(await proxy.close(), true);
    assert.throws(() => proxy.setTarget(makeContainers()[0]), /LOOPBACK_PROXY_UNAVAILABLE/);
  } finally {
    client?.destroy(); await proxy.close();
    for (const socket of backendSockets) socket.destroy(); await stopLocal(backend);
  }
});

test('owned loopback proxy fails on an occupied port without closing or replacing that listener', { timeout: 5000 }, async () => {
  const blocker = createTcpServer(socket => socket.end('existing-owner'));
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(55322, '127.0.0.1', resolve); });
  const proxy = new OwnedLoopbackProxy('db', identity);
  try {
    await assert.rejects(proxy.start(), /APPROVED_LOOPBACK_PORT_UNAVAILABLE/);
    assert.equal(await proxy.close(), true); assert.equal(blocker.listening, true);
    const client = createConnection({ host: '127.0.0.1', port: 55322 });
    assert.equal(await new Promise((resolve, reject) => { client.once('data', data => resolve(data.toString())); client.once('error', reject); }), 'existing-owner');
    client.destroy();
  } finally { await proxy.close(); await stopLocal(blocker); }
});

test('startup inspection revokes previous proxy targets on missing, malformed or failed evidence', async () => {
  const runtime = new DockerStackRuntime({ repoRoot: workspace, env: approved() });
  runtime.state = { ...runtime.state, ...identity, networkName: network };
  runtime.proxies = ['db', 'kong'].map(service => new OwnedLoopbackProxy(service, identity));
  const valid = () => {
    runtime.docker = async () => ({ stdout: makeContainers().map(item => item.Id).join('\n') });
    runtime.inspect = async () => makeContainers();
  };
  try {
    for (const breakInspection of [
      () => { runtime.docker = async () => ({ stdout: '' }); },
      () => { runtime.docker = async () => ({ stdout: 'invalid-container-id' }); },
      () => { runtime.docker = async () => { throw new Error('DOCKER_OPERATION_FAILED'); }; },
      () => { runtime.inspect = async () => { throw new Error('DOCKER_INSPECTION_INVALID'); }; },
      () => { runtime.inspect = async () => ({}); },
      () => { runtime.inspect = async () => []; },
    ]) {
      valid(); await runtime.captureStartupStates();
      assert.ok(runtime.proxies.every(proxy => proxy.proof().target));
      breakInspection(); await runtime.captureStartupStates();
      assert.ok(runtime.proxies.every(proxy => proxy.proof().target === null));
    }
    valid(); await runtime.captureStartupStates();
    const wrongRun = makeContainers(); wrongRun[3].Config.Labels['genie.local.integration'] = 'other';
    runtime.inspect = async () => wrongRun;
    await assert.rejects(runtime.captureStartupStates(), /STACK_CONTAINER_IDENTITY_UNCONFIRMED/);
    assert.ok(runtime.proxies.every(proxy => proxy.proof().target === null));
  } finally { await Promise.all(runtime.proxies.map(proxy => proxy.close())); }
});

test('core API readiness explicitly reads only the owned loopback health route before synthetic sessions', async () => {
  const calls = []; let status = 200;
  const runtime = new DockerStackRuntime({ repoRoot: workspace, env: approved(), send: async (url, options) => {
    calls.push({ url, options }); return new Response('', { status });
  } });
  runtime.keys = { anon: jwt('anon') };
  runtime.proxies = [{ service: 'kong', proof: () => proxyProof()[1] }];
  await runtime.verifyLoopbackApi();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'http://127.0.0.1:55321/auth/v1/health');
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(calls[0].options.headers, { apikey: jwt('anon') });
  assert.ok(calls[0].options.signal instanceof AbortSignal); assert.equal(calls[0].options.body, undefined);
  for (status of [201, 302, 503]) await assert.rejects(runtime.verifyLoopbackApi(), /LOCAL_CORE_API_READINESS_UNCONFIRMED/);
  runtime.send = async () => { throw new Error('untrusted connection failure'); };
  await assert.rejects(runtime.verifyLoopbackApi(), /LOCAL_CORE_API_READINESS_UNCONFIRMED/);
  runtime.proxies[0].proof = () => ({ ...proxyProof()[1], target: null });
  runtime.send = async () => assert.fail('an unverified target must not receive a request');
  await assert.rejects(runtime.verifyLoopbackApi(), /APPROVED_LISTENER_UNCONFIRMED/);
});

test('integration diagnostics allow only fixed verifier assertions and bounded route templates without private content', () => {
  const request = integrationRequestDiagnostic('http://127.0.0.1:55321/rest/v1/vs_polls?select=id,did&id=eq.private-poll-id',
    { method: 'GET', body: 'private-body', headers: { Authorization: 'private-token' } });
  assert.deepEqual(request, { method: 'GET', route: '/rest/v1/vs_polls', status: null });
  for (const url of ['https://hosted.invalid/rest/v1/vs_polls', 'http://private-user@127.0.0.1:55321/rest/v1/vs_polls',
    'http://127.0.0.1:55321/auth/v1/admin/users', 'http://127.0.0.1:55321/rest/v1/vs_polls#private']) {
    assert.throws(() => integrationRequestDiagnostic(url, { method: 'GET' }), /LOCAL_INTEGRATION_REQUEST_UNEXPECTED/);
  }
  const requests = Array.from({ length: 20 }, (_, i) => ({ ...request, number: i + 1, status: 200,
    body: 'private-body', token: 'private-token', userId: 'private-user-id' }));
  const diagnostic = integrationFailureDiagnostic(new Error('Foreign share RPC allowed'), requests, 20);
  assert.equal(diagnostic.assertion, 'SHARE_RPC_DENIAL_FAILED');
  assert.equal(diagnostic.requestCount, 20); assert.equal(diagnostic.requests.length, 12);
  assert.equal(diagnostic.requests[0].number, 9);
  assert.equal(JSON.stringify(diagnostic).includes('private'), false);
  const http = integrationFailureDiagnostic(new Error('Deterministic local Edge HTTP 502'));
  assert.equal(http.assertion, 'EDGE_HTTP_FAILED'); assert.equal(http.httpStatus, 502);
  for (const message of ['private-token private-user-id', 'Deterministic local Edge HTTP 502 private-body']) {
    const unknown = integrationFailureDiagnostic(new Error(message));
    assert.equal(unknown.assertion, 'UNKNOWN_VERIFIER_FAILURE');
    assert.equal(JSON.stringify(unknown).includes('private'), false);
  }
});

test('integration harness preserves actual failed route and HTTP status without printing response bodies or tokens', async () => {
  let count = 0;
  const runtime = new DockerStackRuntime({ repoRoot: workspace, env: approved(), send: async () => {
    count++;
    if (count <= 2) return Response.json({ user: { id: 'private-user-' + count, is_anonymous: true },
      access_token: 'private-token-' + count });
    return Response.json({ error: 'private-backend-body' }, { status: 502 });
  } });
  runtime.edgeVerified = true; runtime.keys = { anon: jwt('anon') };
  await assert.rejects(runtime.verifyIntegration(), /LOCAL_INTEGRATION_FAILED/);
  assert.equal(count, 3);
  assert.deepEqual(runtime.diagnostics, [{ stage: 'LOCAL_INTEGRATION_FAILED', assertion: 'EDGE_HTTP_FAILED', httpStatus: 502,
    requestCount: 3, requests: [
      { number: 1, method: 'POST', route: '/auth/v1/signup', status: 200 },
      { number: 2, method: 'POST', route: '/auth/v1/signup', status: 200 },
      { number: 3, method: 'POST', route: '/functions/v1/vs-decide', status: 502 },
    ] }]);
  assert.equal(JSON.stringify(runtime.diagnostics).includes('private'), false);
  assert.equal(JSON.stringify(runtime.diagnostics).includes(jwt('anon')), false);
  runtime.diagnostics = []; runtime.send = async () => { throw new Error('private-transport-error'); };
  await assert.rejects(runtime.verifyIntegration(), /LOCAL_INTEGRATION_FAILED/);
  assert.equal(runtime.diagnostics[0].assertion, 'TRANSPORT_FAILED');
  assert.deepEqual(runtime.diagnostics[0].requests, [{ number: 1, method: 'POST', route: '/auth/v1/signup',
    status: null, transportFailed: true }]);
  assert.equal(JSON.stringify(runtime.diagnostics).includes('private'), false);
});

test('firewall plan touches only this bridge and CIDR and records exact inverse operations', () => {
  const plan = firewallPlan(validateNetwork(makeNetwork(), network), nonce);
  assert.equal(plan.entries.length, 9);
  const jumps = plan.entries.filter(entry => entry.add[0] === '-I');
  assert.deepEqual(jumps.map(entry => entry.add[1]), ['INPUT', 'DOCKER-USER']);
  for (const entry of jumps) {
    assert.ok(entry.add.includes('br-' + 'a'.repeat(12)));
    assert.ok(entry.add.includes(PINS.networkCidr));
    assert.equal(entry.remove[0], '-D');
  }
  assert.equal(plan.entries.some(entry => entry.add.includes('-F') || entry.add.includes('-P')), false);
  assert.throws(() => firewallPlan({ bridge: 'eth0', cidr: '0.0.0.0/0' }, nonce), /UNSAFE_FIREWALL/);
});

test('fresh configuration disables irrelevant services and releases fixture only behind NETGUARD', () => {
  const core = stackConfig(projectId), edge = stackConfig(projectId, true);
  assert.match(core, /port = 55321/); assert.match(core, /enable_anonymous_sign_ins = true/);
  assert.match(core, /\[edge_runtime\]\nenabled = false/);
  assert.equal(core.includes('[functions.vs-decide]'), false);
  assert.match(edge, /GENIE_EDGE_NETGUARD = "env\(GENIE_EDGE_NETGUARD\)"/);
  assert.match(edge, /GENIE_EDGE_WRITER_JWT = "env\(GENIE_EDGE_WRITER_JWT\)"/);
  assert.match(edge, /\[functions.vs-decide\]\nverify_jwt = true/);
  assert.equal(edge.includes('supabase.co'), false);
  assert.throws(() => stackConfig('production'), /INVALID_PROJECT_ID/);
});

test('status requires exact approved loopback origin and distinct local role JWTs', () => {
  const value = { API_URL: 'http://127.0.0.1:55321', ANON_KEY: jwt('anon'), SERVICE_ROLE_KEY: jwt('service_role') };
  assert.deepEqual(parseLocalStatus(value), { anon: value.ANON_KEY, writer: value.SERVICE_ROLE_KEY });
  for (const bad of [{ ...value, API_URL: 'https://example.supabase.co' }, { ...value, SERVICE_ROLE_KEY: value.ANON_KEY },
    { ...value, ANON_KEY: 'sb_publishable_example' }]) assert.throws(() => parseLocalStatus(bad), /IDENTITY_UNCONFIRMED/);
});

test('canonical source is required and a drifted SQL file is never silently copied', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'genie-stack-input-test-'));
  try {
    assert.throws(() => readPinnedInputs(repo), /CANONICAL_SCHEMA_REQUIRED/);
    mkdirSync(path.dirname(path.join(repo, PINS.schemaPath)), { recursive: true });
    writeFileSync(path.join(repo, PINS.schemaPath), 'select 1;');
    assert.throws(() => readPinnedInputs(repo), /CANONICAL_SCHEMA_REQUIRED/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('restored fixture provenance and copied byte hashes are accurate', () => {
  const fixtureRoot = fileURLToPath(new URL('../qa/local-stack-fixture/', import.meta.url));
  const manifest = JSON.parse(readFileSync(path.join(fixtureRoot, 'manifest.json')));
  assert.equal(manifest.sourceArchiveSha256, '2b48c6b2aa5620ed92a53eaa531bde0d194c9237a8d3406e7dd991cd235a3a62');
  assert.equal(manifest.canonicalSchemaSha256, PINS.schemaSha256);
  for (const [file, expected] of Object.entries(manifest.files)) assert.equal(sha(readFileSync(path.join(fixtureRoot, file))), expected);
  const fixture = readFileSync(path.join(fixtureRoot, 'vs-decide/fixture.mjs'), 'utf8');
  assert.match(fixture, /GENIE_EDGE_NETGUARD/);
  assert.equal(fixture.includes('openai.com'), false);
});

const stages = ['preflight', 'prepare', 'isolate', 'startCore', 'verifyCore', 'installFixture', 'startEdge', 'verifyEdge', 'verifyIntegration'];
function fakeRuntime(failAt, cleanup = true) {
  const calls = [];
  const runtime = Object.fromEntries(stages.map(stage => [stage, async () => {
    calls.push(stage); if (stage === failAt) throw new Error('KNOWN_STAGE_FAILURE');
  }]));
  runtime.cleanup = async () => { calls.push('cleanup'); return cleanup; };
  runtime.receipt = () => { calls.push('receipt'); return { status: 'fake-test-only' }; };
  return { runtime, calls };
}

test('orchestration verifies isolation before fixture and real users, then cleans before issuing receipt', async () => {
  const { runtime, calls } = fakeRuntime();
  const result = await runLocalStackCheck({ env: approved(), allowDownloads: true, runtime });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [...stages, 'cleanup', 'receipt']);
});

test('every incomplete stage always cleans and never advances or emits a PASS receipt', async () => {
  for (let i = 0; i < stages.length; i++) {
    const { runtime, calls } = fakeRuntime(stages[i]);
    const result = await runLocalStackCheck({ env: approved(), allowDownloads: true, runtime });
    assert.deepEqual(result, { ok: false, code: 'KNOWN_STAGE_FAILURE' });
    assert.deepEqual(calls, [...stages.slice(0, i + 1), 'cleanup']);
  }
});

test('unconfirmed cleanup overrides success and unexpected error messages never expose payloads', async () => {
  const failedCleanup = fakeRuntime(undefined, false);
  assert.deepEqual(await runLocalStackCheck({ env: approved(), allowDownloads: true, runtime: failedCleanup.runtime }),
    { ok: false, code: 'DISPOSABLE_CLEANUP_UNCONFIRMED', cause: null });
  assert.equal(failedCleanup.calls.includes('receipt'), false);
  const unknownError = fakeRuntime();
  unknownError.runtime.startCore = async () => { throw new Error('Authorization: Bearer secret@example.com'); };
  const result = await runLocalStackCheck({ env: approved(), allowDownloads: true, runtime: unknownError.runtime });
  assert.deepEqual(result, { ok: false, code: 'LOCAL_STACK_CHECK_INCOMPLETE' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('invocation rejection performs no Docker, download or cleanup operation', async () => {
  const { runtime, calls } = fakeRuntime();
  const result = await runLocalStackCheck({ env: approved(), runtime });
  assert.equal(result.ok, false); assert.deepEqual(calls, []);
});

test('recovery rejects an unrelated workspace before touching Docker or firewall', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'genie-stack-recovery-test-'));
  try {
    const env = { ...approved(), RUNNER_TEMP: dir };
    assert.equal(await cleanupInterruptedRun(env), true);
    writeFileSync(path.join(dir, 'genie-local-stack-123-1.json'), JSON.stringify({ schemaVersion: 1, nonce,
      projectId, networkName: network, probeName: network + '-probe', runId: '123', runAttempt: '1',
      workspace: '/home/runner', networks: [] }));
    await assert.rejects(cleanupInterruptedRun(env), /UNSAFE_CLEANUP_STATE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
