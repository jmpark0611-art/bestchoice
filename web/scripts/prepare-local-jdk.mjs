import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_TOOLS = Object.freeze({
  javac: { main: 'jdk.compiler/com.sun.tools.javac.Main', probe: ['-version'] },
  jarsigner: { main: 'jdk.jartool/sun.security.tools.jarsigner.Main', probe: ['-version'] },
  jar: { main: 'jdk.jartool/sun.tools.jar.Main', probe: ['--version'] },
  jlink: { main: 'jdk.jlink/jdk.tools.jlink.internal.Main', probe: ['--version'] },
  jmod: { main: 'jdk.jlink/jdk.tools.jmod.Main', probe: ['--version'] },
  javadoc: { main: 'jdk.javadoc/jdk.javadoc.internal.tool.Main', probe: ['--version'] },
  keytool: { main: 'java.base/sun.security.tools.keytool.Main', probe: ['-help'] },
});
const failure = (code, message) => ({ ok: false, errors: [{ code, message }] });
const hash = value => createHash('sha256').update(value).digest('hex');
const hasEntry = filename => { try { lstatSync(filename); return true; } catch { return false; } };

function executable(filename) {
  try {
    if (!lstatSync(realpathSync(filename)).isFile()) return false;
    accessSync(filename, constants.X_OK);
    return true;
  } catch { return false; }
}

function findJava(env) {
  const candidates = [];
  if (typeof env.JAVA_HOME === 'string') candidates.push(path.join(env.JAVA_HOME, 'bin', 'java'));
  if (typeof env.PATH === 'string') for (const entry of env.PATH.split(path.delimiter).filter(Boolean)) {
    candidates.push(path.resolve(entry, 'java'));
  }
  return candidates.find(executable) ?? null;
}

function probe(javaExecutable, args, env) {
  const cleanEnv = { ...env };
  // Inspect the runtime itself; inherited injection/agent flags are not part of its capabilities.
  for (const key of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS']) delete cleanEnv[key];
  return spawnSync(javaExecutable, args, { env: cleanEnv, encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 1_048_576 });
}

/** Read-only discovery. It does not download, install, create keys, or change environment variables. */
export function inspectLocalJava({ javaExecutable, env = process.env } = {}) {
  try {
    const candidate = javaExecutable ?? findJava(env);
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || !executable(candidate)) {
      return failure('JAVA_NOT_FOUND', 'An existing executable Java runtime was not found. Nothing was installed.');
    }
    const java = realpathSync(candidate);
    const settings = probe(java, ['-XshowSettings:properties', '-version'], env);
    if (settings.status !== 0) return failure('JAVA_PROBE_FAILED', 'The existing Java runtime could not be inspected.');
    const output = `${settings.stdout ?? ''}\n${settings.stderr ?? ''}`;
    const property = name => output.match(new RegExp(`^\\s*${name.replaceAll('.', '\\.')} = (.+)$`, 'm'))?.[1]?.trim();
    const reportedHome = property('java.home');
    if (!reportedHome || !path.isAbsolute(reportedHome)) return failure('JAVA_HOME_UNCONFIRMED', 'The runtime did not report an absolute Java home.');
    const runtimeRoot = realpathSync(reportedHome);
    const tools = {};
    for (const [name, tool] of Object.entries(MODULE_TOOLS)) {
      const result = probe(java, ['-m', tool.main, ...tool.probe], env);
      tools[name] = { available: result.status === 0, moduleMain: tool.main };
    }
    const resources = Object.fromEntries(['lib/modules', 'conf', 'release', 'jmods', 'include/jni.h']
      .map(resource => [resource, existsSync(path.join(runtimeRoot, resource))]));
    return { ok: true, capabilities: {
      status: 'existing-runtime-module-tools', javaExecutable: java, runtimeRoot,
      javaVersion: property('java.version') ?? 'unconfirmed', vendor: property('java.vendor') ?? 'unconfirmed',
      resources, tools, missingResources: ['jmods', 'include/jni.h'].filter(resource => !resources[resource]),
      agpCompatibility: 'unverified', fullJdkInstalled: false,
    } };
  } catch {
    return failure('JAVA_INSPECTION_FAILED', 'The existing runtime could not be inspected safely. Nothing was installed.');
  }
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function validateOutput(output, workspaceRoot) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) return failure('ABSOLUTE_OUTPUT_REQUIRED', 'Use a new absolute output path inside the current workspace.');
  if (hasEntry(output)) return failure('OUTPUT_EXISTS', 'The output already exists or is a symlink. Existing files will not be replaced.');
  const workspace = realpathSync(workspaceRoot);
  if (!lstatSync(workspace).isDirectory()) return failure('WORKSPACE_REQUIRED', 'An existing workspace directory is required.');
  const absolute = path.resolve(output);
  const relative = path.relative(workspace, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return failure('OUTPUT_OUTSIDE_WORKSPACE', 'The adapter output must stay inside the selected workspace.');
  }
  let parent = workspace;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    parent = path.join(parent, part);
    if (!hasEntry(parent)) continue;
    const stat = lstatSync(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return failure('UNSAFE_OUTPUT_PARENT', 'The output parent must be a real workspace directory, not a symlink.');
  }
  return { ok: true, output: absolute };
}

