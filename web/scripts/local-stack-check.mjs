/**
 * Disposable Docker-only integration check for the approved public build branch.
 * No hosted project, model call, production key, artifact upload or deployment.
 * CLI source pin: supabase/cli c3c7a586b11b6605358177efabbc1b1cb7589b23 (v3.2.0).
 * The preserved fixture remains outside the production supabase/ tree.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcpServer, createConnection, isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyLocalIntegration } from './verify-local-integration.mjs';
import { verifyLocalReporting, reportingAuditSql, REPORT_ROLE_CHECK_SQL, REPORT_CHECK_CODES,
  REPORT_HTTP_CHECKS } from './verify-local-reporting.mjs';
import { verifyLocalQuestionSafety, questionSafetyAuditSql, QUESTION_ROLE_CHECK_SQL, QUESTION_CHECK_CODES,
  QUESTION_HTTP_CHECKS } from './verify-local-question-safety.mjs';

export const PINS = Object.freeze({
  cliVersion: '3.2.0',
  cliUrl: 'https://github.com/supabase/cli/releases/download/v3.2.0/supabase_3.2.0_linux_amd64.tar.gz',
  cliSha256: 'fb88b175a817563505be02c60872060bcb8d5c869a1aa5656eaeb085d4a2f1e4',
  schemaPath: 'supabase/migrations/20261115000000_vs_polls_and_votes.sql',
  schemaSha256: 'a11c228c811cf8f04030a6507755863a4a3c6a771f86caa5268db59c77a136f1',
  schemaGitBlob: 'c2a91f8f3dfc69598907faf1109fae41be0c638a',
  reportingProposalPath: 'web/qa/local-stack-fixture/vs-report-result.proposal.sql',
  reportingProposalSha256: 'c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c',
  questionSafetyProposalPath: 'web/qa/local-stack-fixture/vs-question-safety.proposal.sql',
  questionSafetyProposalSha256: 'b1394b91284d6882238570afa28f2b8c8290652679cd63564ac81f651c855dba',
  probeImage: 'node:24.22.3-bookworm-slim',
  networkCidr: '172.30.240.0/24', gateway: '172.30.240.1',
  probeCidr: '172.30.241.0/24', probeGateway: '172.30.241.1',
});
const REPOSITORY = 'jmpark0611-art/bestchoice';
const BRANCH = 'refs/heads/codex/genie-android-native-check-20261123';
const ORIGIN = 'http://127.0.0.1:55321';
const PROJECT_LABEL = 'com.supabase.cli.project';
const RUN_LABEL = 'genie.local.integration';
const FIXTURE_FILES = ['vs-decide/index.ts', 'vs-decide/fixture.mjs'];
const CORE_SUFFIXES = ['db', 'auth', 'rest', 'kong'];
const IMAGES = Object.freeze({
  db: 'public.ecr.aws/supabase/postgres:17.12.0.000',
  auth: 'public.ecr.aws/supabase/gotrue:v2.198.0',
  rest: 'public.ecr.aws/supabase/postgrest:v16.5',
  kong: 'public.ecr.aws/supabase/kong:2.8.1',
  edge_runtime: 'public.ecr.aws/supabase/edge-runtime:v1.79.1',
});
const EXCLUDE = 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor,edge-runtime';
const LOOPBACK_SERVICES = Object.freeze({ db: { listen: 55322, target: 5432 }, kong: { listen: 55321, target: 8000 } });
const defaultRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const regular = file => { try { return lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(); } catch { return false; } };
const fail = code => { throw new Error(code); };
const ensure = (condition, code) => { if (!condition) fail(code); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixedCode = error => error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
  ? error.message : 'LOCAL_STACK_CHECK_INCOMPLETE';
const DIAGNOSTIC_STAGES = new Set(['CLI_DOWNLOAD_FAILED', 'CLI_EXTRACTION_FAILED', 'CLI_VERSION_FAILED',
  'CLI_HELP_FAILED', 'LOCAL_INIT_FAILED', 'LOCAL_CONFIG_INVALID', 'EDGE_CONFIG_INVALID',
  'LOCAL_CORE_START_FAILED', 'LOCAL_EDGE_START_FAILED', 'SCOPED_FIREWALL_SUPPORT_REQUIRED', 'SCOPED_FIREWALL_INSTALL_FAILED',
  'PINNED_IMAGE_PULL_FAILED', 'PINNED_IMAGE_INSPECTION_FAILED']);

const INTEGRATION_ASSERTIONS = new Map([
  ['Distinct anonymous users required', 'ANONYMOUS_SESSIONS_NOT_DISTINCT'],
  ['Expected synthetic decision UUID', 'DECISION_ID_INVALID'],
  ['Owner response is incompatible with the current app contract', 'OWNER_RESPONSE_CONTRACT_FAILED'],
  ['Shared response is incompatible with the current app contract', 'SHARED_RESPONSE_CONTRACT_FAILED'],
  ['Visible result fields or vote counts are invalid', 'VISIBLE_RESULT_INVALID'],
  ['Unexpected private fields before vote', 'PREVOTE_PRIVACY_FAILED'],
  ['Vote response must contain the recorded choice', 'VOTE_RECORD_MISSING'],
  ['Voter response must keep non-owner permissions and private identifiers hidden', 'VOTER_PRIVACY_FAILED'],
  ['Shared or owner result changed unexpectedly', 'RESULT_PERSISTENCE_FAILED'],
  ['Reloaded guest choice did not persist', 'GUEST_VOTE_PERSISTENCE_FAILED'],
  ['Owner result mismatch', 'SYNTHETIC_INPUT_MISMATCH'],
  ['Direct table reads not isolated', 'TABLE_READ_ISOLATION_FAILED'],
  ['Direct voter write allowed', 'TABLE_WRITE_DENIAL_FAILED'],
  ['Foreign owner RPC allowed', 'OWNER_RPC_DENIAL_FAILED'],
  ['Foreign share RPC allowed', 'SHARE_RPC_DENIAL_FAILED'],
  ['Share was invalid or not idempotent', 'SHARE_IDEMPOTENCY_FAILED'],
  ['Owner vote was allowed', 'OWNER_VOTE_DENIAL_FAILED'],
  ['Vote not idempotent or tally differs', 'VOTE_IDEMPOTENCY_OR_TALLY_FAILED'],
  ['Owner choice request failed', 'OWNER_CHOICE_WRITE_FAILED'],
  ['Owner choice or share did not persist', 'OWNER_CHOICE_PERSISTENCE_FAILED'],
  ['Foreign delete RPC should be a no-op', 'GUEST_DELETE_NOOP_FAILED'],
  ['Voter removed owner record', 'OWNER_RECORD_REMOVED_BY_GUEST'],
  ['Foreign delete changed owner choice or share', 'GUEST_DELETE_CHANGED_OWNER_STATE'],
  ['Owner delete unsuccessful', 'OWNER_DELETE_FAILED'],
  ['Deleted record or invitation remained accessible', 'DELETION_VISIBILITY_FAILED'],
  ['LOCAL_INTEGRATION_TRANSPORT_FAILED', 'TRANSPORT_FAILED'],
  ['LOCAL_CHECK_INTERRUPTED', 'INTERRUPTED'],
]);
const INTEGRATION_HTTP_LABELS = new Map([
  ['Anonymous Auth', 'AUTH_HTTP_FAILED'], ['Deterministic local Edge', 'EDGE_HTTP_FAILED'],
  ['my_poll', 'OWNER_READ_HTTP_FAILED'], ['share', 'SHARE_HTTP_FAILED'],
  ['shared_poll', 'SHARED_READ_HTTP_FAILED'], ['vote', 'VOTE_HTTP_FAILED'],
  ['PostgREST owner visibility', 'TABLE_READ_HTTP_FAILED'],
]);
const INTEGRATION_REQUESTS = new Set([
  'POST /auth/v1/signup', 'POST /functions/v1/vs-decide',
  ...['my_poll', 'share', 'shared_poll', 'vote', 'set_did', 'delete_poll'].map(name => 'POST /rest/v1/rpc/vs_' + name),
  'GET /rest/v1/vs_polls', 'PATCH /rest/v1/vs_polls',
]);

/** A route template only: no query, body, headers, tokens or user/poll identifiers. */
export function integrationRequestDiagnostic(url, options) {
  let parsed;
  try { parsed = new URL(url); } catch { fail('LOCAL_INTEGRATION_REQUEST_UNEXPECTED'); }
  const method = options?.method;
  ensure(parsed.origin === ORIGIN && !parsed.username && !parsed.password && !parsed.hash &&
    INTEGRATION_REQUESTS.has(method + ' ' + parsed.pathname), 'LOCAL_INTEGRATION_REQUEST_UNEXPECTED');
  return { method, route: parsed.pathname, status: null };
}

/** Exact messages owned by verify-local-integration only; never emit arbitrary error text. */
export function integrationFailureDiagnostic(error, requests = [], requestCount = requests.length) {
  const message = error instanceof Error ? error.message : '';
  const http = /^(Anonymous Auth|Deterministic local Edge|my_poll|share|shared_poll|vote|PostgREST owner visibility) HTTP ([1-5][0-9]{2})$/.exec(message);
  const assertion = http ? INTEGRATION_HTTP_LABELS.get(http[1])
    : INTEGRATION_ASSERTIONS.get(message) ?? 'UNKNOWN_VERIFIER_FAILURE';
  const history = requests.slice(-12).filter(item => INTEGRATION_REQUESTS.has(item.method + ' ' + item.route)).map(item => ({
    number: Number.isSafeInteger(item.number) && item.number > 0 ? item.number : null,
    method: item.method, route: item.route,
    status: Number.isInteger(item.status) && item.status >= 100 && item.status <= 599 ? item.status : null,
    ...(item.transportFailed === true ? { transportFailed: true } : {}),
  }));
  return { stage: 'LOCAL_INTEGRATION_FAILED', assertion,
    ...(http ? { httpStatus: Number(http[2]) } : {}),
    requestCount: Number.isSafeInteger(requestCount) && requestCount >= 0 ? requestCount : null, requests: history };
}

