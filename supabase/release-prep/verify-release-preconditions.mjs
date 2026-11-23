/** Release guards, unchanged definitions, and runner-managed atomicity. No RPC or user-data test. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../..');
const packageRoot = process.env.GENIE_RELEASE_PGLITE_ROOT;
const canonicalPath = process.env.GENIE_RELEASE_CANONICAL_SQL;
assert.ok(packageRoot && path.isAbsolute(packageRoot) && canonicalPath && path.isAbsolute(canonicalPath));
const { PGlite } = await import(pathToFileURL(path.join(packageRoot, 'dist/index.js')).href);
const hash = value => createHash('sha256').update(value).digest('hex');
const proof = JSON.parse(await readFile(path.join(directory, 'derivation-proof.json'), 'utf8'));
const canonical = await readFile(canonicalPath, 'utf8');
assert.equal(hash(canonical), proof.canonicalDependencySourceSha256);
const files = [];
for (const entry of proof.files) {
  const original = await readFile(path.join(repo, entry.source), 'utf8');
  const derived = await readFile(path.join(repo, entry.derived), 'utf8');
  assert.equal(hash(original), entry.sourceSha256); assert.equal(hash(derived), entry.derivedSha256);
  const suffix = original.split('$guard$;\n')[1];
  assert.ok(suffix?.endsWith('commit;\n'));
  const definitions = suffix.slice(0, -'commit;\n'.length);
  assert.equal(derived.split('$release_guard$;\n')[1], definitions);
  assert.equal(hash(definitions), entry.preservedDefinitionsSha256);
  assert.doesNotMatch(derived, /^\s*(?:begin|commit|rollback);\s*$/im);
  const guard = derived.match(/^do \$release_guard\$\n[\s\S]*?^\$release_guard\$;/m)?.[0];
  assert.ok(guard); files.push({ ...entry, derived, guard });
}
const db = await PGlite.create();
const evidence = { schemaVersion: 1, recordedAtUtc: new Date().toISOString(), node: process.version,
  pgliteVersion: JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8')).version,
  canonicalSourceSha256: hash(canonical), derivedSql: proof.files.map(f => ({ path: f.derived, sha256: f.derivedSha256 })),
  scope: 'release preconditions, exact preserved definitions and runner transaction rollback; no repeated business-logic suite',
  networkUsed: false, productionAccessed: false, applicationRpcInvoked: false, testUsersCreated: false,
  checks: [], limitations: ['PGlite single connection with synthetic auth.uid, not real Auth/JWT/PostgREST.',
    'No concurrent session schedules, production gateway settings or hosted migration runner implementation are exercised.',
    'Original proposal business behavior remains supported by its earlier exact-hash real disposable HTTP evidence.'] };
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const check = async (name, fn) => { await fn(); evidence.checks.push({ name, status: 'passed' }); console.log('PASS ' + name); };
async function rejectGuard(file, mutation, expected) {
  await db.exec('begin;');
  try {
    if (mutation) await db.exec(mutation);
    let caught; try { await db.exec(file.guard); } catch (error) { caught = error; }
    assert.equal(caught?.message, expected);
  } finally { await db.exec('rollback;'); }
}
try {
  evidence.postgresVersion = (await one('select version() as version')).version;
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(canonical);
  const originalNames = (await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'vs_%' order by proname")).rows.map(r => r.proname);
  const originalDefinitions = async () => (await db.query("select proname,md5(pg_get_functiondef(p.oid)) as definition_md5,proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=any($1::text[]) order by proname", [originalNames])).rows;
  const before = await originalDefinitions(); assert.equal(before.length, 9);
  await check('source hashes and all post-guard definitions are unchanged except outer transaction control', async () => assert.equal(files.length, 2));
  await check('both release guards reject missing role and typed column dependencies', async () => {
    for (const file of files) {
      await rejectGuard(file, 'alter role authenticated rename to guard_missing_authenticated;', 'RELEASE_REQUIRED_ROLES_MISSING');
      await rejectGuard(file, 'alter table public.vs_votes rename column voter_id to guard_missing_voter;', 'RELEASE_VS_COLUMN_CONTRACT_REQUIRED');
    }
  });
  await check('both release guards reject disabled existing RLS and wrong auth uid contract', async () => {
    for (const file of files) {
      await rejectGuard(file, 'alter table public.vs_polls disable row level security;', 'RELEASE_EXISTING_VS_RLS_REQUIRED');
      await rejectGuard(file, 'alter function auth.uid() rename to guard_missing_uid;', 'RELEASE_AUTH_UID_CONTRACT_REQUIRED');
    }
  });
  await check('new schema and same-name overload collisions fail without replacing objects', async () => {
    for (const file of files) {
      await rejectGuard(file, `create schema ${file.newPrivateSchema};`, 'RELEASE_NEW_SCHEMA_ALREADY_EXISTS');
      await rejectGuard(file, `create function public.${file.publicFunctionNames[0]}(boolean) returns boolean language sql as $$select $1$$;`, 'RELEASE_PUBLIC_RPC_NAME_COLLISION');
    }
  });
  await check('question release guard requires the exact canonical delegated functions', async () => {
    await rejectGuard(files[1], 'alter function public.vs_shared_poll(text) rename to guard_missing_shared;', 'RELEASE_CANONICAL_SHARED_FUNCTIONS_REQUIRED');
    await rejectGuard(files[1], "alter function public.vs_vote(text,text) set search_path='public';", 'RELEASE_CANONICAL_SHARED_FUNCTIONS_REQUIRED');
  });
  await check('runner transaction rolls back all new objects after a simulated migration-history uniqueness failure', async () => {
    await db.exec("create temporary table release_runner_history_probe(version text primary key); insert into release_runner_history_probe values ('occupied');");
    for (const file of files) {
      let caught;
      try {
        await db.exec('begin;\n' + file.derived + "\ninsert into release_runner_history_probe values ('occupied');\ncommit;");
      } catch (error) { caught = error; }
      finally { await db.exec('rollback;'); }
      assert.equal(caught?.code, '23505');
      assert.equal((await one('select to_regnamespace($1)::text as schema', [file.newPrivateSchema])).schema, null);
      assert.equal((await one("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])", [file.publicFunctionNames])).n, 0);
      assert.deepEqual(await originalDefinitions(), before);
    }
  });
  await check('runner-wrapped exact release bodies install without local opt-in and retain nine canonical definitions and grants', async () => {
    assert.equal((await one("select current_setting('genie.allow_local_reporting_proposal',true) as v")).v, null);
    assert.equal((await one("select current_setting('genie.allow_local_question_safety_proposal',true) as v")).v, null);
    for (const file of files) await db.exec('begin;\n' + file.derived + '\ncommit;');
    assert.deepEqual(await originalDefinitions(), before);
    for (const file of files) {
      const functions = (await db.query("select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])", [file.publicFunctionNames])).rows;
      assert.equal(functions.length, file.publicFunctionNames.length);
      for (const f of functions) {
        const privileges = await one("select has_function_privilege('anon',$1::oid,'EXECUTE') as anon,has_function_privilege('authenticated',$1::oid,'EXECUTE') as authenticated", [f.oid]);
        assert.deepEqual(privileges, { anon: false, authenticated: true });
      }
    }
    assert.equal((await one("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('genie_reporting_private','genie_question_safety_private') and c.relkind='r' and c.relrowsecurity")).n, 7);
    for (const table of ['auth.users','public.vs_polls','public.vs_votes']) assert.equal((await one(`select count(*)::int as n from ${table}`)).n,0);
  });
  await check('reapplying either derived guard fails on the new schema and creates no duplicate', async () => {
    for (const file of files) await rejectGuard(file, null, 'RELEASE_NEW_SCHEMA_ALREADY_EXISTS');
  });
  evidence.status = 'passed'; evidence.checkCount = evidence.checks.length;
} catch (error) {
  evidence.status = 'failed'; evidence.error = { message: error.message, code: error.code ?? null };
  process.exitCode = 1; console.error(JSON.stringify(evidence.error));
} finally {
  await db.close(); evidence.disposableDatabaseClosed = true;
  await writeFile(path.join(directory, 'release-preconditions-validation.json'), JSON.stringify(evidence, null, 2) + '\n');
}
