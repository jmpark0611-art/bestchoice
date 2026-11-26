// Verifies the exported IPA and writes genie-ios-1.0-verification.json (no secrets inside).
// Usage: node verify.mjs <ipa> <outJson> <ascPlanJson> <expectedBuild> <expectedTeam> <signingCertSha1>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const [, , ipa, out, planPath, expectedBuild, expectedTeam, certSha1] = process.argv;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
const tryRun = (cmd, args) => { try { return { ok: true, out: run(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: String(e.stderr || e.message) }; } };
const plistJson = (file) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]));
const plistJsonFromXml = (xml) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml }));

const sha256 = createHash('sha256').update(readFileSync(ipa)).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'genie-ipa-'));
run('ditto', ['-x', '-k', ipa, dir]);
const payload = join(dir, 'Payload');
const appName = readdirSync(payload).find((n) => n.endsWith('.app'));
const app = join(payload, appName);
const info = plistJson(join(app, 'Info.plist'));

const codesignVerify = tryRun('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
const codesignInfo = tryRun('codesign', ['-dvvv', app]);
const ent = plistJsonFromXml(run('codesign', ['-d', '--entitlements', ':-', app]));
const prof = plistJsonFromXml(run('security', ['cms', '-D', '-i', join(app, 'embedded.mobileprovision')]));
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
    'Production server behavior from the iOS app: Capacitor iOS origin is capacitor://localhost, which is not in the saved VS_ALLOWED_ORIGINS list (https://localhost is, for Android). vs-decide/decision-ai calls from iOS are expected to be refused until the owner approves adding it.',
    'Latest production RPCs/backend changes (ANDROID-SERVER-CHANGES-PENDING.md) are not validated by this build.',
    'App Store Connect upload, processing, export compliance (ITSAppUsesNonExemptEncryption is not set), privacy nutrition labels and review.',
  ],
};
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, checks }, null, 2));
if (!passed) process.exit(1);
