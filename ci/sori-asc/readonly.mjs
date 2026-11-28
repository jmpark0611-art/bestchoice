// Read-only App Store Connect check for Sori (app 6829086592). GET requests only; prints states, never secrets.
import { createPrivateKey, sign } from 'node:crypto';
const API = 'https://api.appstoreconnect.apple.com';
const APP = '6829086592';
let pem = process.env.ASC_KEY_P8 || '';
if (!pem.includes('BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8');
const b64u = (b) => Buffer.from(b).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
const p = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
const token = `${h}.${p}.${b64u(sign('sha256', Buffer.from(`${h}.${p}`), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' }))}`;
async function get(path) {
  const r = await fetch(API + path, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  if (!r.ok) { let d = ''; try { d = JSON.parse(t).errors.map((e) => e.code).join(','); } catch {} return { error: `HTTP_${r.status} ${d}` }; }
  return JSON.parse(t);
}
const out = {};
const app = await get(`/v1/apps/${APP}?fields[apps]=name,bundleId`);
out.app = app.error || { name: app.data.attributes.name, bundleId: app.data.attributes.bundleId };
if (!app.error) {
  const v = await get(`/v1/apps/${APP}/appStoreVersions?filter[platform]=IOS&limit=5&fields[appStoreVersions]=versionString,appStoreState,appVersionState,createdDate&include=build&fields[builds]=version,processingState`);
  out.versions = v.error || v.data.map((x) => ({ version: x.attributes.versionString, appStoreState: x.attributes.appStoreState,
    appVersionState: x.attributes.appVersionState, build: (v.included || []).find((b) => b.id === x.relationships?.build?.data?.id)?.attributes?.version ?? null }));
  const b = await get(`/v1/builds?filter[app]=${APP}&sort=-uploadedDate&limit=4&fields[builds]=version,processingState,uploadedDate,expired&include=preReleaseVersion&fields[preReleaseVersions]=version`);
  out.recentBuilds = b.error || b.data.map((x) => ({ build: x.attributes.version, processingState: x.attributes.processingState,
    uploaded: x.attributes.uploadedDate, appVersion: (b.included || []).find((pv) => pv.id === x.relationships?.preReleaseVersion?.data?.id)?.attributes?.version }));
  const g = await get(`/v1/apps/${APP}/subscriptionGroups?fields[subscriptionGroups]=referenceName&limit=20`);
  if (g.error) out.subscriptionGroups = g.error;
  else {
    out.subscriptionGroups = [];
    for (const grp of g.data) {
      const subs = [];
      const gs = await get(`/v1/subscriptionGroups/${grp.id}/subscriptions?fields[subscriptions]=productId,name,state,reviewNote,subscriptionPeriod&limit=50`);
      if (gs.error) { out.subscriptionGroups.push({ id: grp.id, error: gs.error }); continue; }
      for (const s of gs.data) {
        const intro = await get(`/v1/subscriptions/${s.id}/introductoryOffers?limit=200&fields[subscriptionIntroductoryOffers]=offerMode,duration,numberOfPeriods,startDate,endDate`);
        const modes = intro.error ? intro.error : [...new Set(intro.data.map((o) => `${o.attributes.offerMode}/${o.attributes.duration}/${o.attributes.numberOfPeriods}`))];
        const note = s.attributes.reviewNote || '';
        subs.push({ id: s.id, productId: s.attributes.productId, state: s.attributes.state, period: s.attributes.subscriptionPeriod,
          introOfferCount: intro.error ? null : intro.data.length, introOfferModes: modes,
          reviewNoteIsFinal: note.startsWith('Sori Premium unlocks Level 2–5 lessons'), reviewNoteMentionsLevels3to5: /Levels? 3[–-]5/.test(note) });
      }
      out.subscriptionGroups.push({ id: grp.id, name: grp.attributes.referenceName, subscriptions: subs });
    }
  }
  const rs = await get(`/v1/reviewSubmissions?filter[app]=${APP}&filter[platform]=IOS&limit=10&fields[reviewSubmissions]=state,submittedDate`);
  out.reviewSubmissions = rs.error || [];
  if (!rs.error) for (const s of rs.data) {
    const items = await get(`/v1/reviewSubmissions/${s.id}/items?include=appStoreVersion&fields[appStoreVersions]=versionString&limit=50`);
    out.reviewSubmissions.push({ id: s.id, state: s.attributes.state, submittedDate: s.attributes.submittedDate,
      items: items.error || items.data.map((i) => ({ state: i.attributes?.state, related: Object.entries(i.relationships || {}).filter(([, r]) => r.data).map(([k]) => k),
        version: (items.included || []).find((v) => v.id === i.relationships?.appStoreVersion?.data?.id)?.attributes?.versionString })) });
  }
}
console.log('SORI_ASC_READONLY ' + JSON.stringify(out, null, 2));
