// Edits the CI checkout only (never committed): App Store identity, version, icon and signing settings.
// Usage: node prepare.mjs <webRoot> <buildNumber> [teamId profileUuid]   (no team/profile = unsigned preflight)
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , web, buildNumber, teamId, profileUuid] = process.argv;
const BUNDLE = 'com.jmpark0611.genie';
const NAME = '결정해지니';
const die = (m) => { console.error(`PREPARE_FAIL ${m}`); process.exit(1); };
if (!/^\d+$/.test(buildNumber || '')) die('BUILD_NUMBER');
const signed = Boolean(teamId && profileUuid);
if (signed && (!/^[A-Z0-9]{10}$/.test(teamId) || !/^[0-9a-fA-F-]{36}$/.test(profileUuid))) die('SIGNING_ARGS');

// capacitor.config.ts
writeFileSync(join(web, 'capacitor.config.ts'),
  `import type { CapacitorConfig } from '@capacitor/cli';\n` +
  `const config: CapacitorConfig={appId:'${BUNDLE}',appName:'${NAME}',webDir:'dist'};\nexport default config;\n`);

// Info.plist: display name; arm64 (the Release build is arm64-only, iOS 15+)
const plistPath = join(web, 'ios/App/App/Info.plist');
let plist = readFileSync(plistPath, 'utf8');
const before = plist;
plist = plist.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${NAME}$2`);
plist = plist.replace(/(<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>)armv7(<\/string>)/, '$1arm64$2');
if (plist === before || !plist.includes(`<string>${NAME}</string>`)) die('INFO_PLIST');
writeFileSync(plistPath, plist);

// project.pbxproj: only the App target build configurations (they carry PRODUCT_BUNDLE_IDENTIFIER)
const pbxPath = join(web, 'ios/App/App.xcodeproj/project.pbxproj');
let pbx = readFileSync(pbxPath, 'utf8');
let touched = 0;
pbx = pbx.replace(/buildSettings = \{([^{}]*?PRODUCT_BUNDLE_IDENTIFIER = [^;]+;[^{}]*?)\};/g, (_, body) => {
  touched++;
  let b = body
    .replace(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/, `PRODUCT_BUNDLE_IDENTIFIER = ${BUNDLE};`)
    .replace(/MARKETING_VERSION = [^;]+;/, 'MARKETING_VERSION = 1.0;')
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
  if (signed) {
    b = b.replace(/CODE_SIGN_STYLE = [^;]+;/, 'CODE_SIGN_STYLE = Manual;')
      .replace(/\n(\s*)CODE_SIGN_STYLE = Manual;/, `\n$1CODE_SIGN_STYLE = Manual;\n$1DEVELOPMENT_TEAM = ${teamId};\n$1PROVISIONING_PROFILE_SPECIFIER = "${profileUuid}";\n$1"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "Apple Distribution";`);
  }
  return `buildSettings = {${b}};`;
});
if (touched !== 2) die(`TARGET_CONFIGS_${touched}`);
if (!pbx.includes('MARKETING_VERSION = 1.0;')) die('MARKETING_VERSION');
writeFileSync(pbxPath, pbx);

// App icon: 1024 opaque RGB rendered from web/public/genie-icon.svg (sha256 checked by the workflow)
const here = dirname(fileURLToPath(import.meta.url));
const iconDir = join(web, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');
copyFileSync(join(here, 'AppIcon-1024.png'), join(iconDir, 'AppIcon-512@2x.png'));

console.log(`PREPARE_OK bundle=${BUNDLE} version=1.0 build=${buildNumber} signed=${signed}`);
