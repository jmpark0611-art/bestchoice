// Verifies the exported IPA and writes genie-ios-1.0-verification.json (no secrets inside).
// Usage: node verify.mjs <ipa> <outJson> <ascPlanJson> <expectedBuild> <expectedTeam> <signingCertSha1>
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [, , ipa, out, planPath, expectedBuild, expectedTeam, certSha1] = process.argv;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
const tryRun = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status === 0 && !r.error) return { ok: true, out: `${r.stdout || ''}${r.stderr || ''}` };
  return { ok: false, out: String((r.stderr && r.stderr.length ? r.stderr : null) || r.error?.message || '') };
};
const plistJson = (file) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]));
const plistJsonFromXml = (xml) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml }));
// plutil cannot convert plists with <date>/<data> values to JSON ("invalid object in plist for destination format"),
// which is the case for embedded.mobileprovision (CreationDate, DeveloperCertificates). Parse the XML plist directly:
// <date> -> ISO string, <data> -> base64 string (no whitespace), other types as in JSON.
const parseXmlPlist = (xml) => {
  const text = String(xml).replace(/^[^<]*(?=<)/, '');
  const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z]+)(?:\s[^>]*?)?(\/?)>|([^<]+)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[2]) tokens.push({ close: m[1] === '/', self: m[3] === '/', tag: m[2] });
    else if (m[4] !== undefined && m[4].trim() !== '') tokens.push({ text: m[4] });
  }
  let i = 0;
  const readText = (tag) => {
    let t = '';
    if (tokens[i] && tokens[i].text !== undefined) t = tokens[i++].text;
    const c = tokens[i++];
    if (!c || !c.close || c.tag !== tag) throw new Error(`plist: expected </${tag}>`);
    return t;
  };
  const readValue = () => {
    const t = tokens[i++];
    if (!t || t.text !== undefined) throw new Error('plist: unexpected token');
    if (t.self) {
      if (t.tag === 'true') return true;
      if (t.tag === 'false') return false;
      if (t.tag === 'string') return '';
      if (t.tag === 'dict') return {};
      if (t.tag === 'array') return [];
      throw new Error(`plist: unexpected <${t.tag}/>`);
    }
    switch (t.tag) {
      case 'dict': {
        const o = {};
        while (!(tokens[i].close && tokens[i].tag === 'dict')) {
          const k = tokens[i++];
          if (k.tag !== 'key' || k.close) throw new Error('plist: expected <key>');
          const key = unescape(readText('key'));
          o[key] = readValue();
        }
        i++;
        return o;
      }
      case 'array': {
        const a = [];
        while (!(tokens[i].close && tokens[i].tag === 'array')) a.push(readValue());
        i++;
        return a;
      }
      case 'string': return unescape(readText('string'));
      case 'integer': return parseInt(readText('integer'), 10);
      case 'real': return parseFloat(readText('real'));
      case 'date': return readText('date').trim();
      case 'data': return readText('data').replace(/\s+/g, '');
      case 'true': case 'false': { const v = t.tag === 'true'; i++; return v; }
      default: throw new Error(`plist: unsupported <${t.tag}>`);
    }
  };
  while (tokens[i] && !(tokens[i].tag === 'plist' && !tokens[i].close)) i++;
  if (!tokens[i]) throw new Error('plist: <plist> not found');
  i++;
  return readValue();
};

const sha256 = createHash('sha256').update(readFileSync(ipa)).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'genie-ipa-'));
run('ditto', ['-x', '-k', ipa, dir]);
const payload = join(dir, 'Payload');
const appName = readdirSync(payload).find((n) => n.endsWith('.app'));
const app = join(payload, appName);
const info = plistJson(join(app, 'Info.plist'));