function launcherSource({ sourceJava, adapterRoot, tools }) {
  const mains = Object.fromEntries(Object.entries(tools).filter(([, tool]) => tool.available).map(([name, tool]) => [name, tool.moduleMain]));
  return `import { spawnSync } from 'node:child_process';\n` +
    `const sourceJava = ${JSON.stringify(sourceJava)};\nconst adapterRoot = ${JSON.stringify(adapterRoot)};\n` +
    `const mains = ${JSON.stringify(mains)};\n` +
    `const [tool, ...input] = process.argv.slice(2);\n` +
    `let args;\n` +
    `if (tool === 'java') {\n  args = ['-Djava.home=' + adapterRoot, ...input];\n` +
    `} else if (Object.hasOwn(mains, tool)) {\n` +
    `  const vm = [], forwarded = [];\n` +
    `  for (const argument of input) {\n` +
    `    if (argument === '-J') { console.error('Use -J<jvm-option> as one argument.'); process.exit(2); }\n` +
    `    if (argument.startsWith('-J')) vm.push(argument.slice(2)); else forwarded.push(argument);\n` +
    `  }\n  args = [...vm, '-Djava.home=' + adapterRoot, '-m', mains[tool], ...forwarded];\n` +
    `} else { console.error('Unknown Java module tool.'); process.exit(2); }\n` +
    `const result = spawnSync(sourceJava, args, { stdio: 'inherit', shell: false, env: process.env });\n` +
    `if (result.error) console.error('The existing Java module tool could not be started.');\n` +
    `process.exit(result.status ?? 1);\n`;
}

/** Create only module launchers in a NEW workspace directory; never alter the installed runtime. */
export function prepareLocalJdk({ output, workspaceRoot = process.cwd(), javaExecutable, env = process.env } = {}) {
  try {
    if (process.platform === 'win32') return failure('POSIX_LAUNCHER_REQUIRED', 'This local adapter creates POSIX launchers; no Windows installation is performed.');
    const destination = validateOutput(output, workspaceRoot);
    if (!destination.ok) return destination;
    const inspection = inspectLocalJava({ javaExecutable, env });
    if (!inspection.ok) return inspection;
    const capabilities = inspection.capabilities;
    if (!capabilities.resources['lib/modules'] || !capabilities.resources.conf || !capabilities.resources.release) {
      return failure('RUNTIME_RESOURCES_MISSING', 'The existing modular runtime lacks resources needed for a workspace adapter.');
    }
    const adapterRoot = destination.output;
    mkdirSync(path.dirname(adapterRoot), { recursive: true, mode: 0o700 });
    // No recursive flag: a concurrently created destination must fail instead of being reused.
    mkdirSync(adapterRoot, { mode: 0o700 });
    mkdirSync(path.join(adapterRoot, 'bin'), { mode: 0o700 });
    for (const name of ['lib', 'conf', 'legal', 'release', 'jmods', 'include']) {
      const source = path.join(capabilities.runtimeRoot, name);
      if (existsSync(source)) symlinkSync(source, path.join(adapterRoot, name), lstatSync(source).isDirectory() ? 'dir' : 'file');
    }
    const dispatcher = path.join(adapterRoot, 'java-tool-launcher.mjs');
    writeFileSync(dispatcher, launcherSource({ sourceJava: capabilities.javaExecutable, adapterRoot, tools: capabilities.tools }), { mode: 0o600, flag: 'wx' });
    const nodeExecutable = realpathSync(process.execPath);
    const launchers = ['java', ...Object.entries(capabilities.tools).filter(([, tool]) => tool.available).map(([name]) => name)];
    for (const name of launchers) {
      writeFileSync(path.join(adapterRoot, 'bin', name), `#!/bin/sh\nexec ${shellQuote(nodeExecutable)} ${shellQuote(dispatcher)} ${shellQuote(name)} "$@"\n`, { mode: 0o700, flag: 'wx' });
    }
    const receipt = {
      schemaVersion: 1, kind: 'workspace-java-module-adapter', status: 'module-launchers-only', createdAt: new Date().toISOString(),
      adapterRoot, sourceJava: capabilities.javaExecutable, sourceRuntimeRoot: capabilities.runtimeRoot,
      sourceJavaSha256: hash(readFileSync(capabilities.javaExecutable)), sourceReleaseSha256: hash(readFileSync(path.join(capabilities.runtimeRoot, 'release'))),
      javaVersion: capabilities.javaVersion, vendor: capabilities.vendor,
      launchers, modules: capabilities.tools, nodeExecutable, nodeVersion: process.version,
      jvmFlagForwarding: '-J<option> is passed before the module entry point; tool arguments remain separate argv entries',
      missingResources: capabilities.missingResources, agpCompatibility: 'unverified', nativeAndroidBuild: 'not-run',
      fullJdkInstalled: false, systemEnvironmentChanged: false,
    };
    const receiptPath = path.join(adapterRoot, 'JAVA-MODULE-ADAPTER.json');
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    return { ok: true, adapterRoot, receiptPath, javaVersion: capabilities.javaVersion, launchers,
      missingResources: capabilities.missingResources, agpCompatibility: 'unverified' };
  } catch {
    return failure('ADAPTER_PREPARATION_FAILED', 'The local adapter could not be completed. Existing runtime files and global environment settings were not changed.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const result = args.length === 0 ? inspectLocalJava()
    : args.length === 2 && args[0] === '--output' ? prepareLocalJdk({ output: args[1] })
      : failure('USAGE', `Run ${path.basename(fileURLToPath(import.meta.url))} for read-only capabilities, or --output /absolute/new/workspace/directory.`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
