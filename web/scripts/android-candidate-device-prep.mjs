/**
 * Convert one independently identified, signed AAB to a locally QA-signed APK.
 * No network request, adb action, upload-key read, or app launch occurs here.
 * bundletool reference: https://developer.android.com/tools/bundletool
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { accessSync, chmodSync, constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// From Google's release API, not an arbitrary caller-supplied tool digest.
// https://api.github.com/repos/google/bundletool/releases/tags/1.18.3
export const BUNDLETOOL_PIN = Object.freeze({ version: '1.18.3', sizeBytes: 32520401,
  sha256: 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29',
  sourceCommit: '586a43a450712a1067f3d92cf7574dee68226302',
  releaseUrl: 'https://github.com/google/bundletool/releases/tag/1.18.3' });
const hashPattern = /^[a-f0-9]{64}$/;
const maxArchive = 256 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
class PrepError extends Error {}
const requireThat = (value, code) => { if (!value) throw new PrepError(code); };
function directory(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || path.normalize(filename) !== filename) return false;
  try {
    for (let current = filename;; current = path.dirname(current)) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      if (path.dirname(current) === current) return true;
    }
  } catch { return false; }
}
function regular(filename, limit) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !directory(path.dirname(filename))) return false;
  try { const stat = lstatSync(filename); return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= limit; }
  catch { return false; }
}
function fresh(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || path.normalize(filename) !== filename || !directory(path.dirname(filename))) return false;
  try { lstatSync(filename); return false; } catch (error) { return error.code === 'ENOENT'; }
}
function executable(filename) {
  try {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) return null;
    const resolved = realpathSync(filename);
    if (!lstatSync(resolved).isFile()) return null;
    accessSync(resolved, constants.X_OK);
    return resolved;
  } catch { return null; }
}
function certificate(stdout) {
  requireThat(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 64 * 1024, 'CERTIFICATE_UNCONFIRMED');
  const blocks = stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  requireThat(blocks?.length === 1, 'CERTIFICATE_UNCONFIRMED');
  try { return sha256(new X509Certificate(blocks[0]).raw); } catch { throw new PrepError('CERTIFICATE_UNCONFIRMED'); }
}
export function verifyPinnedBundletool(filename) {
  return regular(filename, BUNDLETOOL_PIN.sizeBytes) && lstatSync(filename).size === BUNDLETOOL_PIN.sizeBytes &&
    sha256(readFileSync(filename)) === BUNDLETOOL_PIN.sha256;
}
/** Inherited public configuration, credentials, proxy and Java injection variables are not forwarded. */
export function candidateToolEnvironment(env, qaHome, temporary) {
  const result = { HOME: qaHome, TMPDIR: temporary, TMP: temporary, TEMP: temporary, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  if (typeof env?.PATH === 'string') result.PATH = env.PATH;
  return result;
}
export function validateCandidateReceipt(value, expectedSha256) {
  const r = value?.originalLocalSigningReceipt ?? value;
  requireThat(hashPattern.test(expectedSha256 ?? '') && r?.sha256 === expectedSha256 &&
    (value?.originalLocalSigningReceipt === undefined || value.sha256 === expectedSha256), 'CANDIDATE_RECEIPT_HASH_MISMATCH');
  requireThat(r.schemaVersion === 1 && r.status === 'signed-awaiting-device-and-store-review' &&
    r.signatureVerified === true && r.payloadUnchanged === true && r.binaryManifestIdentityPreserved === true &&
    hashPattern.test(r.signerCertificateSha256 ?? '') && /^[a-f0-9]{40}$/.test(r.sourceCommit ?? '') &&
    /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(r.applicationId ?? '') &&
    /^[1-9][0-9]{0,9}$/.test(String(r.versionCode ?? '')) &&
    typeof r.versionName === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(r.versionName), 'CANDIDATE_RECEIPT_INVALID');
  return { sha256: r.sha256, signerCertificateSha256: r.signerCertificateSha256,
    sourceCommit: r.sourceCommit, applicationId: r.applicationId,
    versionCode: String(r.versionCode), versionName: r.versionName };
}

const execute = job => {
  const result = spawnSync(job.command, job.args, { cwd: job.cwd, env: job.env, shell: false,
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: job.timeout ?? 60000 });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

const manifestProgram = String.raw`import json,pathlib,sys,xml.etree.ElementTree as ET
try:
 data=pathlib.Path(sys.argv[1]).read_bytes()
 if len(data)>1024*1024 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError()
 root=ET.fromstring(data);ns='{http://schemas.android.com/apk/res/android}'
 wanted=json.loads(sys.argv[2]);app=root.find('application')
 got={'applicationId':root.get('package'),'versionCode':root.get(ns+'versionCode'),'versionName':root.get(ns+'versionName')}
 if root.tag!='manifest' or got!=wanted or app is None or app.get(ns+'debuggable','false') not in ('false','0'): raise ValueError()
 print('CANDIDATE_MANIFEST_MATCH')
except Exception:
 print('CANDIDATE_MANIFEST_REJECTED');sys.exit(1)
`;

// These helpers only read owned archives and extract the fixed universal.apk name.
// Dex/assets/native-library bytes must remain identical to the exact input AAB.
export const candidateArchiveProgram = String.raw`import hashlib,json,os,pathlib,re,stat,sys,zipfile
def inventory(z):
 infos=z.infolist();names=[i.filename for i in infos]
 if len(infos)>10000 or len(names)!=len(set(names)): raise ValueError()
 total=0
 for i in infos:
  n=i.filename;mode=stat.S_IFMT(i.external_attr>>16)
  if i.orig_filename!=n or n.startswith('/') or '\\' in n or any(p in ('..','.') for p in n.split('/')) or any(ord(c)<32 or ord(c)==127 for c in n) or i.flag_bits&1 or i.compress_type not in (0,8): raise ValueError()
  if mode not in (0,stat.S_IFREG,stat.S_IFDIR) or i.file_size>256*1024*1024: raise ValueError()
  total+=i.file_size
 if total>512*1024*1024: raise ValueError()
 return {i.filename:i for i in infos if not i.is_dir()}
def digest(z,n):
 h=hashlib.sha256()
 with z.open(n) as f:
  while True:
   chunk=f.read(65536)
   if not chunk: break
   h.update(chunk)
 return h.hexdigest()
try:
 action=sys.argv[1]
 if action=='extract':
  with zipfile.ZipFile(sys.argv[2]) as z:
   entries=inventory(z)
   if set(entries)!={'universal.apk','toc.pb'} or entries['universal.apk'].file_size==0 or not 0<entries['toc.pb'].file_size<=16*1024*1024: raise ValueError()
   with z.open('universal.apk') as source,os.fdopen(os.open(sys.argv[3],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:
    while True:
     chunk=source.read(65536)
     if not chunk: break
     output.write(chunk)
  print('UNIVERSAL_APK_EXTRACTED')
 elif action=='compare':
  with zipfile.ZipFile(sys.argv[2]) as aab,zipfile.ZipFile(sys.argv[3]) as apk:
   source=inventory(aab);target=inventory(apk)
   if sorted(n for n in source if n.endswith('/manifest/AndroidManifest.xml'))!=['base/manifest/AndroidManifest.xml']: raise ValueError()
   if 'AndroidManifest.xml' not in target or 'resources.arsc' not in target: raise ValueError()
   expected={};counts={'assets':0,'dex':0,'nativeLibraries':0,'baselineProfiles':0}
   for n in source:
    if n.startswith('base/assets/'): dest=n[5:];kind='assets'
    elif n.startswith('base/dex/'):
     dest=n[len('base/dex/'):];kind='dex'
     if not re.fullmatch(r'classes(?:[2-9]|[1-9][0-9]+)?\.dex',dest): raise ValueError()
    elif n.startswith('base/lib/'): dest=n[5:];kind='nativeLibraries'
    else: continue
    expected[dest]=digest(aab,n);counts[kind]+=1
   # Exact Bundletool 1.18.3 BinaryArtProfilesInjector mapping; no arbitrary extras.
   # Source commit 586a43a450712a1067f3d92cf7574dee68226302 copies these bytes unchanged.
   for name in ('baseline.prof','baseline.profm'):
    n='BUNDLE-METADATA/com.android.tools.build.profiles/'+name
    if n in source:
     dest='assets/dexopt/'+name
     if dest in expected: raise ValueError()
     expected[dest]=digest(aab,n);counts['baselineProfiles']+=1
   actual={n:digest(apk,n) for n in target if n.startswith(('assets/','lib/')) or n.endswith('.dex')}
   if counts['assets']==0 or counts['dex']==0 or expected!=actual: raise ValueError()
   print(json.dumps({'payloadMatch':True,**counts}))
 else: raise ValueError()
except Exception:
 print('CANDIDATE_APK_ARCHIVE_REJECTED');sys.exit(1)
`;

// Google's apksig is bundled in the pinned all-JAR. Verify APK signing schemes,
// not merely the JAR signature, using its supported ApkVerifier API.
const apkVerifierSource = String.raw`import com.android.apksig.ApkVerifier;
import com.android.apksig.internal.apk.AndroidBinXmlParser;
import java.io.File;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.zip.ZipFile;
class VerifyCandidateApk {
 public static void main(String[] args) {
  try {
   var result=new ApkVerifier.Builder(new File(args[0])).build().verify();
   if(!result.isVerified()||result.getSignerCertificates().size()!=1)throw new Exception();
   var hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(result.getSignerCertificates().get(0).getEncoded()));
   if(!hash.equals(args[1])||!(result.isVerifiedUsingV2Scheme()||result.isVerifiedUsingV3Scheme()))throw new Exception();
   var identity=new HashMap<String,String>();boolean manifest=false,application=false;
   try(var apk=new ZipFile(args[0])){
    var entry=apk.getEntry("AndroidManifest.xml");
    if(entry==null||entry.getSize()<=0||entry.getSize()>1024*1024)throw new Exception();
    byte[] bytes;try(var input=apk.getInputStream(entry)){bytes=input.readNBytes(1024*1024+1);}
    if(bytes.length!=entry.getSize())throw new Exception();
    var xml=new AndroidBinXmlParser(ByteBuffer.wrap(bytes));
    while(xml.next()!=AndroidBinXmlParser.EVENT_END_DOCUMENT){
     if(xml.getEventType()!=AndroidBinXmlParser.EVENT_START_ELEMENT)continue;
     boolean root=xml.getDepth()==1&&xml.getName().equals("manifest");
     boolean app=xml.getDepth()==2&&xml.getName().equals("application");
     if(root){if(manifest)throw new Exception();manifest=true;}
     if(app){if(application)throw new Exception();application=true;}
     for(int i=0;i<xml.getAttributeCount();i++){
      var name=xml.getAttributeName(i);var ns=xml.getAttributeNamespace(i);var type=xml.getAttributeValueType(i);
      boolean android="http://schemas.android.com/apk/res/android".equals(ns);
      if(root&&((name.equals("package")&&(ns==null||ns.isEmpty()))||(android&&(name.equals("versionCode")||name.equals("versionName"))))){
       String value;
       if(name.equals("versionCode")&&type==AndroidBinXmlParser.VALUE_TYPE_INT)value=Integer.toString(xml.getAttributeIntValue(i));
       else if(type==AndroidBinXmlParser.VALUE_TYPE_STRING)value=xml.getAttributeStringValue(i);
       else throw new Exception();
       if(identity.putIfAbsent(name,value)!=null)throw new Exception();
      }
      if(app&&android&&name.equals("debuggable")){
       boolean disabled=(type==AndroidBinXmlParser.VALUE_TYPE_BOOLEAN&&!xml.getAttributeBooleanValue(i))||
        (type==AndroidBinXmlParser.VALUE_TYPE_INT&&xml.getAttributeIntValue(i)==0)||
        (type==AndroidBinXmlParser.VALUE_TYPE_STRING&&xml.getAttributeStringValue(i).equals("false"));
       if(!disabled)throw new Exception();
      }
     }
    }
   }
   if(!manifest||!application||!args[2].equals(identity.get("package"))||!args[3].equals(identity.get("versionCode"))||!args[4].equals(identity.get("versionName")))throw new Exception();
   System.out.println("{\"verified\":true,\"manifestIdentityVerified\":true,\"debuggable\":false,\"signerCertificateSha256\":\""+hash+"\",\"v1\":"+result.isVerifiedUsingV1Scheme()+",\"v2\":"+result.isVerifiedUsingV2Scheme()+",\"v3\":"+result.isVerifiedUsingV3Scheme()+"}");
  }catch(Exception error){System.out.println("QA_APK_SIGNATURE_REJECTED");System.exit(1);}
 }
}
`;

/** run is a trusted test seam. CLI callers cannot override verification or tool pins. */
export async function prepareAndroidCandidateApk({ candidatePath, verificationPath, expectedSha256,
  bundletoolPath, outputDir, tools, env = process.env, run = execute, log = () => {} } = {}) {
  let temporary, outputCreated = false, succeeded = false, receipt, result;
  try {
    requireThat(fresh(outputDir), 'FRESH_PRIVATE_OUTPUT_REQUIRED');
    requireThat(regular(candidatePath, maxArchive) && hashPattern.test(expectedSha256 ?? '') &&
      sha256(readFileSync(candidatePath)) === expectedSha256, 'CANDIDATE_HASH_MISMATCH');
    requireThat(regular(verificationPath, 64 * 1024), 'CANDIDATE_RECEIPT_REQUIRED');
    let input; try { input = JSON.parse(readFileSync(verificationPath, 'utf8')); } catch { throw new PrepError('CANDIDATE_RECEIPT_INVALID'); }
    const candidate = validateCandidateReceipt(input, expectedSha256);
    requireThat(verifyPinnedBundletool(bundletoolPath), 'EXACT_OFFICIAL_BUNDLETOOL_REQUIRED');
    const resolvedTools = Object.fromEntries(['java', 'jarsigner', 'keytool', 'python'].map(name => [name, executable(tools?.[name])]));
    requireThat(Object.values(resolvedTools).every(Boolean), 'EXISTING_LOCAL_JAVA_AND_PYTHON_TOOLS_REQUIRED');
    temporary = mkdtempSync(path.join(path.dirname(outputDir), '.genie-candidate-qa-')); chmodSync(temporary, 0o700);
    const qaHome = path.join(temporary, 'home'); mkdirSync(qaHome, { mode: 0o700 });
    const toolEnv = candidateToolEnvironment(env, qaHome, temporary);
    const child = async (stage, command, args, extra = {}) => {
      log(stage);
      let got; try { got = await run({ stage, command, args, cwd: temporary, env: toolEnv, ...extra }); }
      catch { throw new PrepError(stage.toUpperCase().replaceAll('-', '_') + '_FAILED'); }
      requireThat(got?.status === 0, stage.toUpperCase().replaceAll('-', '_') + '_FAILED');
      return got.stdout ?? '';
    };
    const bundle = path.join(temporary, 'candidate.aab');
    const tool = path.join(temporary, 'bundletool.jar');
    for (const [source, destination] of [[candidatePath, bundle], [bundletoolPath, tool]]) {
      copyFileSync(source, destination, constants.COPYFILE_EXCL); chmodSync(destination, 0o600);
    }
    requireThat(sha256(readFileSync(bundle)) === candidate.sha256 && verifyPinnedBundletool(tool), 'COPIED_INPUT_CHANGED');
    const javaArgs = ['-Duser.home=' + qaHome, '-Djava.io.tmpdir=' + temporary];
    const bundletool = (stage, args, extra) => child(stage, resolvedTools.java, [...javaArgs, '-jar', tool, ...args], extra);
    const signed = await child('verify-candidate-signature', resolvedTools.jarsigner,
      ['-J-Duser.language=en', '-J-Duser.country=US', '-verify', bundle]);
    requireThat(/\bjar verified\./i.test(signed) && !/jar is unsigned|unsigned entries|invalid signature/i.test(signed), 'CANDIDATE_SIGNATURE_UNCONFIRMED');
    const signer = certificate(await child('verify-candidate-signer', resolvedTools.keytool,
      ['-J-Duser.language=en', '-J-Duser.country=US', '-printcert', '-jarfile', bundle, '-rfc']));
    requireThat(signer === candidate.signerCertificateSha256, 'CANDIDATE_SIGNER_MISMATCH');
    requireThat((await bundletool('verify-bundletool-version', ['version'])).trim() === BUNDLETOOL_PIN.version, 'BUNDLETOOL_VERSION_MISMATCH');
    await bundletool('validate-candidate-bundle', ['validate', '--bundle=' + bundle]);
    const xml = await bundletool('read-candidate-manifest', ['dump', 'manifest', '--bundle=' + bundle, '--module=base']);
    const xmlFile = path.join(temporary, 'manifest.xml');
    requireThat(Buffer.byteLength(xml) <= 1024 * 1024, 'CANDIDATE_MANIFEST_TOO_LARGE');
    writeFileSync(xmlFile, xml, { mode: 0o600, flag: 'wx' });
    const identity = { applicationId: candidate.applicationId, versionCode: candidate.versionCode, versionName: candidate.versionName };
    requireThat((await child('verify-candidate-manifest', resolvedTools.python,
      ['-I', '-c', manifestProgram, xmlFile, JSON.stringify(identity)])).trim() === 'CANDIDATE_MANIFEST_MATCH', 'CANDIDATE_MANIFEST_MISMATCH');

    const password = randomBytes(32).toString('hex');
    const keystore = path.join(temporary, 'qa-only.p12');
    const passwordFile = path.join(temporary, 'qa-only-password.txt');
    writeFileSync(passwordFile, password + '\n', { mode: 0o600, flag: 'wx' });
    const privateEnv = { ...toolEnv, GENIE_QA_EPHEMERAL_PASSWORD: password };
    const alias = 'genie-local-qa';
    await child('create-ephemeral-qa-key', resolvedTools.keytool,
      ['-J-Duser.language=en', '-J-Duser.country=US', '-genkeypair', '-keystore', keystore, '-storetype', 'PKCS12',
        '-alias', alias, '-storepass:env', 'GENIE_QA_EPHEMERAL_PASSWORD', '-keypass:env', 'GENIE_QA_EPHEMERAL_PASSWORD',
        '-dname', 'CN=Genie disposable local QA', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-noprompt'], { env: privateEnv });
    requireThat(regular(keystore, 1024 * 1024), 'QA_KEY_NOT_CREATED'); chmodSync(keystore, 0o600);
    const qaSigner = certificate(await child('read-qa-certificate', resolvedTools.keytool,
      ['-J-Duser.language=en', '-J-Duser.country=US', '-exportcert', '-rfc', '-keystore', keystore,
        '-alias', alias, '-storepass:env', 'GENIE_QA_EPHEMERAL_PASSWORD'], { env: privateEnv }));
    requireThat(qaSigner !== candidate.signerCertificateSha256, 'QA_SIGNER_MUST_DIFFER_FROM_UPLOAD_SIGNER');
    const apks = path.join(temporary, 'candidate-qa.apks');
    await bundletool('build-qa-apk', ['build-apks', '--bundle=' + bundle, '--output=' + apks, '--mode=universal',
      '--ks=' + keystore, '--ks-key-alias=' + alias, '--ks-pass=file:' + passwordFile, '--key-pass=file:' + passwordFile], { timeout: 300000 });
    requireThat(regular(apks, maxArchive), 'QA_APK_SET_MISSING');
    const apk = path.join(temporary, 'candidate-qa.apk');
    requireThat((await child('extract-qa-apk', resolvedTools.python,
      ['-I', '-c', candidateArchiveProgram, 'extract', apks, apk])).trim() === 'UNIVERSAL_APK_EXTRACTED', 'QA_APK_EXTRACTION_UNCONFIRMED');
    requireThat(regular(apk, maxArchive), 'QA_APK_MISSING');
    let payload;
    try { payload = JSON.parse(await child('compare-candidate-payload', resolvedTools.python,
      ['-I', '-c', candidateArchiveProgram, 'compare', bundle, apk])); } catch (error) { if (error instanceof PrepError) throw error; throw new PrepError('QA_APK_PAYLOAD_UNCONFIRMED'); }
    requireThat(payload?.payloadMatch === true && Number.isSafeInteger(payload.assets) && payload.assets > 0 &&
      Number.isSafeInteger(payload.dex) && payload.dex > 0 && Number.isSafeInteger(payload.nativeLibraries) && payload.nativeLibraries >= 0 &&
      Number.isSafeInteger(payload.baselineProfiles) && payload.baselineProfiles >= 0 && payload.baselineProfiles <= 2,
    'QA_APK_PAYLOAD_UNCONFIRMED');
    const verifier = path.join(temporary, 'VerifyCandidateApk.java');
    writeFileSync(verifier, apkVerifierSource, { mode: 0o600, flag: 'wx' });
    let signature;
    try { signature = JSON.parse(await child('verify-qa-apk-signature', resolvedTools.java,
      [...javaArgs, '-cp', tool, verifier, apk, qaSigner, identity.applicationId, identity.versionCode, identity.versionName])); } catch (error) { if (error instanceof PrepError) throw error; throw new PrepError('QA_APK_SIGNATURE_UNCONFIRMED'); }
    requireThat(signature?.verified === true && signature.manifestIdentityVerified === true && signature.debuggable === false && signature.signerCertificateSha256 === qaSigner &&
      (signature.v2 === true || signature.v3 === true), 'QA_APK_SIGNATURE_UNCONFIRMED');
    requireThat(sha256(readFileSync(candidatePath)) === candidate.sha256 && sha256(readFileSync(bundle)) === candidate.sha256,
      'ORIGINAL_CANDIDATE_CHANGED');
    requireThat(fresh(outputDir), 'FRESH_PRIVATE_OUTPUT_REQUIRED'); mkdirSync(outputDir, { mode: 0o700 }); outputCreated = true;
    const apkPath = path.join(outputDir, 'Genie-Android-candidate-QA.apk');
    copyFileSync(apk, apkPath, constants.COPYFILE_EXCL); chmodSync(apkPath, 0o600);
    receipt = { schemaVersion: 1, status: 'qa-resigned-apk-from-exact-candidate-not-device-verified',
      sourceCommit: candidate.sourceCommit, candidateAabSha256: candidate.sha256,
      candidateAabSignerCertificateSha256: candidate.signerCertificateSha256, candidateAabSignatureVerified: true,
      ...identity, candidateManifestIdentityVerified: true, apkManifestIdentityVerified: true,
      file: path.basename(apkPath), sha256: sha256(readFileSync(apkPath)), sizeBytes: lstatSync(apkPath).size,
      bundletool: BUNDLETOOL_PIN, payload, apkSignature: signature,
      qaSigningKeyEphemeral: true, originalUploadKeyRead: false, apkUsesOriginalUploadSigner: false,
      playSigningIdentityVerified: false, deviceInstalled: false, appLaunched: false,
      nativeShareVerified: false, clipboardDenialVerified: false, deviceScreenshotsCaptured: false,
      backendContacted: false, uploaded: false, storeSubmitted: false };
    // Remove the ephemeral key and password before claiming the preparation succeeded.
    rmSync(temporary, { recursive: true }); temporary = undefined;
    receipt.qaSigningKeyRemoved = true;
    const receiptPath = path.join(outputDir, 'candidate-qa-verification.json');
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    writeFileSync(path.join(outputDir, 'DEVICE-CHECK.md'),
      '# 결정해지니 후보 APK — 기기 검증 전\n\n정확한 출시 후보 AAB에서 만든 설치용 APK입니다. 새 일회용 QA 키로 서명했으며, 업로드키와 Google Play 앱 서명키로 서명한 파일이 아닙니다. 원본 후보 AAB와 앱 내부 코드·웹 자산·네이티브 라이브러리의 바이트 일치를 확인했습니다.\n\n' +
      '실제 Android 기기나 에뮬레이터에서 실행하지 않았습니다. 실제 앱 실행, 공유 화면, 클립보드 거부 대응, 화면 캡처는 아직 확인하지 않았습니다. 이 파일은 스토어 제출용이 아닙니다.\n\n' +
      '## 다음 검증 조건\n\n- 네트워크가 차단된 새 로컬 에뮬레이터에서 사용하세요. 외부 통신 차단을 확인하기 전에는 실행하지 마세요. 실제 서버 주소가 빌드에 들어 있으므로 단순 QA 서명은 통신을 차단하지 않습니다.\n- 기존 설치·계정·저장 데이터를 덮어쓰거나 지우지 마세요. 새 에뮬레이터 또는 이 앱이 설치되지 않은 별도 검증 기기가 필요합니다.\n- 외부 통신 차단 상태에서 첫 화면·시스템 뒤로 가기·레이아웃을 확인할 수 있습니다. 공유/클립보드 UI에는 승인된 합성 데이터 주입 또는 별도 격리 서버 연결이 필요하며 운영 서버로 대신 검증하지 않습니다.\n- 기기 화면은 합성 데이터만 사용해 캡처하고, 앱 저장소·키·토큰·원문 로그는 공유하지 마세요.\n\n' +
      'QA 키는 생성 후 삭제했습니다. 같은 QA 키로 갱신할 수 없으므로 기존 앱에 덮어 설치하지 않습니다. 정확한 해시와 검증 범위는 candidate-qa-verification.json에 있습니다.\n',
      { mode: 0o600, flag: 'wx' });
    succeeded = true;
    result = { ok: true, apkPath, receiptPath, receipt };
  } catch (error) {
    result = { ok: false, code: error instanceof PrepError ? error.message : 'CANDIDATE_PREPARATION_FAILED' };
  } finally {
    if (temporary) { try { rmSync(temporary, { recursive: true }); } catch { result = { ok: false, code: 'QA_TEMPORARY_CLEANUP_FAILED' }; succeeded = false; } }
    if (outputCreated && !succeeded) { try { rmSync(outputDir, { recursive: true }); } catch { result = { ok: false, code: 'QA_PARTIAL_OUTPUT_CLEANUP_FAILED' }; } }
  }
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const flags = ['--candidate', '--verification', '--sha256', '--bundletool', '--output-dir', '--java-home', '--python'];
  const values = {}; const args = process.argv.slice(2);
  let valid = args.length === flags.length * 2;
  for (let i = 0; i < args.length; i += 2) {
    if (!flags.includes(args[i]) || values[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) valid = false;
    values[args[i]] = args[i + 1];
  }
  if (!valid || flags.some(flag => !values[flag])) {
    console.error('Explicit --candidate, --verification, --sha256, --bundletool, --output-dir, --java-home and --python are required.');
    process.exitCode = 1;
  } else {
    const jdk = values['--java-home'];
    const result = await prepareAndroidCandidateApk({ candidatePath: values['--candidate'], verificationPath: values['--verification'],
      expectedSha256: values['--sha256'], bundletoolPath: values['--bundletool'], outputDir: values['--output-dir'],
      tools: { java: path.join(jdk, 'bin/java'), jarsigner: path.join(jdk, 'bin/jarsigner'), keytool: path.join(jdk, 'bin/keytool'), python: values['--python'] },
      log: stage => console.log('candidate-qa: ' + stage) });
    console.log(JSON.stringify(result.ok ? { ok: true, status: result.receipt.status, sha256: result.receipt.sha256,
      candidateAabSha256: result.receipt.candidateAabSha256, deviceInstalled: false, appLaunched: false } : result));
    process.exitCode = result.ok ? 0 : 1;
  }
}