/** Bounded known startup errors; never status/inspect bodies or arbitrary stdout. */
export function sanitizedFailureDiagnostic(stage, result, privateValues = []) {
  if (!DIAGNOSTIC_STAGES.has(stage)) return null;
  const structured = [];
  // Pinned CLI v3.2.0 output.layer.ts emits {_tag:"Error",error:{code,message}}
  // on stdout in JSON mode. Health failures otherwise begin with a container
  // name rather than "Error", so filtering text stderr hid the actual reason.
  if (stage === 'LOCAL_CORE_START_FAILED') {
    for (const line of String(result.stdout ?? '').slice(-64_000).split(/\r?\n/)) {
      try {
        const value = JSON.parse(line);
        if (value?._tag !== 'Error' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value.error?.code ?? '') ||
          typeof value.error?.message !== 'string') continue;
        structured.push(...value.error.message.split(/\r?\n/).slice(0, 4).map(message => `Error: ${value.error.code}: ${message}`));
      } catch {}
    }
  }
  let value = structured.join('\n') + '\n' + String(result.stderr ?? '').slice(0, 64_000);
  for (const secret of privateValues) if (typeof secret === 'string' && secret.length > 0) value = value.split(secret).join('[redacted]');
  value = value.replace(/\u001b\[[0-9;]*m/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\b(?:eyJ|e30)[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/\b(?:https?|postgresql|postgres):\/\/[^\s"'<>]+/gi, '[redacted-url]')
    .replace(/\b[A-Za-z0-9_]*(?:key|token|secret|password|jwt)[A-Za-z0-9_]*\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[redacted-setting]');
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(line =>
    /^(?:error\b|fatal\b|failed\b|invalid\b|unknown (?:flag|command)\b|unsupported\b|unrecognized\b|curl:|tar:|iptables:)/i.test(line) ||
    (stage === 'PINNED_IMAGE_PULL_FAILED' && /^(?:unauthorized\b|denied\b|manifest\b|no matching manifest\b|get\s|head\s|net\/http:|x509:|toomanyrequests:)/i.test(line)))
    .slice(0, 4).map(line => line.slice(0, 220));
  const download = {};
  if (stage === 'PINNED_IMAGE_PULL_FAILED') {
    const error = String(result.stderr ?? '').slice(0, 64_000);
    download.category = [[/toomanyrequests|too many requests|\b429\b/i, 'RATE_LIMIT'],
      [/unauthorized|authentication required|\b401\b/i, 'AUTHENTICATION'], [/denied|forbidden|\b403\b/i, 'ACCESS_DENIED'],
      [/manifest unknown|manifest.*not found|no matching manifest/i, 'MANIFEST_UNAVAILABLE'],
      [/x509|certificate|TLS/i, 'TLS'], [/timeout|timed out/i, 'TIMEOUT'],
      [/connection refused|no route|network is unreachable|lookup.*no such host/i, 'NETWORK']]
      .find(([pattern]) => pattern.test(error))?.[1] ?? 'UNCLASSIFIED';
    const status = error.match(/(?:status(?: code)?[ :=]+|HTTP(?:\/\d(?:\.\d)?)?\s+)([45]\d\d)\b/i);
    download.httpStatus = status ? Number(status[1]) : null;
  }
  return { stage, exitCode: Number.isInteger(result.status) ? result.status : 1, lines, ...download };
}

export function validateInvocation(env, allowDownloads, platform = process.platform, arch = process.arch) {
  ensure(allowDownloads === true, 'EXPLICIT_LOCAL_STACK_DOWNLOAD_OPT_IN_REQUIRED');
  ensure(platform === 'linux' && arch === 'x64', 'LINUX_AMD64_REQUIRED');
  ensure(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    env.RUNNER_OS === 'Linux' && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === BRANCH &&
    env.GENIE_PUBLIC_REPOSITORY === 'true', 'APPROVED_PUBLIC_STANDARD_RUNNER_REQUIRED');
  ensure(/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? '') && /^[0-9]+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') &&
    typeof env.RUNNER_TEMP === 'string' && path.isAbsolute(env.RUNNER_TEMP), 'RUNNER_IDENTITY_REQUIRED');
  ensure(!Object.keys(env).some(key => /^(?:VITE_|GENIE_ANDROID_|OPENAI_|ANTHROPIC_)/.test(key) ||
    ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_ID', 'SUPABASE_PROJECT_REF', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'CONTAINER_HOST'].includes(key)),
  'REMOVE_HOSTED_OR_RELEASE_INPUTS_FROM_LOCAL_CHECK');
}

export function localEnvironment(env, workspace) {
  const out = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (typeof env[key] === 'string') out[key] = env[key];
  }
  return { ...out, CI: 'true', NO_COLOR: '1', DO_NOT_TRACK: '1',
    SUPABASE_TELEMETRY_DISABLED: '1', SUPABASE_NO_KEYRING: '1',
    SUPABASE_HOME: path.join(workspace, 'cli-home'),
    SUPABASE_INTERNAL_IMAGE_REGISTRY: 'public.ecr.aws' };
}

/** CLI-scoped Docker wrapper. No global Docker daemon or host DNS changes. */
export function dockerPolicyArguments(args, network, nonce) {
  ensure(Array.isArray(args) && args.every(arg => typeof arg === 'string'), 'INVALID_DOCKER_ARGUMENTS');
  ensure(/^genie-local-[0-9a-f]{12}$/.test(network) && /^[0-9a-f]{12}$/.test(nonce), 'INVALID_RUN_IDENTITY');
  const command = args[0] === 'container' ? args[1] : args[0];
  ensure(!args.includes('prune') && command !== 'pull' && !(args[0] === 'image' && args[1] === 'pull'), 'UNEXPECTED_DOCKER_DOWNLOAD_OR_PRUNE');
  if (!['run', 'create'].includes(command)) return args;
  ensure(!args.some(arg => /^--(?:privileged|dns|net=|network=|publish-all)/.test(arg)), 'UNSAFE_CONTAINER_OPTION');
  const at = args.indexOf('--network');
  ensure(at >= 0 && args[at + 1] === network && args.filter(arg => arg === '--network').length === 1,
    'UNEXPECTED_CONTAINER_NETWORK');
  const position = args[0] === 'container' ? 2 : 1;
  return [...args.slice(0, position), '--dns', '127.0.0.1', '--label', `${RUN_LABEL}=${nonce}`, ...args.slice(position)];
}

export function validateNetwork(value, name, cidr = PINS.networkCidr) {
  ensure(value && /^[0-9a-f]{64}$/.test(value.Id ?? '') && value.Name === name && value.Driver === 'bridge' &&
    value.Internal === true && value.EnableIPv6 === false && value.Attachable !== true &&
    value.Options?.['com.docker.network.bridge.host_binding_ipv4'] === '127.0.0.1' &&
    Array.isArray(value.IPAM?.Config) && value.IPAM.Config.length === 1 && value.IPAM.Config[0].Subnet === cidr &&
    value.IPAM.Config[0].Gateway === (cidr === PINS.networkCidr ? PINS.gateway : PINS.probeGateway),
  'DOCKER_NETWORK_ISOLATION_UNCONFIRMED');
  return { id: value.Id, bridge: 'br-' + value.Id.slice(0, 12), cidr, gateway: value.IPAM.Config[0].Gateway };
}

function validateOwnedContainer(item, suffix, { projectId, nonce, network, workspace }) {
  ensure(item && item.Name === `/supabase_${suffix}_${projectId}` && /^[0-9a-f]{64}$/.test(item.Id ?? '') && item.State?.Running === true &&
    item.Config?.Labels?.[PROJECT_LABEL] === projectId && item.Config?.Labels?.[RUN_LABEL] === nonce &&
    item.Config?.Image === IMAGES[suffix], 'STACK_CONTAINER_IDENTITY_UNCONFIRMED');
  ensure(item.HostConfig?.NetworkMode === network && item.HostConfig?.Privileged === false &&
    JSON.stringify(item.HostConfig?.Dns) === '["127.0.0.1"]' &&
    Object.keys(item.NetworkSettings?.Networks ?? {}).length === 1 && item.NetworkSettings.Networks[network] &&
    !item.HostConfig?.PidMode && !item.HostConfig?.IpcMode?.startsWith('host'), 'STACK_CONTAINER_ISOLATION_UNCONFIRMED');
  for (const bindings of Object.values(item.NetworkSettings?.Ports ?? {})) {
    for (const binding of bindings ?? []) ensure(binding.HostIp === '127.0.0.1' &&
      ['55321', '55322'].includes(binding.HostPort), 'NONLOOPBACK_OR_UNEXPECTED_PORT');
  }
  for (const mount of item.Mounts ?? []) {
    ensure(!String(mount.Source).endsWith('docker.sock') && !String(mount.Destination).endsWith('docker.sock'), 'DOCKER_SOCKET_MOUNT_REFUSED');
    if (mount.Type === 'bind') ensure(path.resolve(mount.Source).startsWith(workspace + path.sep), 'EXTERNAL_CONTAINER_BIND_REFUSED');
  }
  ensure(!(item.Config.Env ?? []).some(line => /^(?:OPENAI_|ANTHROPIC_|VITE_|GENIE_ANDROID_)/.test(line)), 'UNEXPECTED_CONTAINER_CREDENTIAL');
}

export function validatedProxyTarget(item, service, identity) {
  ensure(Object.hasOwn(LOOPBACK_SERVICES, service), 'UNAPPROVED_LOOPBACK_SERVICE');
  validateOwnedContainer(item, service, identity);
  const attachment = item.NetworkSettings.Networks[identity.network];
  const ip = attachment.IPAddress;
  ensure(/^[0-9a-f]{64}$/.test(identity.networkId ?? '') && attachment.NetworkID === identity.networkId &&
    attachment.IPPrefixLen === 24 && isIP(ip ?? '') === 4 && /^172\.30\.240\./.test(ip) &&
    Number(ip.split('.')[3]) >= 2 && Number(ip.split('.')[3]) <= 254 && !attachment.GlobalIPv6Address,
  'LOOPBACK_TARGET_NETWORK_UNCONFIRMED');
  return Object.freeze({ containerId: item.Id, ip, port: LOOPBACK_SERVICES[service].target });
}

/** The listener belongs to this process; it never steals a port or runs a proxy subprocess. */
export class OwnedLoopbackProxy {
  constructor(service, identity, { serverFactory = createTcpServer, connect = createConnection } = {}) {
    ensure(Object.hasOwn(LOOPBACK_SERVICES, service), 'UNAPPROVED_LOOPBACK_SERVICE');
    this.service = service; this.identity = identity; this.connect = connect;
    this.sockets = new Set(); this.forwarded = 0; this.missingTarget = 0; this.connectFailures = 0;
    this.server = serverFactory(client => this.accept(client));
    this.server.on('error', () => { this.listenerError = true; });
  }
  async start() {
    ensure(!this.closing && !this.server.listening, 'LOOPBACK_PROXY_LIFECYCLE_INVALID');
    try {
      await new Promise((resolve, reject) => {
        const error = () => { this.server.off('listening', listening); reject(new Error('APPROVED_LOOPBACK_PORT_UNAVAILABLE')); };
        const listening = () => { this.server.off('error', error); resolve(); };
        this.server.once('error', error); this.server.once('listening', listening);
        this.server.listen({ host: '127.0.0.1', port: LOOPBACK_SERVICES[this.service].listen, exclusive: true });
      });
    } catch { fail('APPROVED_LOOPBACK_PORT_UNAVAILABLE'); }
    const address = this.server.address();
    ensure(address?.address === '127.0.0.1' && address.port === LOOPBACK_SERVICES[this.service].listen, 'LOOPBACK_BIND_UNCONFIRMED');
  }
  setTarget(item) {
    ensure(!this.closing && !this.listenerError, 'LOOPBACK_PROXY_UNAVAILABLE');
    const next = validatedProxyTarget(item, this.service, this.identity);
    ensure(!this.pinnedTarget || JSON.stringify(this.pinnedTarget) === JSON.stringify(next), 'LOOPBACK_TARGET_CHANGED');
    this.pinnedTarget = next; this.target = next;
  }
  clearTarget() { this.target = undefined; }
  accept(client) {
    if (this.closing || this.listenerError || !this.target || client.remoteAddress !== '127.0.0.1') {
      this.missingTarget++; client.destroy(); return;
    }
    this.sockets.add(client); client.pause();
    let upstream;
    try { upstream = this.connect({ host: this.target.ip, port: this.target.port, family: 4 }); }
    catch { this.connectFailures++; this.sockets.delete(client); client.destroy(); return; }
    this.sockets.add(upstream);
    const close = () => { client.destroy(); upstream.destroy(); };
    const timeout = setTimeout(() => { this.connectFailures++; close(); }, 5000);
    for (const socket of [client, upstream]) {
      socket.once('error', () => { this.connectFailures++; close(); });
      socket.once('close', () => { clearTimeout(timeout); this.sockets.delete(socket); close(); });
    }
    upstream.once('connect', () => {
      clearTimeout(timeout);
      if (this.closing || !this.target) { close(); return; }
      this.forwarded++; client.pipe(upstream); upstream.pipe(client); client.resume();
    });
  }
  proof() {
    const address = this.server.address();
    return { service: this.service, host: '127.0.0.1', port: LOOPBACK_SERVICES[this.service].listen,
      listening: !this.closing && !this.listenerError && this.server.listening && address?.address === '127.0.0.1' && address.port === LOOPBACK_SERVICES[this.service].listen,
      target: this.target ?? null, forwardedConnections: this.forwarded, missingTargetConnections: this.missingTarget,
      connectFailures: this.connectFailures };
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; this.clearTarget();
    for (const socket of this.sockets) socket.destroy();
    this.closePromise = new Promise(resolve => {
      if (!this.server.listening) { resolve(true); return; }
      const timeout = setTimeout(() => resolve(false), 3000);
      this.server.close(error => { clearTimeout(timeout); resolve(!error && !this.server.listening); });
    });
    return this.closePromise;
  }
}

export function validateContainers(values, { projectId, nonce, network, networkId, workspace, edge = false, loopbackProxies = [] }) {
  const suffixes = edge ? [...CORE_SUFFIXES, 'edge_runtime'] : CORE_SUFFIXES;
  ensure(Array.isArray(values) && values.length === suffixes.length, 'UNEXPECTED_STACK_CONTAINERS');
  const bySuffix = {};
  for (const suffix of suffixes) {
    const item = values.find(value => value.Name === `/supabase_${suffix}_${projectId}`);
    validateOwnedContainer(item, suffix, { projectId, nonce, network, workspace });
    bySuffix[suffix] = item;
  }
  for (const service of Object.keys(LOOPBACK_SERVICES)) {
    const target = validatedProxyTarget(bySuffix[service], service, { projectId, nonce, network, networkId, workspace });
    const proxy = loopbackProxies.find(value => value.service === service);
    ensure(proxy?.listening === true && proxy.host === '127.0.0.1' && proxy.port === LOOPBACK_SERVICES[service].listen &&
      JSON.stringify(proxy.target) === JSON.stringify(target) && proxy.forwardedConnections > 0, 'APPROVED_LISTENER_UNCONFIRMED');
  }
  ensure(bySuffix.kong.NetworkSettings.Networks[network].Aliases?.includes('kong'), 'LOCAL_GATEWAY_ALIAS_UNCONFIRMED');
  return bySuffix;
}

export function firewallPlan({ bridge, cidr }, nonce) {
  ensure(/^br-[0-9a-f]{12}$/.test(bridge) && cidr === PINS.networkCidr && /^[0-9a-f]{12}$/.test(nonce), 'UNSAFE_FIREWALL_SCOPE');
  const input = 'GENIE_I_' + nonce, forward = 'GENIE_F_' + nonce;
  const entries = [
    { add: ['-N', input], remove: ['-X', input] },
    { add: ['-A', input, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'], remove: ['-D', input, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'] },
    { add: ['-A', input, '-j', 'REJECT'], remove: ['-D', input, '-j', 'REJECT'] },
    { add: ['-I', 'INPUT', '1', '-i', bridge, '-s', cidr, '-j', input], remove: ['-D', 'INPUT', '-i', bridge, '-s', cidr, '-j', input] },
    { add: ['-N', forward], remove: ['-X', forward] },
    { add: ['-A', forward, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'], remove: ['-D', forward, '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'RETURN'] },
    { add: ['-A', forward, '-d', cidr, '-j', 'RETURN'], remove: ['-D', forward, '-d', cidr, '-j', 'RETURN'] },
    { add: ['-A', forward, '-j', 'REJECT'], remove: ['-D', forward, '-j', 'REJECT'] },
    { add: ['-I', 'DOCKER-USER', '1', '-i', bridge, '-s', cidr, '-j', forward], remove: ['-D', 'DOCKER-USER', '-i', bridge, '-s', cidr, '-j', forward] },
  ];
  return { input, forward, entries };
}

export function stackConfig(projectId, edge = false) {
  ensure(/^genie_it_[0-9a-f]{12}$/.test(projectId), 'INVALID_PROJECT_ID');
  return `project_id = "${projectId}"
[api]
enabled = true
port = 55321
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000
[db]
port = 55322
shadow_port = 55320
major_version = 17
health_timeout = "3m"
[db.seed]
enabled = false
[db.pooler]
enabled = false
[auth]
enabled = true
site_url = "${ORIGIN}"
enable_signup = true
enable_anonymous_sign_ins = true
[auth.email]
enabled = false
[auth.sms]
enabled = false
[local_smtp]
enabled = false
[realtime]
enabled = false
[storage]
enabled = false
[studio]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = ${edge}
policy = "per_worker"
deno_version = 2
${edge ? `[edge_runtime.secrets]
GENIE_EDGE_MODE = "isolated-genie-synthetic-only"
GENIE_EDGE_ORIGIN = "http://kong:8000"
GENIE_EDGE_NETGUARD = "env(GENIE_EDGE_NETGUARD)"
GENIE_EDGE_ANON_JWT = "env(GENIE_EDGE_ANON_JWT)"
GENIE_EDGE_WRITER_JWT = "env(GENIE_EDGE_WRITER_JWT)"
[functions.vs-decide]
verify_jwt = true
` : ''}`;
}

export function readPinnedInputs(repoRoot) {
  const schema = path.join(repoRoot, PINS.schemaPath);
  const fixtureRoot = path.join(repoRoot, 'web/qa/local-stack-fixture');
  ensure(regular(schema) && digest(readFileSync(schema)) === PINS.schemaSha256, 'CANONICAL_SCHEMA_REQUIRED');
  const manifestFile = path.join(fixtureRoot, 'manifest.json');
  ensure(regular(manifestFile), 'PINNED_FIXTURE_MANIFEST_REQUIRED');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  ensure(manifest.canonicalSchemaSha256 === PINS.schemaSha256 && manifest.canonicalSchemaPath === PINS.schemaPath,
    'FIXTURE_SCHEMA_PROVENANCE_MISMATCH');
  const hashes = {};
  for (const file of FIXTURE_FILES) {
    const source = path.join(fixtureRoot, file);
    ensure(regular(source), 'PINNED_FIXTURE_FILE_REQUIRED');
    hashes[file] = digest(readFileSync(source));
    ensure(hashes[file] === manifest.files?.[file], 'PINNED_FIXTURE_HASH_MISMATCH');
  }
  const reportingProposal = path.join(repoRoot, PINS.reportingProposalPath);
  ensure(regular(reportingProposal) && digest(readFileSync(reportingProposal)) === PINS.reportingProposalSha256,
    'PINNED_REPORT_PROPOSAL_REQUIRED');
  const questionSafetyProposal = path.join(repoRoot, PINS.questionSafetyProposalPath);
  ensure(regular(questionSafetyProposal) && digest(readFileSync(questionSafetyProposal)) === PINS.questionSafetyProposalSha256,
    'PINNED_QUESTION_PROPOSAL_REQUIRED');
  return { schema, fixtureRoot, hashes, manifest, reportingProposal, questionSafetyProposal };
}

function executable(name, env) {
  for (const folder of (env.PATH ?? '').split(path.delimiter)) {
    const file = path.join(folder, name);
    if (!path.isAbsolute(file)) continue;
    try {
      const resolved = realpathSync(file);
      // Keep the original basename: Ubuntu's iptables is a multi-call binary symlink.
      if (regular(resolved) && (lstatSync(resolved).mode & 0o111)) return file;
    } catch {}
  }
  fail('REQUIRED_LOCAL_TOOL_MISSING');
}

function execute({ command, args, cwd, env, timeout = 60_000, signal, input }) {
  return new Promise(resolve => {
    let stdout = '', stderr = '', settled = false, terminated = false, hard;
    const child = spawn(command, args, { cwd, env, shell: false, detached: true,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== undefined) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    const stop = () => {
      terminated = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      hard ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
    };
    const timer = setTimeout(stop, timeout);
    const finish = status => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(hard); signal?.removeEventListener('abort', stop);
      resolve({ status: terminated ? 1 : status, stdout, stderr });
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', data => { if (stdout.length < 8_000_000) stdout += data; });
    child.stderr.on('data', data => { if (stderr.length < 8_000_000) stderr += data; });
    child.on('error', () => finish(1)); child.on('close', code => finish(code ?? 1));
    if (signal?.aborted) stop();
  });
}

function launch(command, args, options) {
  const child = spawn(command, args, { ...options, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // Capture nothing publicly: CLI failure output can include local credentials.
  let stderr = '';
  child.stdout.on('data', () => {}); child.stderr.on('data', data => { if (stderr.length < 64_000) stderr += data; });
  let stopped = false;
  child.on('error', () => { stopped = true; }); child.on('exit', () => { stopped = true; });
  return { child, isStopped: () => stopped, failure: () => ({ status: 1, stderr }), stop: async () => {
    if (stopped) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 20 && !stopped; i++) await delay(100);
    if (!stopped) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  } };
}

function parseJwtRole(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url')).role; } catch { return null; }
}

export function parseLocalStatus(value) {
  ensure(value && value.API_URL === ORIGIN && parseJwtRole(value.ANON_KEY) === 'anon' &&
    parseJwtRole(value.SERVICE_ROLE_KEY) === 'service_role' && value.ANON_KEY !== value.SERVICE_ROLE_KEY,
  'LOCAL_STATUS_IDENTITY_UNCONFIRMED');
  return { anon: value.ANON_KEY, writer: value.SERVICE_ROLE_KEY };
}

/** Explicit state projection only: never serialize inspect Env, mounts or raw health output. */
export function startupContainerStates(values, projectId, nonce) {
  const errorName = value => {
    const text = String(value ?? '');
    for (const [pattern, name] of [[/ECONNREFUSED|connection refused/i, 'CONNECTION_REFUSED'],
      [/ENOTFOUND|EAI_AGAIN|name resolution/i, 'DNS_LOOKUP_FAILED'], [/ETIMEDOUT|timed out|timeout/i, 'TIMEOUT'],
      [/no route to host/i, 'NO_ROUTE'], [/permission denied/i, 'PERMISSION_DENIED'],
      [/password authentication failed/i, 'AUTHENTICATION_FAILED'], [/address already in use/i, 'ADDRESS_IN_USE'],
      [/exec format error/i, 'EXEC_FORMAT_ERROR'], [/OCI runtime exec failed/i, 'OCI_EXEC_FAILED']]) if (pattern.test(text)) return name;
    return text.length ? 'UNCLASSIFIED_ERROR' : null;
  };
  return (Array.isArray(values) ? values : []).flatMap(item => {
    const service = [...CORE_SUFFIXES, 'edge_runtime'].find(name => item.Name === `/supabase_${name}_${projectId}`);
    if (!service || item.Config?.Labels?.[PROJECT_LABEL] !== projectId) return [];
    const state = item.State ?? {}, health = state.Health;
    const projectNetwork = item.NetworkSettings?.Networks?.['genie-local-' + nonce];
    const ports = bindings => Object.entries(bindings ?? {}).filter(([port]) => /^(?:5432|8000)\/tcp$/.test(port)).map(([port, values]) => ({
      containerPort: port, bindings: (values ?? []).slice(0, 3).map(value => ({
        host: value.HostIp === '' ? 'network-default' : isIP(value.HostIp ?? '') ? value.HostIp : 'invalid',
        port: /^[0-9]{1,5}$/.test(value.HostPort ?? '') ? Number(value.HostPort) : null,
      })),
    }));
    return [{ service, wrapperLabelPresent: item.Config.Labels[RUN_LABEL] === nonce,
      status: ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(state.Status) ? state.Status : 'unknown',
      running: state.Running === true, exitCode: Number.isInteger(state.ExitCode) ? state.ExitCode : null,
      oomKilled: state.OOMKilled === true, stateError: errorName(state.Error),
      health: ['starting', 'healthy', 'unhealthy'].includes(health?.Status) ? health.Status : 'none',
      networkCount: Object.keys(item.NetworkSettings?.Networks ?? {}).length,
      networkId: /^[0-9a-f]{64}$/.test(projectNetwork?.NetworkID ?? '') ? projectNetwork.NetworkID : null,
      ipv4: isIP(projectNetwork?.IPAddress ?? '') === 4 ? projectNetwork.IPAddress : null,
      requestedPorts: ports(item.HostConfig?.PortBindings), publishedPorts: ports(item.NetworkSettings?.Ports),
      recentHealth: (Array.isArray(health?.Log) ? health.Log : []).slice(-3).map(entry => ({
        exitCode: Number.isInteger(entry.ExitCode) ? entry.ExitCode : null,
        errorName: entry.ExitCode === 0 ? null : errorName(entry.Output),
      })) }];
  });
}

async function portIsFree(port) {
  const server = createTcpServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

function statePath(env) { return path.join(env.RUNNER_TEMP, `genie-local-stack-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.json`); }

export class DockerStackRuntime {
  constructor({ repoRoot, env, signal, send = fetch }) {
    this.repoRoot = repoRoot; this.env = env; this.signal = signal; this.send = send;
    this.state = { schemaVersion: 1, nonce: randomBytes(6).toString('hex'), firewallRemovals: [], networks: [] };
    this.state.projectId = 'genie_it_' + this.state.nonce;
    this.state.networkName = 'genie-local-' + this.state.nonce;
    this.state.probeName = this.state.networkName + '-probe';
    this.state.runId = env.GITHUB_RUN_ID; this.state.runAttempt = env.GITHUB_RUN_ATTEMPT;
    this.imageProof = {}; this.probeProof = []; this.diagnostics = []; this.startupStates = [];
  }
  save() { writeFileSync(statePath(this.env), JSON.stringify(this.state), { mode: 0o600 }); }
  recordFailure(stage, result) {
    const diagnostic = sanitizedFailureDiagnostic(stage, result, [this.keys?.anon, this.keys?.writer]);
    if (diagnostic) this.diagnostics.push(diagnostic);
  }
  async command(stage, command, args, options = {}) {
    ensure(!this.signal?.aborted || options.cleanup, 'LOCAL_CHECK_INTERRUPTED');
    const result = await execute({ command, args, cwd: this.state.workspace && existsSync(this.state.workspace) ? this.state.workspace : this.repoRoot,
      env: this.baseEnv ?? localEnvironment(this.env, this.env.RUNNER_TEMP),
      signal: options.cleanup ? undefined : this.signal, ...options });
    if (!options.allowFailure && result.status !== 0) { this.recordFailure(stage, result); fail(stage); }
    return result;
  }
  async docker(args, options = {}) { return this.command('DOCKER_OPERATION_FAILED', this.tools.docker, args, options); }
  async inspect(kind, names, options = {}) {
    const result = await this.docker([kind, 'inspect', ...names], options);
    try { return JSON.parse(result.stdout); } catch { fail('DOCKER_INSPECTION_INVALID'); }
  }
  async preflight() {
    this.inputs = readPinnedInputs(this.repoRoot);
    this.tools = Object.fromEntries(['docker', 'sudo', 'iptables', 'curl', 'tar'].map(name => [name, executable(name, this.env)]));
    ensure(!existsSync(statePath(this.env)), 'PREVIOUS_LOCAL_STACK_STATE_EXISTS');
    const context = await this.docker(['context', 'inspect']);
    const contexts = JSON.parse(context.stdout);
    ensure(contexts.length === 1 && ['unix:///var/run/docker.sock', 'unix:///run/docker.sock'].includes(contexts[0].Endpoints?.docker?.Host), 'LOCAL_DOCKER_DAEMON_REQUIRED');
    const info = JSON.parse((await this.docker(['info', '--format', '{{json .}}'])).stdout);
    ensure(Number.parseInt(info.ServerVersion, 10) >= 26 && info.OSType === 'linux', 'SUPPORTED_LOCAL_DOCKER_REQUIRED');
    this.dockerVersion = info.ServerVersion;
    ensure((await this.docker(['ps', '-aq'])).stdout.trim() === '', 'EXCLUSIVE_EMPTY_DOCKER_RUNNER_REQUIRED');
    await this.command('SCOPED_FIREWALL_SUPPORT_REQUIRED', this.tools.sudo, ['-n', this.tools.iptables, '-w', '5', '-nL', 'DOCKER-USER']);
    await portIsFree(55321); await portIsFree(55322);
  }
  async prepare() {
    this.state.workspace = mkdtempSync(path.join(this.env.RUNNER_TEMP, 'genie-local-stack-work-'));
    chmodSync(this.state.workspace, 0o700); this.save();
    this.baseEnv = localEnvironment(this.env, this.state.workspace);
    const bin = path.join(this.state.workspace, 'bin'); mkdirSync(bin);
    const archive = path.join(this.state.workspace, 'cli.tar.gz');
    await this.command('CLI_DOWNLOAD_FAILED', this.tools.curl,
      ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--tlsv1.2', '--max-time', '180', '--output', archive, PINS.cliUrl], { timeout: 185_000 });
    ensure(digest(readFileSync(archive)) === PINS.cliSha256, 'CLI_ARCHIVE_HASH_MISMATCH');
    await this.command('CLI_EXTRACTION_FAILED', this.tools.tar, ['-xzf', archive, '-C', bin, 'supabase']);
    this.cli = path.join(bin, 'supabase'); ensure(regular(this.cli), 'CLI_EXECUTABLE_MISSING'); chmodSync(this.cli, 0o700);
    ensure((await this.command('CLI_VERSION_FAILED', this.cli, ['--version'])).stdout.trim() === PINS.cliVersion, 'CLI_VERSION_MISMATCH');
    const help = (await this.command('CLI_HELP_FAILED', this.cli, ['--help'])).stdout;
    ensure(help.includes('--workdir') && help.includes('--network-id') && help.includes('--output-format'), 'CLI_REQUIRED_FLAGS_MISSING');
    const startHelp = (await this.command('CLI_HELP_FAILED', this.cli, ['start', '--help'])).stdout;
    ensure(startHelp.includes('--exclude'), 'CLI_REQUIRED_FLAGS_MISSING');
    await this.command('CLI_HELP_FAILED', this.cli, ['functions', 'serve', '--help']);
    for (const image of [...Object.values(IMAGES), PINS.probeImage]) {
      let result;
      try {
        await this.command('PINNED_IMAGE_PULL_FAILED', this.tools.docker, ['pull', image], { timeout: 240_000 });
        result = await this.command('PINNED_IMAGE_INSPECTION_FAILED', this.tools.docker, ['image', 'inspect', image]);
      } catch (error) {
        const diagnostic = this.diagnostics.at(-1);
        if (['PINNED_IMAGE_PULL_FAILED', 'PINNED_IMAGE_INSPECTION_FAILED'].includes(diagnostic?.stage)) {
          diagnostic.image = image;
          diagnostic.completedImages = Object.keys(this.imageProof);
        }
        throw error;
      }
      let proof;
      try { [proof] = JSON.parse(result.stdout); } catch { fail('IMAGE_INSPECTION_INVALID'); }
      ensure(/^sha256:[0-9a-f]{64}$/.test(proof.Id ?? '') && proof.RepoDigests?.some(value => /@sha256:[0-9a-f]{64}$/.test(value)), 'IMAGE_DIGEST_UNCONFIRMED');
      this.imageProof[image] = { id: proof.Id, digests: proof.RepoDigests };
    }
    await this.command('LOCAL_INIT_FAILED', this.cli, ['init', '--workdir', this.state.workspace]);
    mkdirSync(path.join(this.state.workspace, 'supabase/migrations'), { recursive: true });
    copyFileSync(this.inputs.schema, path.join(this.state.workspace, PINS.schemaPath));
    writeFileSync(path.join(this.state.workspace, 'supabase/config.toml'), stackConfig(this.state.projectId), { mode: 0o600 });
    await this.command('LOCAL_CONFIG_INVALID', this.cli, ['config', 'validate', '--workdir', this.state.workspace]);
    const wrapperDir = path.join(this.state.workspace, 'docker-policy'); mkdirSync(wrapperDir);
    this.policyRefusals = path.join(wrapperDir, 'refusals');
    const wrapper = `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nimport {appendFileSync} from 'node:fs';\nimport {dockerPolicyArguments} from ${JSON.stringify(import.meta.url)};\ntry { const args=dockerPolicyArguments(process.argv.slice(2),${JSON.stringify(this.state.networkName)},${JSON.stringify(this.state.nonce)}); const result=spawnSync(${JSON.stringify(this.tools.docker)},args,{env:{...process.env,PATH:${JSON.stringify(this.baseEnv.PATH)}},stdio:'inherit'}); process.exit(result.status??1); } catch { try { appendFileSync(${JSON.stringify(this.policyRefusals)},'refused\\n',{mode:0o600}); } catch {} console.error('LOCAL_DOCKER_POLICY_REFUSED'); process.exit(1); }\n`;
    writeFileSync(path.join(wrapperDir, 'docker'), wrapper, { mode: 0o700 });
    this.cliEnv = { ...this.baseEnv, PATH: wrapperDir + path.delimiter + this.baseEnv.PATH };
  }
  async isolate() {
    for (const [name, cidr, gateway] of [[this.state.networkName, PINS.networkCidr, PINS.gateway], [this.state.probeName, PINS.probeCidr, PINS.probeGateway]]) {
      this.state.networks.push(name); this.save();
      await this.docker(['network', 'create', '--driver', 'bridge', '--internal', '--subnet', cidr, '--gateway', gateway,
        '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', '--label', `${RUN_LABEL}=${this.state.nonce}`, name]);
    }
    const [net] = await this.inspect('network', [this.state.networkName]);
    this.network = validateNetwork(net, this.state.networkName);
    const plan = firewallPlan(this.network, this.state.nonce);
    for (const entry of plan.entries) {
      this.state.firewallRemovals.push(entry.remove); this.save();
      await this.command('SCOPED_FIREWALL_INSTALL_FAILED', this.tools.sudo, ['-n', this.tools.iptables, '-w', '5', ...entry.add]);
    }
    for (const args of [['-C', 'INPUT', '-i', this.network.bridge, '-s', this.network.cidr, '-j', plan.input],
      ['-C', 'DOCKER-USER', '-i', this.network.bridge, '-s', this.network.cidr, '-j', plan.forward]]) {
      await this.command('SCOPED_FIREWALL_UNCONFIRMED', this.tools.sudo, ['-n', this.tools.iptables, '-w', '5', ...args]);
    }
    // Docker internal networks do not program published ports. These listeners
    // bind exclusively before the CLI's host-readiness probe can begin. Until a
    // matching running container is inspected they reject every connection.
    const identity = { ...this.state, network: this.state.networkName, networkId: this.network.id };
    this.proxies = Object.keys(LOOPBACK_SERVICES).map(service => new OwnedLoopbackProxy(service, identity));
    for (const proxy of this.proxies) await proxy.start();
  }
  async captureStartupStates() {
    const clearTargets = () => { for (const proxy of this.proxies ?? []) proxy.clearTarget(); };
    let values;
    try {
      const ids = (await this.docker(['ps', '-aq', '--filter', `label=${PROJECT_LABEL}=${this.state.projectId}`],
        { timeout: 10_000 })).stdout.trim().split(/\s+/).filter(Boolean);
      if (!ids.length || !ids.every(id => /^[0-9a-f]{12,64}$/.test(id))) { clearTargets(); return; }
      values = await this.inspect('container', ids, { timeout: 10_000 });
      ensure(Array.isArray(values), 'DOCKER_INSPECTION_INVALID');
      const states = startupContainerStates(values, this.state.projectId, this.state.nonce);
      if (states.length && JSON.stringify(states) !== JSON.stringify(this.startupStates.at(-1))) {
        this.startupStates.push(states); this.startupStates = this.startupStates.slice(-2);
      }
    } catch { clearTargets(); return; /* A failed inspect also revokes previous forwarding targets. */ }
    try {
      for (const proxy of this.proxies ?? []) {
        const item = values.find(value => value.Name === `/supabase_${proxy.service}_${this.state.projectId}`);
        if (item?.State?.Running === true) proxy.setTarget(item);
        else proxy.clearTarget();
      }
    } catch (error) { clearTargets(); throw error; }
  }
  async startCore() {
    // The CLI rolls back failed containers. Sample safe state while it starts so
    // rollback does not erase the evidence before our finally cleanup executes.
    let pending = Promise.resolve(), busy = false, failure, proxyFailure;
    const startupAbort = new AbortController();
    const sample = () => {
      if (busy) return; busy = true;
      pending = this.captureStartupStates().catch(error => {
        proxyFailure = fixedCode(error); startupAbort.abort();
      }).finally(() => { busy = false; });
    };
    const timer = setInterval(sample, 2000); sample();
    try {
      await this.command('LOCAL_CORE_START_FAILED', this.cli, ['start', '--workdir', this.state.workspace,
        '--network-id', this.state.networkName, '--exclude', EXCLUDE, '--output-format', 'json'],
      { env: this.cliEnv, timeout: 480_000,
        signal: this.signal ? AbortSignal.any([this.signal, startupAbort.signal]) : startupAbort.signal });
    } catch (error) { failure = error; }
    finally { clearInterval(timer); await pending; }
    if (proxyFailure && !failure) {
      failure = new Error(proxyFailure);
      this.recordFailure('LOCAL_CORE_START_FAILED', { status: 1, stderr: 'Error: ' + proxyFailure });
    }
    if (failure) {
      const diagnostic = this.diagnostics.at(-1);
      if (diagnostic?.stage === 'LOCAL_CORE_START_FAILED') {
        diagnostic.containerStates = this.startupStates;
        diagnostic.dockerVersion = this.dockerVersion;
        diagnostic.loopbackProxies = this.proxies.map(proxy => proxy.proof());
        if (proxyFailure) diagnostic.proxyGuard = proxyFailure;
        diagnostic.wrapperRefusals = existsSync(this.policyRefusals)
          ? readFileSync(this.policyRefusals, 'utf8').split('\n').filter(value => value === 'refused').length : 0;
      }
      throw failure;
    }
    await this.captureStartupStates();
    this.keys = parseLocalStatus(JSON.parse((await this.command('LOCAL_STATUS_FAILED', this.cli,
      ['status', '--workdir', this.state.workspace, '-o', 'json'], { env: this.cliEnv })).stdout));
    await this.verifyLoopbackApi();
  }
  async verifyLoopbackApi() {
    const proof = this.proxies.find(proxy => proxy.service === 'kong')?.proof();
    ensure(proof?.listening === true && proof.host === '127.0.0.1' && proof.port === 55321 && proof.target,
      'APPROVED_LISTENER_UNCONFIRMED');
    // Do not assume the CLI's own status/health implementation dialed Kong from
    // the host. This explicit read creates no session or synthetic application data.
    let ready = false;
    try {
      const timeout = AbortSignal.timeout(3000);
      const response = await this.send(ORIGIN + '/auth/v1/health', { method: 'GET',
        headers: { apikey: this.keys.anon }, redirect: 'error',
        signal: this.signal ? AbortSignal.any([timeout, this.signal]) : timeout });
      ready = response.status === 200;
      await response.body?.cancel();
    } catch {}
    ensure(ready, 'LOCAL_CORE_API_READINESS_UNCONFIRMED');
  }
  async stackContainers(edge) {
    const ids = (await this.docker(['ps', '-aq', '--filter', `label=${PROJECT_LABEL}=${this.state.projectId}`])).stdout.trim().split(/\s+/).filter(Boolean);
    ensure(ids.length > 0, 'LOCAL_STACK_CONTAINERS_MISSING');
    const values = await this.inspect('container', ids);
    return validateContainers(values, { ...this.state, network: this.state.networkName, networkId: this.network.id, edge,
      loopbackProxies: this.proxies.map(proxy => proxy.proof()) });
  }
  async probeNamespace(container, phase) {
    const nonce = this.state.nonce;
    let hostHits = 0;
    const server = createServer((_request, response) => { hostHits++; response.end(nonce); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, this.network.gateway, resolve); });
    const hostUrl = `http://${this.network.gateway}:${server.address().port}/`;
    const probeContainer = 'genie_probe_' + nonce;
    try {
      const first = await fetch(hostUrl, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      ensure(await first.text() === nonce, 'HOST_PROBE_BASELINE_FAILED');
      await this.docker(['run', '--detach', '--name', probeContainer, '--network', this.state.probeName,
        '--dns', '127.0.0.1', '--label', `${RUN_LABEL}=${nonce}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--user', '65534:65534', PINS.probeImage, 'node', '-e',
        `require('node:http').createServer((q,r)=>r.end(${JSON.stringify(nonce)})).listen(18180,'0.0.0.0')`]);
      const [other] = await this.inspect('container', [probeContainer]);
      const otherIp = other.NetworkSettings?.Networks?.[this.state.probeName]?.IPAddress;
      ensure(/^172\.30\.241\.[0-9]{1,3}$/.test(otherIp ?? ''), 'CONTROLLED_PROBE_IDENTITY_FAILED');
      const otherUrl = `http://${otherIp}:18180/`;
      let ready = false;
      for (let i = 0; i < 20 && !ready; i++) {
        try { ready = await (await fetch(otherUrl, { signal: AbortSignal.timeout(1000), redirect: 'error' })).text() === nonce; } catch {}
        if (!ready) await delay(100);
      }
      ensure(ready, 'CONTROLLED_PROBE_BASELINE_FAILED');
      const source = `
        import {Resolver} from 'node:dns/promises';
        const targets=${JSON.stringify({hostUrl, otherUrl})};
        const reaches=async url=>{try{await fetch(url,{redirect:'error',signal:AbortSignal.timeout(1800)});return true;}catch{return false;}};
        const internal=await reaches('http://kong:8000/auth/v1/health');
        const hostBlocked=!(await reaches(targets.hostUrl));
        const otherNetworkBlocked=!(await reaches(targets.otherUrl));
        let externalNameLookupFailed=false;
        try{await new Resolver({timeout:1000,tries:1}).resolve4(${JSON.stringify('genie-' + nonce + '.invalid')});}catch{externalNameLookupFailed=true;}
        const proof={internal,hostBlocked,otherNetworkBlocked,externalNameLookupFailed};
        console.log(JSON.stringify(proof));process.exit(Object.values(proof).every(Boolean)?0:1);
      `;
      const result = await this.docker(['run', '--rm', '--network', 'container:' + container.Id,
        '--label', `${RUN_LABEL}=${nonce}`, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--user', '65534:65534', PINS.probeImage, 'node', '--input-type=module', '-e', source], { allowFailure: true, timeout: 20_000 });
      ensure(result.status === 0 && hostHits === 1, 'ACTUAL_NETWORK_EGRESS_NOT_BLOCKED');
      const proof = JSON.parse(result.stdout.trim());
      ensure(proof.internal === true && proof.hostBlocked === true && proof.otherNetworkBlocked === true && proof.externalNameLookupFailed === true,
        'NETWORK_PROBE_INCOMPLETE');
      ensure(await (await fetch(otherUrl, { signal: AbortSignal.timeout(2000), redirect: 'error' })).text() === nonce,
        'CONTROLLED_PROBE_STOPPED_DURING_CHECK');
      this.probeProof.push({ phase, ...proof, upstreamDns: 'container-loopback-only' });
    } finally {
      await new Promise(resolve => server.close(resolve));
      await this.docker(['rm', '-f', probeContainer], { allowFailure: true, cleanup: true });
    }
  }
  async verifyCore() {
    const containers = await this.stackContainers(false);
    await this.probeNamespace(containers.kong, 'core-network');
    this.coreVerified = true;
  }
  async installFixture() {
    ensure(this.coreVerified, 'NETWORK_GUARD_REQUIRED_BEFORE_FIXTURE_COPY');
    for (const file of FIXTURE_FILES) {
      const destination = path.join(this.state.workspace, 'supabase/functions', file);
      mkdirSync(path.dirname(destination), { recursive: true }); copyFileSync(path.join(this.inputs.fixtureRoot, file), destination);
    }
    writeFileSync(path.join(this.state.workspace, 'supabase/config.toml'), stackConfig(this.state.projectId, true), { mode: 0o600 });
    this.edgeEnv = { ...this.cliEnv, GENIE_EDGE_NETGUARD: 'docker-internal-verified',
      GENIE_EDGE_ANON_JWT: this.keys.anon, GENIE_EDGE_WRITER_JWT: this.keys.writer };
    await this.command('EDGE_CONFIG_INVALID', this.cli, ['config', 'validate', '--workdir', this.state.workspace], { env: this.edgeEnv });
  }
  async startEdge() {
    this.serving = launch(this.cli, ['functions', 'serve', 'vs-decide', '--workdir', this.state.workspace,
      '--network-id', this.state.networkName], { cwd: this.state.workspace, env: this.edgeEnv });
    this.state.edgePid = this.serving.child.pid; this.save();
    try {
      let ready = false;
      for (let i = 0; i < 60 && !ready; i++) {
        ensure(!this.serving.isStopped() && !this.signal?.aborted, 'LOCAL_EDGE_START_FAILED');
        try { ready = (await fetch(ORIGIN + '/functions/v1/_internal/health',
          { headers: { apikey: this.keys.anon }, signal: AbortSignal.timeout(1000), redirect: 'error' })).ok; } catch {}
        if (!ready) await delay(500);
      }
      ensure(ready, 'LOCAL_EDGE_READINESS_UNCONFIRMED');
    } catch (error) { this.recordFailure('LOCAL_EDGE_START_FAILED', this.serving.failure()); throw error; }
  }
  async verifyEdge() {
    const containers = await this.stackContainers(true);
    await this.probeNamespace(containers.edge_runtime, 'edge-network');
    this.verifiedProxyProof = this.proxies.map(proxy => proxy.proof());
    this.edgeVerified = true;
  }
  async verifyIntegration() {
    ensure(this.edgeVerified, 'NETWORK_GUARD_REQUIRED_BEFORE_TEST_USERS');
    const requests = []; let requestCount = 0;
    try {
      await verifyLocalIntegration({ GENIE_SUPABASE_URL: ORIGIN, GENIE_CONFIRM: 'isolated-genie-synthetic-only',
        GENIE_SUPABASE_PUBLIC_KEY: this.keys.anon }, '--run', {
        send: async (url, options) => {
          ensure(!this.signal?.aborted, 'LOCAL_CHECK_INTERRUPTED');
          const entry = { number: ++requestCount, ...integrationRequestDiagnostic(url, options) };
          requests.push(entry); if (requests.length > 12) requests.shift();
          try {
            const response = await this.send(url, { ...options,
              signal: this.signal ? AbortSignal.any([options.signal, this.signal]) : options.signal });
            entry.status = response.status;
            return response;
          } catch { entry.transportFailed = true; fail('LOCAL_INTEGRATION_TRANSPORT_FAILED'); }
        }, log: () => {}, warn: () => {} });
    } catch (error) {
      this.diagnostics.push(integrationFailureDiagnostic(error, requests, requestCount));
      fail('LOCAL_INTEGRATION_FAILED');
    }
    this.integrationVerified = true;
    const after = readPinnedInputs(this.repoRoot);
    ensure(JSON.stringify(after.hashes) === JSON.stringify(this.inputs.hashes), 'FIXTURE_SOURCE_CHANGED_DURING_CHECK');
  }
  async reportingDatabase() {
    ensure(this.integrationVerified === true && this.edgeVerified === true, 'BASELINE_REQUIRED_BEFORE_REPORT_PROPOSAL');
    const [net] = await this.inspect('network', [this.state.networkName]);
    const current = validateNetwork(net, this.state.networkName);
    ensure(current.id === this.network.id && net.Labels?.[RUN_LABEL] === this.state.nonce, 'REPORT_DATABASE_NETWORK_IDENTITY_FAILED');
    const containers = await this.stackContainers(true);
    return containers.db;
  }
  async reportingSql(stage, input) {
    ensure(['LOCAL_REPORT_PROPOSAL_APPLY_FAILED', 'LOCAL_REPORT_ROLE_CHECK_FAILED', 'LOCAL_REPORT_AUDIT_FAILED',
      'LOCAL_QUESTION_PROPOSAL_APPLY_FAILED', 'LOCAL_QUESTION_ROLE_CHECK_FAILED', 'LOCAL_QUESTION_AUDIT_FAILED'].includes(stage) &&
      typeof input === 'string' && input.length < 32_000, 'LOCAL_REPORT_SQL_REFUSED');
    const db = stage.startsWith('LOCAL_QUESTION_') ? await this.questionSafetyDatabase() : await this.reportingDatabase();
    // This is the exact owned container, not a host/remote DB connection. SQL and
    // UUID parameters go through stdin, never process argv or diagnostic output.
    return this.command(stage, this.tools.docker,
      ['exec', '--user', 'postgres', '-i', db.Id, 'psql', '-X', '-q', '-A', '-t', '-w', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'],
      { input, timeout: 30_000 });
  }
  async installReportingProposal() {
    await this.reportingDatabase();
    const proposal = readFileSync(this.inputs.reportingProposal);
    ensure(digest(proposal) === PINS.reportingProposalSha256, 'PINNED_REPORT_PROPOSAL_REQUIRED');
    await this.reportingSql('LOCAL_REPORT_PROPOSAL_APPLY_FAILED',
      "set genie.allow_local_reporting_proposal = 'on';\n" + proposal.toString('utf8') + "\nnotify pgrst, 'reload schema';\n");
    const roles = await this.reportingSql('LOCAL_REPORT_ROLE_CHECK_FAILED', REPORT_ROLE_CHECK_SQL);
    ensure(roles.stdout.trim() === 'REPORT_ROLE_CHECKS_PASSED', 'LOCAL_REPORT_ROLE_CHECK_FAILED');
    this.reportingApplied = true;
  }
  async verifyReporting() {
    ensure(this.reportingApplied === true, 'LOCAL_REPORT_PROPOSAL_NOT_APPLIED');
    const requests = [];
    try {
      this.reportingProof = await verifyLocalReporting({ GENIE_SUPABASE_URL: ORIGIN,
        GENIE_CONFIRM: 'isolated-genie-synthetic-only', GENIE_SUPABASE_PUBLIC_KEY: this.keys.anon }, '--run', {
        verifyOwnership: async () => { await this.reportingDatabase(); },
        inspectState: async scope => {
          const sql = reportingAuditSql(scope);
          ensure(!this.reportingScope || JSON.stringify(scope) === JSON.stringify(this.reportingScope), 'LOCAL_REPORT_SCOPE_CHANGED');
          this.reportingScope ??= Object.freeze({ ...scope });
          const result = await this.reportingSql('LOCAL_REPORT_AUDIT_FAILED', sql);
          try { return JSON.parse(result.stdout.trim()); } catch { fail('REPORT_QA_AUDIT_INVALID'); }
        },
        send: (url, options) => {
          ensure(!this.signal?.aborted, 'LOCAL_CHECK_INTERRUPTED');
          return this.send(url, { ...options,
            signal: this.signal ? AbortSignal.any([options.signal, this.signal]) : options.signal });
        },
        observe: item => {
          if (!REPORT_HTTP_CHECKS.includes(item.check)) return;
          // Fields originate from the fixed request builder, never server bodies.
          requests.push({ number: item.number, check: item.check, method: item.method, route: item.route,
            status: Number.isInteger(item.status) && item.status >= 100 && item.status <= 599 ? item.status : null,
            ...(item.transportFailed === true ? { transportFailed: true } : {}) });
          if (requests.length > 12) requests.shift();
        },
      });
      await this.reportingDatabase();
      readPinnedInputs(this.repoRoot);
      this.reportingVerified = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const assertion = [...REPORT_CHECK_CODES, 'LOCAL_REPORT_SCOPE_CHANGED', 'LOCAL_REPORT_AUDIT_FAILED',
        'REPORT_DATABASE_NETWORK_IDENTITY_FAILED', 'LOCAL_CHECK_INTERRUPTED'].includes(message)
        ? message : 'REPORT_QA_RUNTIME_FAILED';
      this.diagnostics.push({ stage: 'LOCAL_REPORTING_CHECK_FAILED', assertion, requests });
      fail('LOCAL_REPORTING_CHECK_FAILED');
    }
  }
  async questionSafetyDatabase() {
    ensure(this.reportingVerified === true, 'REPORTING_REQUIRED_BEFORE_QUESTION_PROPOSAL');
    return this.reportingDatabase();
  }
  async installQuestionSafetyProposal() {
    await this.questionSafetyDatabase();
    const proposal = readFileSync(this.inputs.questionSafetyProposal);
    ensure(digest(proposal) === PINS.questionSafetyProposalSha256, 'PINNED_QUESTION_PROPOSAL_REQUIRED');
    await this.reportingSql('LOCAL_QUESTION_PROPOSAL_APPLY_FAILED',
      "set genie.allow_local_question_safety_proposal = 'on';\n" + proposal.toString('utf8') + "\nnotify pgrst, 'reload schema';\n");
    const roles = await this.reportingSql('LOCAL_QUESTION_ROLE_CHECK_FAILED', QUESTION_ROLE_CHECK_SQL);
    ensure(roles.stdout.trim() === 'QUESTION_ROLE_CHECKS_PASSED', 'LOCAL_QUESTION_ROLE_CHECK_FAILED');
    this.questionSafetyApplied = true;
  }
  async verifyQuestionSafety() {
    ensure(this.questionSafetyApplied === true, 'LOCAL_QUESTION_PROPOSAL_NOT_APPLIED');
    const requests = [];
    try {
      this.questionSafetyProof = await verifyLocalQuestionSafety({ GENIE_SUPABASE_URL: ORIGIN,
        GENIE_CONFIRM: 'isolated-genie-synthetic-only', GENIE_SUPABASE_PUBLIC_KEY: this.keys.anon }, '--run', {
        verifyOwnership: async () => { await this.questionSafetyDatabase(); },
        inspectState: async scope => {
          const sql = questionSafetyAuditSql(scope);
          ensure(!this.questionSafetyScope || JSON.stringify(scope) === JSON.stringify(this.questionSafetyScope), 'LOCAL_QUESTION_SCOPE_CHANGED');
          this.questionSafetyScope ??= Object.freeze({ ...scope });
          const result = await this.reportingSql('LOCAL_QUESTION_AUDIT_FAILED', sql);
          try { return JSON.parse(result.stdout.trim()); } catch { fail('QUESTION_QA_AUDIT_INVALID'); }
        },
        send: (url, options) => {
          ensure(!this.signal?.aborted, 'LOCAL_CHECK_INTERRUPTED');
          return this.send(url, { ...options,
            signal: this.signal ? AbortSignal.any([options.signal, this.signal]) : options.signal });
        },
        observe: item => {
          if (!QUESTION_HTTP_CHECKS.includes(item.check)) return;
          requests.push({ number: item.number, check: item.check, method: item.method, route: item.route,
            status: Number.isInteger(item.status) && item.status >= 100 && item.status <= 599 ? item.status : null,
            ...(item.transportFailed === true ? { transportFailed: true } : {}) });
          if (requests.length > 12) requests.shift();
        },
      });
      await this.questionSafetyDatabase(); readPinnedInputs(this.repoRoot);
      this.questionSafetyVerified = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const assertion = [...QUESTION_CHECK_CODES, 'LOCAL_QUESTION_SCOPE_CHANGED', 'LOCAL_QUESTION_AUDIT_FAILED',
        'REPORT_DATABASE_NETWORK_IDENTITY_FAILED', 'LOCAL_CHECK_INTERRUPTED'].includes(message)
        ? message : 'QUESTION_QA_RUNTIME_FAILED';
      this.diagnostics.push({ stage: 'LOCAL_QUESTION_SAFETY_CHECK_FAILED', assertion, requests });
      fail('LOCAL_QUESTION_SAFETY_CHECK_FAILED');
    }
  }
  receipt() {
    return { status: 'local-supabase-integration-passed-not-a-release',
      sourceCommit: /^[0-9a-f]{40}$/.test(this.env.GITHUB_SHA ?? '') ? this.env.GITHUB_SHA : null,
      cliVersion: PINS.cliVersion, cliArchiveSha256: PINS.cliSha256, dockerVersion: this.dockerVersion,
      node: process.version, approvedOrigin: ORIGIN, schemaSha256: PINS.schemaSha256,
      fixtureHashes: this.inputs.hashes, serviceImages: this.imageProof, networkProof: this.probeProof,
      loopbackProxies: this.verifiedProxyProof, loopbackProxiesClosed: true,
      realLocalAuthPostgrestAndEdge: true, twoSessionFlowVerified: this.integrationVerified === true,
      reportingProposal: { ...this.reportingProof, verified: this.reportingVerified === true,
        sourceSha256: PINS.reportingProposalSha256, directPostgresRoleDenialsVerified: this.reportingApplied === true,
        roleCheckTransactionRolledBack: true, appliedOnlyToDisposableDatabase: true },
      questionSafetyProposal: { ...this.questionSafetyProof, verified: this.questionSafetyVerified === true,
        sourceSha256: PINS.questionSafetyProposalSha256, directPostgresRoleDenialsVerified: this.questionSafetyApplied === true,
        roleCheckTransactionRolledBack: true, appliedOnlyToDisposableDatabase: true },
      modelCalled: false, hostedProjectContacted: false, productionFilesChanged: false,
      nativeDeviceVerified: false, storeSubmitted: false, disposableResourcesDeleted: true };
  }
  async cleanup() {
    if (!this.state.workspace) return true;
    let okay = true;
    for (const result of await Promise.allSettled((this.proxies ?? []).map(proxy => proxy.close()))) {
      if (result.status !== 'fulfilled' || result.value !== true) okay = false;
    }
    try { await this.serving?.stop(); } catch { okay = false; }
    if (this.tools?.docker) {
      try {
        const own = await this.docker(['ps', '-aq', '--filter', `label=${RUN_LABEL}=${this.state.nonce}`], { cleanup: true });
        const project = await this.docker(['ps', '-aq', '--filter', `label=${PROJECT_LABEL}=${this.state.projectId}`], { cleanup: true });
        const ids = [...new Set((own.stdout + '\n' + project.stdout).trim().split(/\s+/).filter(Boolean))];
        if (ids.length) {
          ensure(ids.every(id => /^[0-9a-f]{12,64}$/.test(id)), 'INVALID_CLEANUP_CONTAINER_ID');
          await this.docker(['rm', '-f', '-v', ...ids], { cleanup: true });
        }
        const volumes = (await this.docker(['volume', 'ls', '-q', '--filter', `label=${PROJECT_LABEL}=${this.state.projectId}`], { cleanup: true })).stdout.trim().split(/\s+/).filter(Boolean);
        if (volumes.length) {
          ensure(volumes.every(name => /^[a-zA-Z0-9_-]+$/.test(name)), 'INVALID_CLEANUP_VOLUME_ID');
          await this.docker(['volume', 'rm', ...volumes], { cleanup: true });
        }
        ensure((await this.docker(['ps', '-aq', '--filter', `label=${PROJECT_LABEL}=${this.state.projectId}`], { cleanup: true })).stdout.trim() === '' &&
          (await this.docker(['ps', '-aq', '--filter', `label=${RUN_LABEL}=${this.state.nonce}`], { cleanup: true })).stdout.trim() === '' &&
          (await this.docker(['volume', 'ls', '-q', '--filter', `label=${PROJECT_LABEL}=${this.state.projectId}`], { cleanup: true })).stdout.trim() === '',
        'DISPOSABLE_DATA_REMAINS');
      } catch { okay = false; }
    }
    let firewallAccessible = false;
    if (this.state.firewallRemovals.length) {
      try {
        await this.command('SCOPED_FIREWALL_CLEANUP_FAILED', this.tools.sudo,
          ['-n', this.tools.iptables, '-w', '5', '-S'], { cleanup: true });
        firewallAccessible = true;
      } catch { okay = false; }
    }
    for (const args of [...this.state.firewallRemovals].reverse()) {
      if (!firewallAccessible) break;
      try {
        const check = args[0] === '-X' ? ['-S', args[1]] : ['-C', ...args.slice(1)];
        const present = await this.command('SCOPED_FIREWALL_CLEANUP_FAILED', this.tools.sudo,
          ['-n', this.tools.iptables, '-w', '5', ...check], { cleanup: true, allowFailure: true });
        if (present.status === 0) await this.command('SCOPED_FIREWALL_CLEANUP_FAILED', this.tools.sudo,
          ['-n', this.tools.iptables, '-w', '5', ...args], { cleanup: true });
        else ensure(present.status === 1, 'SCOPED_FIREWALL_CLEANUP_FAILED');
      } catch { okay = false; }
    }
    for (const name of [...this.state.networks].reverse()) {
      try {
        const all = (await this.docker(['network', 'ls', '--format', '{{.Name}}'], { cleanup: true })).stdout.trim().split(/\s+/);
        if (all.includes(name)) {
          const [network] = await this.inspect('network', [name], { cleanup: true });
          ensure(network.Labels?.[RUN_LABEL] === this.state.nonce, 'NETWORK_CLEANUP_IDENTITY_MISMATCH');
          await this.docker(['network', 'rm', name], { cleanup: true });
        }
      } catch { okay = false; }
    }
    if (okay) {
      try { rmSync(this.state.workspace, { recursive: true, force: true }); rmSync(statePath(this.env), { force: true }); } catch { okay = false; }
    }
    this.keys = undefined; this.edgeEnv = undefined; this.reportingScope = undefined; this.questionSafetyScope = undefined;
    return okay;
  }
}

/** Injected runtime tests exercise failure/cleanup order without Docker or network. */
export async function runLocalStackCheck({ repoRoot = defaultRepo, env = process.env, allowDownloads = false,
  signal, runtime, progress = () => {} } = {}) {
  try { validateInvocation(env, allowDownloads); } catch (error) { return { ok: false, code: fixedCode(error) }; }
  const actions = runtime ?? new DockerStackRuntime({ repoRoot, env, signal });
  let error, complete = false, cleaned = false;
  try {
    for (const stage of ['preflight', 'prepare', 'isolate', 'startCore', 'verifyCore', 'installFixture', 'startEdge', 'verifyEdge',
      'verifyIntegration', 'installReportingProposal', 'verifyReporting', 'installQuestionSafetyProposal', 'verifyQuestionSafety']) {
      progress(stage); await actions[stage]();
    }
    complete = true;
  } catch (caught) { error = fixedCode(caught); }
  finally { try { cleaned = await actions.cleanup() === true; } catch {} }
  const diagnostics = actions.diagnostics?.length ? { diagnostics: actions.diagnostics } : {};
  if (!cleaned) return { ok: false, code: 'DISPOSABLE_CLEANUP_UNCONFIRMED', cause: error ?? null, ...diagnostics };
  if (!complete) return { ok: false, code: error ?? 'LOCAL_STACK_CHECK_INCOMPLETE', ...diagnostics };
  return { ok: true, receipt: actions.receipt() };
}

export async function cleanupInterruptedRun(env = process.env) {
  validateInvocation(env, true);
  const marker = statePath(env);
  if (!existsSync(marker)) return true;
  ensure(regular(marker), 'UNSAFE_CLEANUP_STATE');
  const state = JSON.parse(readFileSync(marker, 'utf8'));
  ensure(state.schemaVersion === 1 && /^[0-9a-f]{12}$/.test(state.nonce ?? '') &&
    state.projectId === 'genie_it_' + state.nonce && state.networkName === 'genie-local-' + state.nonce &&
    state.probeName === state.networkName + '-probe' && state.runId === env.GITHUB_RUN_ID && state.runAttempt === env.GITHUB_RUN_ATTEMPT &&
    path.dirname(state.workspace) === env.RUNNER_TEMP && path.basename(state.workspace).startsWith('genie-local-stack-work-') &&
    (!existsSync(state.workspace) || !lstatSync(state.workspace).isSymbolicLink()) &&
    state.networks.every(name => [state.networkName, state.probeName].includes(name)), 'UNSAFE_CLEANUP_STATE');
  const runtime = new DockerStackRuntime({ repoRoot: defaultRepo, env });
  runtime.state = state; runtime.baseEnv = localEnvironment(env, state.workspace);
  runtime.tools = Object.fromEntries(['docker', 'sudo', 'iptables'].map(name => [name, executable(name, env)]));
  const allowed = firewallPlan({ bridge: 'br-' + '0'.repeat(12), cidr: PINS.networkCidr }, state.nonce).entries.map(entry => entry.remove);
  ensure(Array.isArray(state.firewallRemovals) && state.firewallRemovals.every(args => {
    const normalized = args.map(arg => /^br-[0-9a-f]{12}$/.test(arg) ? 'br-' + '0'.repeat(12) : arg);
    return allowed.some(value => JSON.stringify(value) === JSON.stringify(normalized));
  }), 'UNSAFE_CLEANUP_FIREWALL_RULES');
  if (Number.isSafeInteger(state.edgePid) && state.edgePid > 1) {
    try {
      const cwd = realpathSync(`/proc/${state.edgePid}/cwd`);
      const exe = realpathSync(`/proc/${state.edgePid}/exe`);
      if (cwd === state.workspace && exe === path.join(state.workspace, 'bin/supabase')) process.kill(-state.edgePid, 'SIGTERM');
    } catch {}
  }
  return runtime.cleanup();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const abort = new AbortController();
  process.once('SIGTERM', () => abort.abort()); process.once('SIGINT', () => abort.abort());
  try {
    if (process.argv.length === 3 && process.argv[2] === '--cleanup') {
      ensure(await cleanupInterruptedRun(), 'DISPOSABLE_CLEANUP_UNCONFIRMED');
      console.log('Disposable local-stack cleanup confirmed or no run state exists.');
    } else {
      const result = await runLocalStackCheck({ allowDownloads: process.argv.length === 3 && process.argv[2] === '--run-isolated',
        signal: abort.signal, progress: stage => console.log('Local isolated check: ' + stage) });
      if (!result.ok) {
        console.error('Local isolated check stopped: ' + result.code);
        for (const diagnostic of result.diagnostics ?? []) console.error('Local isolated diagnostic: ' + JSON.stringify(diagnostic));
        process.exitCode = 1;
      }
      else console.log('GENIE_LOCAL_INTEGRATION_RECEIPT ' + JSON.stringify(result.receipt));
    }
  } catch (error) { console.error('Local isolated check stopped: ' + fixedCode(error)); process.exitCode = 1; }
}
