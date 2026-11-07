#!/usr/bin/env python3
"""Regenerate the reviewed cloud-export identity index from a complete audited build."""
import argparse
import json
from pathlib import Path
from ingredients.audit import audit
from ingredients.migration_index import compile_index

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--build', type=Path, required=True)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
baseline = root / 'catalog/legacy-identities.json'
audit(baseline, args.build, root / 'catalog/legacy-mappings.json')
index = compile_index(baseline, args.build, root / 'catalog/migration-rules.json')
destination = root / 'frontend/src/lib/server/ingredient-migration-index.json'
content = json.dumps(index, ensure_ascii=False, indent=2) + '\n'
if args.check:
    if not destination.exists() or destination.read_text() != content:
        raise SystemExit('Ingredient migration index differs; regenerate it.')
else:
    destination.write_text(content)
print(f'{len(index["selectors"])} ingredient identity selectors verified')
