// App Store Connect API helper for the Genie iOS build (read app/builds, reuse or create ONE App Store profile).
// Never prints secrets, the JWT, or profile contents. Creates nothing except an IOS_APP_STORE profile
// (approved by the owner). Never creates apps, bundle IDs, certificates or keys, and never uploads builds.
//
// Usage: node asc.mjs plan <certSerialHex> <bundleId>   -> writes JSON to $ASC_OUT
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 (PEM text or base64 of it), ASC_OUT, PROFILE_OUT (path for .mobileprovision)
import { createPrivateKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com';
const fail = (code) => { console.error(`ASC_FAIL ${code}`); process.exit(1); };

function key() {
  let pem = process.env.ASC_KEY_P8 || '';
  if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
  if (!pem.includes('BEGIN PRIVATE KEY')) fail('KEY_FORMAT');
  return createPrivateKey(pem);
}
const b64u = (b) => Buffer.from(b).toString('base64url');
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: key(), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}
const token = jwt();
async function call(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try { detail = (JSON.parse(text).errors || []).map((e) => `${e.code}:${e.title}`).join('; '); } catch {}
    fail(`HTTP_${res.status} ${init.method || 'GET'} ${path.split('?')[0]} ${detail}`.slice(0, 300));
  }
  return JSON.parse(text);
}
async function all(path) {
  const out = []; let next = path;
  while (next) { const r = await call(next); out.push(...r.data); next = r.links?.next ? r.links.next.replace(API, '') : null; }
  return out;
}

const [, , mode, certSerialArg, bundleId] = process.argv;
if (mode !== 'plan' || !certSerialArg || !bundleId) fail('USAGE');
const certSerial = certSerialArg.replace(/^0+/, '').toUpperCase();

// 1. Existing App Store Connect app (read-only; never created here)
const apps = await all(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=name,bundleId,sku,primaryLocale`);
const app = apps.find((a) => a.attributes.bundleId === bundleId);
if (!app) fail('APP_NOT_FOUND_IN_APP_STORE_CONNECT');

// 2. Existing build numbers (all versions/trains) -> next unique build number
const builds = await all(`/v1/builds?filter[app]=${app.id}&fields[builds]=version,uploadedDate,processingState&limit=200`);
const nums = builds.map((b) => b.attributes.version).filter((v) => /^\d+$/.test(v)).map(Number);
const nonNumeric = builds.map((b) => b.attributes.version).filter((v) => !/^\d+$/.test(v));
const buildNumber = String((nums.length ? Math.max(...nums) : 0) + 1);

// 3. Registered bundle ID (must already exist; never created here)
const bids = await all(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&fields[bundleIds]=identifier,platform,seedId`);
const bid = bids.find((b) => b.attributes.identifier === bundleId);
if (!bid) fail('BUNDLE_ID_NOT_REGISTERED');

// 4. The provided distribution certificate must be an existing, valid certificate on this team
const certs = await all(`/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&fields[certificates]=serialNumber,expirationDate,certificateType,displayName,name&limit=200`);
const cert = certs.find((c) => String(c.attributes.serialNumber).replace(/^0+/, '').toUpperCase() === certSerial);
if (!cert) fail('PROVIDED_CERT_NOT_ON_THIS_TEAM');
if (new Date(cert.attributes.expirationDate) <= new Date()) fail('CERT_EXPIRED');

// 5. Reuse an active App Store profile for this bundle ID that contains this certificate; otherwise create one
const profiles = await all(`/v1/bundleIds/${bid.id}/profiles?fields[profiles]=name,profileType,profileState,expirationDate,uuid,profileContent&limit=200`);
let chosen = null; let created = false;
for (const p of profiles) {
  const a = p.attributes;
  if (a.profileType !== 'IOS_APP_STORE' || a.profileState !== 'ACTIVE' || new Date(a.expirationDate) <= new Date()) continue;
  const pc = await call(`/v1/profiles/${p.id}/certificates?fields[certificates]=serialNumber&limit=200`);
  if (pc.data.some((c) => c.id === cert.id)) { chosen = p; break; }
}
if (!chosen) {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await call('/v1/profiles', { method: 'POST', body: JSON.stringify({ data: { type: 'profiles',
    attributes: { name: `Genie App Store CI ${stamp}`, profileType: 'IOS_APP_STORE' },
    relationships: { bundleId: { data: { type: 'bundleIds', id: bid.id } },
      certificates: { data: [{ type: 'certificates', id: cert.id }] } } } }) });
  chosen = r.data; created = true;
}
writeFileSync(process.env.PROFILE_OUT, Buffer.from(chosen.attributes.profileContent, 'base64'));

const plan = {
  app: { id: app.id, name: app.attributes.name, bundleId: app.attributes.bundleId, sku: app.attributes.sku },
  existingBuildCount: builds.length, existingNumericBuildMax: nums.length ? Math.max(...nums) : null,
  nonNumericBuildVersions: nonNumeric, buildNumber,
  bundleIdResource: { id: bid.id, platform: bid.attributes.platform, teamId: bid.attributes.seedId },
  certificate: { id: cert.id, type: cert.attributes.certificateType, name: cert.attributes.displayName || cert.attributes.name,
    serialNumber: cert.attributes.serialNumber, expirationDate: cert.attributes.expirationDate },
  profile: { id: chosen.id, name: chosen.attributes.name, uuid: chosen.attributes.uuid,
    expirationDate: chosen.attributes.expirationDate, createdThisRun: created },
};
writeFileSync(process.env.ASC_OUT, JSON.stringify(plan, null, 2));
console.log(`ASC_OK app=${plan.app.id} nextBuild=${buildNumber} team=${plan.bundleIdResource.teamId} profileCreated=${created} profileExpires=${plan.profile.expirationDate}`);
