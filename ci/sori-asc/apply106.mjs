// Owner-approved (2026-11-28) App Store Connect changes for Sori iOS 1.0.6 paid launch.
// Does: create version 1.0.6 with build 20 (if missing), set the final review note on both subscriptions,
// add a 7-day FREE_TRIAL introductory offer in every territory where the subscription is available.
// Does NOT: submit for review, add items to a review submission, change prices, or touch metadata/screenshots.
import { createPrivateKey, sign } from 'node:crypto';
const API = 'https://api.appstoreconnect.apple.com';
const APP = '6829086592';
const SUBS = { '6829165943': 'sori_premium_annual', '6829165638': 'sori_premium_monthly' };
const NOTE = `Sori Premium unlocks Level 2–5 lessons, story-course episodes after the first episode of each course, video stories after episodes 1 and 2, a higher daily AI tutor message limit, and additional TOPIK practice.

What stays free: Level 1 lessons, video episodes 1 and 2 (café and convenience store), the first episode of each story course, and 5 AI tutor messages a day. The first TOPIK I reading practice set and one TOPIK I mock test also stay free. Other TOPIK practice (listening, TOPIK II, writing, and further mock tests) is included in Premium.

To view the subscription screen: after setup, a café video opens. Tap Skip or finish the video, and a Premium offer appears (you can close it). To open the screen again, go to the Lessons tab, switch to Level 2, and tap any locked lesson. You can also open the Me tab and tap Premium. The screen lists annual and monthly plans with prices from the App Store. Restore Purchases is at the top right. If the App Store account is eligible for an introductory offer, the screen shows a free trial. Eligibility is decided by the App Store.`;
let pem = process.env.ASC_KEY_P8 || '';
if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
const b64u = (b) => Buffer.from(b).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
const p = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
const token = `${h}.${p}.${b64u(sign('sha256', Buffer.from(`${h}.${p}`), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' }))}`;
async function call(method, path, body) {
  if (!['GET', 'POST', 'PATCH'].includes(method)) throw new Error('method');
  if (/reviewSubmission|subscriptionSubmission|subscriptionGroupSubmission|appStoreVersionSubmission|Prices|pricePoints/i.test(path) && method !== 'GET') throw new Error('blocked path');
  const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) { let d = ''; try { d = JSON.parse(t).errors.map((e) => `${e.code}:${e.detail || e.title}`).join('; '); } catch {} return { error: `HTTP_${r.status} ${d}`.slice(0, 400) }; }
  return t ? JSON.parse(t) : {};
}
async function all(path) { const out = []; let next = path; while (next) { const r = await call('GET', next); if (r.error) return r; out.push(...r.data); next = r.links?.next ? r.links.next.replace(API, '') : null; } return out; }
const report = {};
let failed = false;

// 1. Version 1.0.6 + build 20
const versions = await all(`/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&filter[versionString]=1.0.6&fields[appStoreVersions]=versionString,appStoreState`);
const builds = await all(`/v1/builds?filter[app]=${APP}&filter[version]=20&filter[preReleaseVersion.version]=1.0.6&fields[builds]=version,processingState`);
const build = Array.isArray(builds) ? builds.find((b) => b.attributes.processingState === 'VALID') : null;
if (!build) { report.version = { error: 'BUILD_20_1.0.6_NOT_VALID', builds }; failed = true; }
else if (versions.error) { report.version = versions; failed = true; }
else if (versions.length) {
  const v = versions[0];
  const r = await call('PATCH', `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
  report.version = { action: 'existing-version-build-set', state: v.attributes.appStoreState, result: r.error || 'ok' }; if (r.error) failed = true;
} else {
  const r = await call('POST', '/v1/appStoreVersions', { data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: '1.0.6' },
    relationships: { app: { data: { type: 'apps', id: APP } }, build: { data: { type: 'builds', id: build.id } } } } });
  report.version = r.error ? { action: 'create', error: r.error } : { action: 'created', id: r.data.id, state: r.data.attributes.appStoreState, build: 20 };
  if (r.error) failed = true;
}

// 2 + 3. Subscriptions
report.subscriptions = {};
const today = new Date().toISOString().slice(0, 10);
for (const [id, pid] of Object.entries(SUBS)) {
  const s = { };
  const n = await call('PATCH', `/v1/subscriptions/${id}`, { data: { type: 'subscriptions', id, attributes: { reviewNote: NOTE } } });
  s.reviewNote = n.error || (n.data.attributes.reviewNote === NOTE ? 'set-final' : 'mismatch'); if (n.error || s.reviewNote === 'mismatch') failed = true;
  const avail = await call('GET', `/v1/subscriptions/${id}/subscriptionAvailability?include=availableTerritories&limit[availableTerritories]=200`);
  let territories = [];
  if (avail.error) { s.availability = avail.error; } else {
    const rel = await all(`/v1/subscriptionAvailabilities/${avail.data.id}/availableTerritories?limit=200&fields[territories]=currency`);
    territories = Array.isArray(rel) ? rel.map((t) => t.id) : [];
    if (!Array.isArray(rel)) s.availability = rel.error;
  }
  if (!territories.length) {
    const prices = await all(`/v1/subscriptions/${id}/prices?include=territory&limit=200`);
    if (Array.isArray(prices)) territories = [...new Set(prices.map((x) => x.relationships?.territory?.data?.id).filter(Boolean))];
    s.territorySource = 'prices';
  }
  const existing = await all(`/v1/subscriptions/${id}/introductoryOffers?include=territory&limit=200`);
  const have = new Set(Array.isArray(existing) ? existing.map((o) => o.relationships?.territory?.data?.id).filter(Boolean) : []);
  let created = 0; const errors = {};
  for (const t of territories) {
    if (have.has(t)) continue;
    const r = await call('POST', '/v1/subscriptionIntroductoryOffers', { data: { type: 'subscriptionIntroductoryOffers',
      attributes: { duration: 'ONE_WEEK', offerMode: 'FREE_TRIAL', numberOfPeriods: 1, startDate: today },
      relationships: { subscription: { data: { type: 'subscriptions', id } }, territory: { data: { type: 'territories', id: t } } } } });
    if (r.error) errors[t] = r.error; else created++;
  }
  s.territories = territories.length; s.alreadyHadOffer = have.size; s.introOffersCreated = created;
  s.introErrors = Object.keys(errors).length; if (s.introErrors) { s.firstErrors = Object.entries(errors).slice(0, 5); failed = true; }
  if (!territories.length) failed = true;
  const after = await all(`/v1/subscriptions/${id}/introductoryOffers?limit=200&fields[subscriptionIntroductoryOffers]=offerMode,duration,numberOfPeriods`);
  s.introOffersNow = Array.isArray(after) ? after.length : after.error;
  s.introModesNow = Array.isArray(after) ? [...new Set(after.map((o) => `${o.attributes.offerMode}/${o.attributes.duration}/${o.attributes.numberOfPeriods}`))] : [];
  report.subscriptions[pid] = s;
}
console.log('SORI_ASC_106 ' + JSON.stringify(report, null, 2));
if (failed) process.exit(1);
