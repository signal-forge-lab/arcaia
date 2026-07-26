#!/usr/bin/env python3
"""Bump Arcaia extension version across known release files.

Usage:
  python scripts/bump_version.py 0.1.112 --dry-run
  python scripts/bump_version.py 0.1.112
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
APP_FILES = [
    "content.js",
    "injected-main.js",
    "popup.js",
    "popup.html",
    "tests/lite-grouping.test.js",
]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str, dry_run: bool) -> None:
    if not dry_run:
        path.write_text(text, encoding="utf-8", newline="")


def detect_current_version() -> str:
    manifest = json.loads(read(ROOT / "manifest.json"))
    version = manifest.get("version")
    if not isinstance(version, str) or not VERSION_RE.match(version):
        raise SystemExit(f"manifest.json has invalid version: {version!r}")
    return version


def replace_all(text: str, old_version: str, new_version: str) -> str:
    pairs = [
        (old_version, new_version),
        (f"v{old_version}", f"v{new_version}"),
        (old_version.replace(".", r"\."), new_version.replace(".", r"\.")),
    ]
    out = text
    for old, new in pairs:
        out = out.replace(old, new)
    return out


def update_manifest(new_version: str, dry_run: bool) -> bool:
    path = ROOT / "manifest.json"
    before = read(path)
    manifest = json.loads(before)
    manifest["version"] = new_version
    after = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    write(path, after, dry_run)
    return before != after


def update_files(old_version: str, new_version: str, dry_run: bool) -> list[str]:
    changed: list[str] = []
    if update_manifest(new_version, dry_run):
        changed.append("manifest.json")
    for rel in APP_FILES:
        path = ROOT / rel
        before = read(path)
        after = replace_all(before, old_version, new_version)
        if before != after:
            changed.append(rel)
            write(path, after, dry_run)
    return changed


def verify(new_version: str) -> list[str]:
    errors: list[str] = []
    manifest = json.loads(read(ROOT / "manifest.json"))
    if manifest.get("version") != new_version:
        errors.append("manifest.json version mismatch")
    checks = {
        "content.js": [f"const APP_VERSION = '{new_version}'"],
        "injected-main.js": [f"const APP_VERSION = '{new_version}'"],
        "popup.js": [f"const APP_VERSION = '{new_version}'"],
        "popup.html": [f"v{new_version}"],
        "tests/lite-grouping.test.js": [f"extension version is v{new_version}", new_version.replace(".", r"\.")],
    }
    for rel, needles in checks.items():
        text = read(ROOT / rel)
        for needle in needles:
            if needle not in text:
                errors.append(f"{rel} missing {needle!r}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Bump Arcaia extension version across release files.")
    parser.add_argument("version", help="New extension version, e.g. 0.1.112")
    parser.add_argument("--dry-run", action="store_true", help="Show intended changes without writing files")
    args = parser.parse_args()

    if not VERSION_RE.match(args.version):
        raise SystemExit("version must match N.N.N, e.g. 0.1.112")

    old_version = detect_current_version()
    changed = update_files(old_version, args.version, args.dry_run)
    mode = "DRY-RUN" if args.dry_run else "UPDATED"
    print(f"{mode}: {old_version} -> {args.version}")
    for rel in changed:
        print(f"- {rel}")

    if not args.dry_run:
        errors = verify(args.version)
        if errors:
            print("Verification failed:")
            for error in errors:
                print(f"- {error}")
            return 1
        print("Verification passed.")
        print("Suggested checks:")
        print("- node --check content.js && node --check injected-main.js && node --check popup.js")
        print("- node --test tests/lite-grouping.test.js --test-reporter=dot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
