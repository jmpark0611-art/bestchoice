import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS, validateInvocation, localEnvironment, dockerPolicyArguments, validateNetwork,
  validateContainers, firewallPlan, stackConfig, readPinnedInputs, parseLocalStatus,
  runLocalStackCheck, cleanupInterruptedRun, sanitizedFailureDiagnostic } from './local-stack-check.mjs';

const nonce = '123456abcdef';
const network = 'genie-local-' + nonce;
const projectId = 'genie_it_' + nonce;
const workspace = '/tmp/genie-local-stack-work-fixture';
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
    NetworkSettings: { Networks: { [network]: { Aliases: [name] } },
      Ports: name === 'kong' ? { '8000/tcp': [{ HostIp: '127.0.0.1', HostPort: '55321' }] } : {} },
    Mounts: [{ Type: 'bind', Source: workspace + '/supabase/config.toml', Destination: '/test/config.toml' }],
  }));
}

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
  assert.equal(Object.keys(validateContainers(makeContainers(), { projectId, nonce, network, workspace })).length, 4);
  assert.equal(Object.keys(validateContainers(makeContainers(true), { projectId, nonce, network, workspace, edge: true })).length, 5);
  for (const mutate of [v => { v[0].HostConfig.Dns = ['8.8.8.8']; }, v => { v[0].HostConfig.Privileged = true; },
    v => { v[0].NetworkSettings.Networks.other = {}; }, v => { v[0].Mounts[0].Source = '/var/run/docker.sock'; },
    v => { v[0].Mounts[0].Source = '/home/runner/.env'; }, v => { v[0].Config.Env.push('OPENAI_API_KEY=never-print'); },
    v => { v[3].NetworkSettings.Ports['8000/tcp'][0].HostIp = '0.0.0.0'; }, v => { v.pop(); }]) {
    const values = makeContainers(); mutate(values);
    assert.throws(() => validateContainers(values, { projectId, nonce, network, workspace }));
  }
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
