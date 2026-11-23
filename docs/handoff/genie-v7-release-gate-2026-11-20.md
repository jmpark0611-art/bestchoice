# Genie v7 release gate — 2026-11-20

This branch is isolated from production and currently starts at commit `470dba663677f0df7fbc3c07843b0371758b7f32`.

## Source of truth
Latest local candidate: `Genie-v7-focused-fix-2026-11-20.zip` (conversation attachment). Do not assume the branch already contains the v7 candidate. Preserve the original Toss miniapp under `app/`, existing Supabase migration history and deployed Edge Functions.

## Required before preview
- Apply and review the candidate's `web/` changes, lockfile, and `.github/workflows/release-candidate.yml` to this branch.
- Run Node 22 `npm ci`, `npm run verify`, `npm run build` in `web/`. The earlier 73-test pass was on Node 24, not Node 22.
- Focused checks: narrow screens, clipboard rejection, repeated share clicks, blocked refresh while writing, stale responses, server-state reconciliation after timeout.
- Verify Vercel project `genie-web`, branch mapping, root `web/`, and safe preview environment variables. Preview must not be treated as an isolated backend merely because it has a preview URL.
- No live Auth/DB/Edge/AI write testing without a separately approved isolated Supabase project. Never run synthetic user votes/deletions against production.

## Release order
Web preview → explicit production approval → web pilot → Android signing/Play Console → iOS signing/App Store Connect.

## Status
Branch created; candidate code upload, CI, preview and production release **not completed** as of this note.
