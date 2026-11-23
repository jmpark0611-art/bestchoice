# Additive reporting and blocking release bodies

Status: final reviewed derivation with real CLI-generated copies preserved in `cli-generated/`. The first production apply request was cancelled; a subsequent read-only observation confirmed both new schemas and all six public RPCs absent. See `../../web/qa/production-server-preparation-2026-11-24.json`. No automatic retry. This document is not a claim of production application. Only the parent operational task can record that outcome. The frozen proposal files are unchanged.

## Exact inputs and outputs

| Source proposal | Source SHA-256 | Derived release SHA-256 |
| --- | --- | --- |
| `supabase/proposals/vs-report-result.sql` | `c81db728edbc2b7584eff86d5aedc79485ba09476d35e06bfb40226d2f82024c` | `0472a96417bfe838e82f904fcfe5fe8e72f88b9df07fe20eeecd359cfe3a6019` |
| `supabase/proposals/vs-question-safety.sql` | `b1394b91284d6882238570afa28f2b8c8290652679cd63564ac81f651c855dba` | `75edfca4b958df0560e90f50ac983cf7c81620b9aef565d5109d9bb2c853fc8f` |

The matching outputs are `vs-report-result.release.sql` and `vs-question-safety.release.sql`. `derivation-proof.json` pins the original sources, final outputs, exact preserved definition blocks, canonical delegated functions, and the obsolete prepared hashes that were never applied. `derivation.diff` contains the complete source-to-release diff.

The only differences are release provenance comments, replacement of the initial LOCAL session opt-in guard with catalog preconditions, and removal of the outer `BEGIN` and terminal `COMMIT`. Every byte after the original guard through the final privilege statement and its trailing comments/whitespace, before the original terminal `COMMIT`, remains identical. Function bodies, tables, indexes, constraints, limits, RLS and grants are unchanged.

## Transaction ownership

**Execute these derived bodies only through a migration runner that owns the transaction, including migration-history insertion.** Do not add an embedded `BEGIN` or `COMMIT` to the bodies. Supabase's [official embedded-transactions guidance](https://supabase.com/kb/troubleshooting/partial-migrations-and-schema-inconsistencies-from-embedded-transactions-13ae82), updated 2026-11-04, explains that an embedded commit can persist schema changes before a later history write fails. The original LOCAL proposals retain their explicit transactions for their original use.

The runner's actual success response and database history must still be reconciled with read-only catalog observations. An ambiguous transport result must not trigger blind reapplication or automatic migration-history repair. These files deliberately reject existing target schemas/RPC names instead of silently replacing objects.

## Preconditions and unchanged security behavior

Both guards require `anon`/`authenticated`, UUID-returning `auth.uid()`, the typed poll/vote/owner reference columns, RLS on existing poll/vote tables, absent new private schemas and no public same-name overloads. The question guard additionally pins the return type, security-definer flag, empty search path and exact function bodies of canonical `vs_poll_json`, `vs_shared_poll` and `vs_vote`.

The new private tables enable RLS without client policies and revoke direct client access. Public wrappers remain security invokers with authenticated-only execution. Privileged implementations have an empty search path, authenticated identity checks and explicit target ownership or participation checks. Reporting retains consent checks, bounded details, reporter/request idempotency, per-user and global daily limits, and receipt-only responses. The block author is resolved on the server; clients cannot select arbitrary author UUIDs. Guarded reads and votes delegate to the original canonical functions.

Reporter advisory locks precede duplicate-request checks and quota updates. User/global counter locking and transaction rollback keep those operations coupled. Block/unblock/clear/read/vote use the caller-specific advisory lock, and the guarded-vote path avoids an early poll key-share lock that would require an unsafe lock upgrade. The expected request isolation is READ COMMITTED; production preflight must include database and `authenticator`/`authenticated` role overrides, not only the administrator session. Local checks do not prove every concurrent schedule.

Existing canonical functions, grants, policies, `vs-decide`, cron and application data are not explicitly altered. New foreign keys do automatically add internal constraint triggers to referenced `auth.users`/`vs_polls`; this is an expected catalog effect, not an application-data write. Deleting a poll or user will apply the unchanged proposal cascade rules to new related rows. Legacy unguarded public read/vote APIs remain available; blocking is a personal experience preference enforced by new guarded endpoints, not a replacement for the canonical authorization model.

## Narrow validation

`verify-release-preconditions.mjs` uses the already available PGlite runtime and the exact canonical source hash. `release-preconditions-validation.json` records the executed environment, checks and limitations. The focused checks cover unchanged definitions, dependency/name collision refusal, runner-wrapped installation, unchanged nine canonical definitions and grants, six new public RPC execute grants, seven private RLS tables, and rollback of every newly installed object when a simulated migration-history uniqueness failure occurs after DDL.

No application RPC is invoked, no Auth test users are created, and no network or production access occurs in this verifier. PGlite is a single local connection with a synthetic `auth.uid`; it does not substitute for Auth/JWT/PostgREST or production execution. The original business logic has separate prior disposable real-HTTP evidence (run `45183793270`, source `eeb87ed8dd5a05800aba5eb4c49fdc701b64151d`); that suite was not repeated for this derivation.

Run only when verifying a changed derivation, with existing dependency locations:

```bash
GENIE_RELEASE_PGLITE_ROOT=/absolute/path/to/@electric-sql/pglite \
GENIE_RELEASE_CANONICAL_SQL=/absolute/path/to/verified/canonical.sql \
node supabase/release-prep/verify-release-preconditions.mjs
```

## Parent application boundary

The parent owns actual `supabase migration new` filenames, operational preflight, production application, resulting migration-version reconciliation, read-only catalog verification, and advisor review. Copy the exact final reviewed bodies into those freshly generated files; do not replay or overwrite historical migrations. New private schemas should not be added to Data API exposed schemas. No production user-data test, store submission, paid resource, schema rollback or destructive cleanup is authorized by this local review.
