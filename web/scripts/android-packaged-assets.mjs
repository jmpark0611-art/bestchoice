const bridgePath = 'base/assets/native-bridge.js';
const hash = /^[a-f0-9]{64}$/;
const relativePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') &&
  !/[\\\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');

// Same exact asset-set/byte checks used by the synthetic native check. The
// inventory form lets an imported export be checked without following its CI
// sourceRoot or needing a second copy of the prepared web assets.
const program = String.raw`import hashlib,json,pathlib,re,sys,zipfile
aab,root,library_json=sys.argv[1:4]
root=pathlib.Path(root)
library=json.loads(library_json)
options=json.loads(sys.argv[4]) if len(sys.argv)>4 else {}
inventory=options.get("expectedAssets")
if inventory is None:
 files=[p for p in root.rglob("*") if p.is_file()]
 app_expected={"base/assets/"+p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
else:
 app_expected={"base/assets/"+entry["path"]:entry["sha256"] for entry in inventory}
with zipfile.ZipFile(aab) as z:
 names=z.namelist()
 expected=set(app_expected)|set(library)
 actual={n for n in names if n.startswith("base/assets/") and not n.endswith("/")}
 changed=[n for n,h in app_expected.items() if n in actual and hashlib.sha256(z.read(n)).hexdigest()!=h]
 changed += [n for n,h in library.items() if n in actual and hashlib.sha256(z.read(n)).hexdigest()!=h]
 report={"duplicateEntries":len(names)!=len(set(names)),"manifestPresent":"base/manifest/AndroidManifest.xml" in names,"dexPresent":any(n.startswith("base/dex/") and n.endswith(".dex") for n in names),"missing":sorted(expected-actual),"unexpected":sorted(actual-expected),"changed":sorted(changed)}
 report["sourceAssetCollision"]=sorted(set(app_expected)&set(library))
 report["unexpectedSha256"]={n:hashlib.sha256(z.read(n)).hexdigest() for n in report["unexpected"]}
 signatures=[n for n in names if re.match(r"^META-INF/(?:[^/]+\.(?:SF|RSA|DSA|EC)|SIG-[^/]+)$",n,re.IGNORECASE)] if options.get("requireUnsigned") else []
 if options.get("requireUnsigned"): report["signatureMetadata"]=sorted(signatures)
 if report["duplicateEntries"] or not report["manifestPresent"] or not report["dexPresent"] or report["sourceAssetCollision"] or actual!=expected or changed or signatures:
  print("AAB_PACKAGE_DIAGNOSTICS "+json.dumps(report,ensure_ascii=True))
  sys.exit(1)
print("AAB_ASSETS_MATCH")
`;

export function packagedAssetsCheckJob({ pythonExecutable, artifactPath, assetRoot, expectedAssets,
  libraryAssets, cwd, env, requireUnsigned = false }) {
  if (!libraryAssets || Object.keys(libraryAssets).length !== 1 || !hash.test(libraryAssets[bridgePath] ?? '') ||
      typeof requireUnsigned !== 'boolean') throw new Error('INVALID_PACKAGE_CHECK_INPUT');
  if (expectedAssets !== undefined) {
    if (assetRoot !== undefined || !Array.isArray(expectedAssets) || expectedAssets.length === 0 ||
        expectedAssets.some(entry => !entry || !relativePath(entry.path) || !hash.test(entry.sha256 ?? '')) ||
        new Set(expectedAssets.map(entry => entry.path)).size !== expectedAssets.length) {
      throw new Error('INVALID_PACKAGE_CHECK_INPUT');
    }
  } else if (typeof assetRoot !== 'string' || !assetRoot) throw new Error('INVALID_PACKAGE_CHECK_INPUT');
  const args = ['-c', program, artifactPath, assetRoot ?? '', JSON.stringify(libraryAssets)];
  if (requireUnsigned || expectedAssets !== undefined) args.push(JSON.stringify({ requireUnsigned, expectedAssets }));
  return { stage: 'verify-package', command: pythonExecutable, args, cwd, env, capture: true };
}
