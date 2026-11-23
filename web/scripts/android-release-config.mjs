import { isIP } from 'node:net';

const FIELDS = Object.freeze({
  applicationId: 'GENIE_ANDROID_APPLICATION_ID',
  versionCode: 'GENIE_ANDROID_VERSION_CODE',
  versionName: 'GENIE_ANDROID_VERSION_NAME',
  supabaseUrl: 'VITE_SUPABASE_URL',
  publishableKey: 'VITE_SUPABASE_PUBLISHABLE_KEY',
  publicAppUrl: 'VITE_PUBLIC_APP_URL',
});
const REQUIRED_FIELDS = Object.values(FIELDS);
const PUBLIC_FIELDS = new Set([FIELDS.supabaseUrl, FIELDS.publishableKey, FIELDS.publicAppUrl]);
const ERROR_FIELDS = new Set([...REQUIRED_FIELDS, 'VITE_*', 'environment']);
const ERROR_MESSAGES = Object.freeze({
  MISSING: 'Required release configuration is missing.',
  INVALID_ENV: 'Release configuration must be an explicit environment object.',
  INVALID_APPLICATION_ID: 'Use a lowercase Android application ID with at least two segments and no preview or placeholder segments.',
  INVALID_VERSION_CODE: 'Use an integer version code from 1 through 2100000000, without spaces or leading zeros.',
  INVALID_VERSION_NAME: 'Use a printable version name of 1 to 40 characters without whitespace, Preview, or Test.',
  INVALID_HTTPS_ORIGIN: 'Use a public HTTPS origin without credentials, a path, query, fragment, or a nondefault port.',
  INVALID_PUBLISHABLE_KEY: 'Use a nonplaceholder Supabase publishable key with the sb_publishable_ prefix; legacy JWT keys are not accepted.',
  UNEXPECTED_PUBLIC_VARIABLE: 'Remove public build variables outside the approved Supabase and public-app URL allowlist.',
  PUBLIC_SECRET: 'A public build variable appears to contain a private credential; remove it before building.',
});
const INVALID_APPLICATION_SEGMENTS = new Set(['preview', 'debug', 'test', 'demo', 'staging', 'localhost', 'example']);
const PRIVATE_SUFFIXES = ['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'corp', 'invalid', 'test', 'example', 'home.arpa'];
const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net'];

function isApplicationId(value) {
  if (value.length > 255 || /\s/u.test(value) || !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(value)) return false;
  const parts = value.split('.');
  if (parts.some(part => INVALID_APPLICATION_SEGMENTS.has(part))) return false;
  return value !== 'dev.local' && !value.startsWith('dev.local.');
}

function normalizePublicOrigin(value) {
  // URL alone normalizes away dot segments, backslashes, and some control characters.
  // Refuse those inputs before parsing so configuration errors cannot change meaning.
  if (/[\s\\\u0000-\u001f\u007f]/u.test(value) || !/^https:\/\/[^/?#]+\/?$/i.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash) return null;
  const host = url.hostname;
  if (isIP(host.replace(/^\[|\]$/g, '')) || host.length > 253 || host.endsWith('.')) return null;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  if (PRIVATE_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`)) ||
      RESERVED_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
  return url.origin;
}

function isPublishableKey(value) {
  if (value.length > 8192 || /\s/u.test(value)) return false;
  if (!value.startsWith('sb_publishable_')) return false;
  const suffix = value.slice('sb_publishable_'.length);
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(suffix) || /^(.)\1+$/.test(suffix)) return false;
  return !/^(?:your(?:[_-]?key)?|example|placeholder|changeme|replace(?:[_-]?me)?|test|demo|sample|dummy)(?:[_-]|$)/i.test(suffix);
}

function hasObviousPrivateCredential(value) {
  return /(?:^|[^A-Za-z0-9])(?:sk[_-]|sb_secret_|service_role(?:$|[^A-Za-z0-9]))/i.test(value);
}

/**
 * Validate only the supplied values. Never read env files, fetch account data, or choose
 * production identifiers. The returned config contains a public key and must not be logged.
 */
export function resolveAndroidReleaseConfig(env) {
  const errors = [];
  const add = (field, code) => {
    if (!errors.some(error => error.field === field && error.code === code)) {
      errors.push({ field, code, message: ERROR_MESSAGES[code] });
    }
  };
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    add('environment', 'INVALID_ENV');
    return { ok: false, errors };
  }
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(env); } catch {
    add('environment', 'INVALID_ENV');
    return { ok: false, errors };
  }
  const values = Object.create(null);
  for (const field of REQUIRED_FIELDS) {
    const descriptor = descriptors[field];
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined ||
        descriptor.value === null || (typeof descriptor.value === 'string' && descriptor.value.trim() === '')) {
      add(field, 'MISSING');
    } else values[field] = descriptor.value;
  }

  for (const [field, descriptor] of Object.entries(descriptors)) {
    if (!field.startsWith('VITE_')) continue;
    if (!PUBLIC_FIELDS.has(field)) add('VITE_*', 'UNEXPECTED_PUBLIC_VARIABLE');
    if ('value' in descriptor && typeof descriptor.value === 'string' && hasObviousPrivateCredential(descriptor.value)) {
      add(PUBLIC_FIELDS.has(field) ? field : 'VITE_*', 'PUBLIC_SECRET');
    }
  }

  const check = (field, code, validate) => {
    if (!(field in values)) return null;
    const value = values[field];
    if (typeof value !== 'string') { add(field, code); return null; }
    const result = validate(value);
    if (result === false || result === null) { add(field, code); return null; }
    return result === true ? value : result;
  };

  const applicationId = check(FIELDS.applicationId, 'INVALID_APPLICATION_ID', isApplicationId);
  const versionCode = check(FIELDS.versionCode, 'INVALID_VERSION_CODE', value => {
    if (/\s/u.test(value) || !/^[1-9]\d{0,9}$/.test(value)) return null;
    const parsed = Number(value);
    return parsed <= 2100000000 ? parsed : null;
  });
  const versionName = check(FIELDS.versionName, 'INVALID_VERSION_NAME', value =>
    value.length >= 1 && value.length <= 40 && !/\s/u.test(value) && /^[\x21-\x7e]+$/.test(value) && !/preview|test/i.test(value));
  const supabaseUrl = check(FIELDS.supabaseUrl, 'INVALID_HTTPS_ORIGIN', normalizePublicOrigin);
  const publishableKey = check(FIELDS.publishableKey, 'INVALID_PUBLISHABLE_KEY', isPublishableKey);
  const publicAppUrl = check(FIELDS.publicAppUrl, 'INVALID_HTTPS_ORIGIN', normalizePublicOrigin);

  if (errors.length) return { ok: false, errors };
  return { ok: true, config: {
    applicationId, appName: '결정해지니', versionCode, versionName, supabaseUrl, publishableKey, publicAppUrl,
  } };
}

/** Safe diagnostics contain only fixed field names and fixed error descriptions. */
export function describeAndroidReleaseConfigErrors(errors) {
  if (!Array.isArray(errors)) return ['environment: Release configuration is invalid.'];
  return errors.map(error => {
    const field = error && ERROR_FIELDS.has(error.field) ? error.field : 'environment';
    const message = error && Object.hasOwn(ERROR_MESSAGES, error.code)
      ? ERROR_MESSAGES[error.code] : 'Release configuration is invalid.';
    return `${field}: ${message}`;
  });
}
