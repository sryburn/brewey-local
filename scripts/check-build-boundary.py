#!/usr/bin/env python3
"""Reject private runtime files in a Next standalone build before packaging it."""
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'frontend/.next/standalone'
if not (root / 'server.js').is_file(): raise SystemExit('Build the standalone application first.')
bad = []
for path in root.rglob('*'):
    if not path.is_file(): continue
    relative = path.relative_to(root)
    if any(part in ('.runtime', '.codex', '.git') for part in relative.parts) or path.name.startswith('.env') or '.sqlite' in path.name or path.suffix == '.db':
        bad.append(str(relative))
if bad: raise SystemExit('Private runtime files in standalone output:\n' + '\n'.join(bad))
print('Standalone output contains no runtime directories, database files or environment files.')
