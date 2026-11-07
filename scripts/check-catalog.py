#!/usr/bin/env python3
"""Check the public catalogue metadata boundary; downloaded prose stays outside releases."""
import argparse
import json
import math
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'frontend/src/lib/server/style-catalog.json'
FIELDS = {'id', 'name', 'number', 'category', 'category_number', 'style_guide', 'created_at', 'updated_at'}
FIELDS |= {f'{field}_{end}' for field in ('og', 'fg', 'abv', 'ibu', 'ebc') for end in ('min', 'max')}
IDENTITIES = {'grains': {'id','name','origin'}, 'hops': {'id','name','origin','form'}, 'yeasts': {'id','name','laboratory','product_id','form'}, 'misc_ingredients': {'id','name','ingredient_type'}}


def validate(rows):
    if not isinstance(rows, list) or not rows: raise ValueError('Expected style metadata.')
    ids, numbers = set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != FIELDS: raise ValueError('Unexpected style fields: prose and personal data must not be bundled.')
        UUID(row['id'])
        if row['id'] in ids or row['number'] in numbers or not row['name'].strip(): raise ValueError('Duplicate or invalid style identity.')
        ids.add(row['id']); numbers.add(row['number'])
        if row['style_guide'] != 'BJCP 2021': raise ValueError('Unreviewed style guide.')
        for field in ('og', 'fg', 'abv', 'ibu', 'ebc'):
            values = [row[f'{field}_{end}'] for end in ('min', 'max')]
            for value in values:
                if value is not None and (isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0): raise ValueError('Invalid style statistic.')
            if all(value is not None for value in values) and values[0] > values[1]: raise ValueError('Reversed style range.')
    return len(rows)


def validate_identities(data):
    if set(data) != set(IDENTITIES): raise ValueError('Invalid identity tables.')
    ids = set()
    for table, rows in data.items():
        for row in rows:
            if set(row) != IDENTITIES[table]: raise ValueError('Unexpected legacy identity fields.')
            UUID(row['id'])
            if row['id'] in ids: raise ValueError('Duplicate legacy ID.')
            ids.add(row['id'])
    return len(ids)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', action='store_true', help='Check the same public-data boundary before image publication.')
    parser.parse_args()
    count = validate(json.loads(SEED.read_text()))
    identities = validate_identities(json.loads((ROOT / 'catalog/legacy-identities.json').read_text()))
    config = json.loads((ROOT / 'catalog/styles.json').read_text())
    targets = [{key: row[key] for key in ('number', 'name')} for row in json.loads(SEED.read_text())]
    if config['targets'] != targets: raise SystemExit('Style download targets differ from bundled metadata.')
    if SEED.with_name('reference-catalog.json').exists(): raise SystemExit('Obsolete full catalogue must not be bundled.')
    print(f'Public metadata verified: {count} styles, {identities} migration identities. Third-party descriptions are downloaded, not bundled.')
    print('This check verifies file contents, not permission to reuse downloaded third-party material; see NOTICE.md.')

if __name__ == '__main__': main()