const codesignVerify = tryRun('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const codesignInfo = tryRun('codesign', ['-dvvv', app]);
const ent = parseXmlPlist(run('codesign', ['-d', '--entitlements', ':-', app]));
const prof = parseXmlPlist(run('security', ['cms', '-D', '-i', join(app, 'embedded.mobileprovision')]));
const authority = (codesignInfo.out.match(/^Authority=(.*)$/m) || [])[1] || null;
const signedTeam = (codesignInfo.out.match(/^TeamIdentifier=(.*)$/m) || [])[1] || null;

// Leaf certificate actually used for signing vs. certificates embedded in the profile
const certDir = mkdtempSync(join(tmpdir(), 'genie-cert-'));
run('codesign', ['-d', `--extract-certificates=${join(certDir, 'c')}`, app], { cwd: certDir });
const leafSha1 = createHash('sha1').update(readFileSync(join(certDir, 'c0'))).digest('hex').toUpperCase();
const profileCertSha1 = (prof.DeveloperCertificates || []).map((b64) => createHash('sha1').update(Buffer.from(b64, 'base64')).digest('hex').toUpperCase());

const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const privacyManifests = run('find', [app, '-name', 'PrivacyInfo.xcprivacy']).trim().split('\n').filter(Boolean).map((p) => p.slice(app.length + 1));
const mainBinary = join(app, info.CFBundleExecutable);
const archs = run('lipo', ['-archs', mainBinary]).trim();

const checks = {
  codesignVerifyDeepStrict: codesignVerify.ok,
  bundleId: info.CFBundleIdentifier === 'com.jmpark0611.genie',
  displayName: info.CFBundleDisplayName === '결정해지니',
  marketingVersion: info.CFBundleShortVersionString === '1.0',
  buildNumber: info.CFBundleVersion === expectedBuild,
  exportComplianceDeclared: info.ITSAppUsesNonExemptEncryption === false,
  buildNumberUniqueVsAppStoreConnect: plan.existingNumericBuildMax === null || Number(expectedBuild) > plan.existingNumericBuildMax,
  sdkIsIphoneOS26: /^iphoneos26(\.|$)/.test(info.DTSDKName || ''),
  signedByAppleDistribution: /^Apple Distribution: /.test(authority || '') || /^iPhone Distribution: /.test(authority || ''),
  signedTeamMatches: signedTeam === expectedTeam,
  profileTeamMatches: (prof.TeamIdentifier || [])[0] === expectedTeam,
  profileIsAppStore: !prof.ProvisionedDevices && !prof.ProvisionsAllDevices && ent['get-task-allow'] !== true,
  profileAppIdMatches: prof.Entitlements?.['application-identifier'] === `${expectedTeam}.com.jmpark0611.genie`,
  entitlementAppIdMatches: ent['application-identifier'] === `${expectedTeam}.com.jmpark0611.genie`,
  profileNotExpired: new Date(prof.ExpirationDate) > new Date(),
  profileUuidMatchesPlan: prof.UUID === plan.profile.uuid,
  signingCertInProfile: profileCertSha1.includes(leafSha1),
  signingCertMatchesProvidedP12: leafSha1 === String(certSha1).toUpperCase(),
  arm64: archs.split(' ').includes('arm64'),
  privacyManifestPresent: privacyManifests.length > 0,
  appIconPresent: Boolean(info.CFBundleIcons?.CFBundlePrimaryIcon) || existsSync(join(app, 'Assets.car')),
};
const passed = Object.values(checks).every(Boolean);

const report = {
  schemaVersion: 1,
  status: passed ? 'signed-app-store-ipa-verified-not-uploaded' : 'verification-failed',
  createdAtUtc: new Date().toISOString(),
  source: { repository: process.env.GITHUB_REPOSITORY, sourceSha: process.env.SOURCE_SHA, ciCommit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT },
  ipa: { file: ipa.split('/').pop(), sha256, sizeBytes: statSync(ipa).size },
  app: { bundleId: info.CFBundleIdentifier, displayName: info.CFBundleDisplayName, version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion, minimumOS: info.MinimumOSVersion, dtSdkName: info.DTSDKName, dtPlatformVersion: info.DTPlatformVersion,
    dtXcode: info.DTXcode, dtXcodeBuild: info.DTXcodeBuild, requiredDeviceCapabilities: info.UIRequiredDeviceCapabilities,
    architectures: archs, privacyManifests },
  signing: { authority, teamId: signedTeam, signingCertSha1: leafSha1, entitlements: ent },
  provisioningProfile: { name: prof.Name, uuid: prof.UUID, teamId: (prof.TeamIdentifier || [])[0], appIdName: prof.AppIDName,
    creationDate: prof.CreationDate, expirationDate: prof.ExpirationDate, certificateSha1: profileCertSha1,
    createdThisRun: plan.profile.createdThisRun },
  appStoreConnect: { appId: plan.app.id, appName: plan.app.name, existingBuildCount: plan.existingBuildCount,
    existingNumericBuildMax: plan.existingNumericBuildMax, nonNumericBuildVersions: plan.nonNumericBuildVersions,
    distributionCertificate: plan.certificate, uploaded: false },
  checks,
  codesignVerifyOutput: codesignVerify.out.trim().split('\n').slice(-4),
  notVerified: [
    'Physical iPhone/iPad install and launch (no device in CI).',
    'Production server behavior from the iOS app: the 2026-11-27 server changes (capacitor://localhost in VS_ALLOWED_ORIGINS, report/block RPC migrations) were verified by preflight and catalog reads only; no real iOS-originated request was made by this build.',
    'App Store Connect upload, processing, privacy nutrition labels and review. Export compliance is declared in Info.plist (ITSAppUsesNonExemptEncryption=false) and still has to be accepted in App Store Connect.',
  ],
};
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks }, null, 2));
if (!passed) process.exit(1);
