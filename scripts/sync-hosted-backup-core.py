#!/usr/bin/env python3
"""Vendor the export entry point's exact dependency closure; no runtime/source duplication by hand.
Usage: python3 scripts/sync-hosted-backup-core.py /path/to/hosted/frontend [--check]
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('hosted', type=Path)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
source = Path(__file__).resolve().parents[1] / 'frontend/src'
target = args.hosted / 'src/lib/selfhosted-core'
files = {}

def visit(path):
    relative = path.relative_to(source)
    if relative.as_posix() in files:
        return
    content = path.read_bytes()
    files[relative.as_posix()] = content
    if path.suffix != '.ts':
        return
    for dependency in re.findall(r"(?:from\s+|import\s*)['\"]([^'\"]+)['\"]", content.decode()):
        if dependency.startswith('.'):
            visit((path.parent / dependency).resolve())
        elif not dependency.startswith('node:'):
            raise SystemExit('Unexpected external dependency: ' + dependency)

visit(source / 'lib/server/hosted-backup.ts')
manifest = {path: hashlib.sha256(content).hexdigest() for path, content in sorted(files.items())}
files['manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
files['README.md'] = b'# Brewey backup export core\n\nGenerated from Brewey source by scripts/sync-hosted-backup-core.py. Do not edit these files here. The export uses the same schema, typed BrewingApplication and deterministic calculations as local Brewey. No account credentials, personal data or Git history are included. Node 24.15+ is required.\n'
if args.check:
    actual = {p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}
    if actual != set(files) or any(not (target / p).is_file() or (target / p).read_bytes() != data for p, data in files.items()):
        raise SystemExit('Hosted backup core differs; run the sync script.')
else:
    if target.exists():
        for p in target.rglob('*'):
            if p.is_file() and p.relative_to(target).as_posix() not in files:
                raise SystemExit('Unexpected vendored file; inspect before removing: ' + str(p))
    for p, content in files.items():
        destination = target / p
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
print(f'{len(manifest)} core files verified' if args.check else f'{len(manifest)} core files synchronized')
