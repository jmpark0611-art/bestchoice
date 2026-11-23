#!/usr/bin/env python3
"""Stage the reviewed Genie v7 web candidate in an existing bestchoice checkout.
Never touches app/, supabase/, production credentials, or Git remotes.
Usage: python3 scripts/stage-genie-v7.py /path/to/Genie-v7-focused-fix-2026-11-20.zip
Run from repository root on the isolated release-candidate branch.
"""
from pathlib import Path
import hashlib, subprocess, sys, zipfile

BRANCH = "codex/genie-v7-release-candidate-20261120"
ROOT = Path(__file__).resolve().parent.parent
EXCLUDED = {".env", ".env.local", ".env.production"}
def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/stage-genie-v7.py candidate.zip")
    current = subprocess.check_output(["git", "branch", "--show-current"], cwd=ROOT, text=True).strip()
    if current != BRANCH:
        raise SystemExit(f"Refusing to stage on branch {current!r}; expected {BRANCH}")
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise SystemExit("Refusing to overwrite a dirty working tree")
    archive = Path(sys.argv[1]).resolve()
    if not archive.is_file():
        raise SystemExit(f"Missing archive: {archive}")
    changed = []
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            p = Path(info.filename)
            if p.is_absolute() or ".." in p.parts or not p.parts or p.parts[0] != "web":
                continue
            if any(part in {"node_modules", "dist", ".git", ".vercel"} for part in p.parts):
                continue
            if p.name in EXCLUDED or p.name.startswith(".env."):
                continue
            if p.suffix in {".apk", ".aab", ".ipa", ".keystore", ".jks"}:
                continue
            # Only web app files; exclude native generated projects and local artifacts.
            if len(p.parts) > 1 and p.parts[1] in {"android", "ios", "build", "coverage"}:
                continue
            if info.file_size > 2_000_000:
                raise SystemExit(f"Unexpected large file: {p}")
            destination = ROOT / p
            if not destination.resolve().is_relative_to((ROOT / "web").resolve()):
                raise SystemExit(f"Unsafe path: {p}")
            data = z.read(info)
            if not destination.exists() or destination.read_bytes() != data:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
                changed.append((str(p), hashlib.sha256(data).hexdigest()))
    print(f"Staged {len(changed)} changed files. Review git diff before committing.")
    for path, digest in changed:
        print(digest[:12], path)
    print("Next: cd web && npm ci && npm run verify && npm run build")
    print("No git add, commit, push, deployment, or production DB changes performed.")
if __name__ == "__main__":
    main()
