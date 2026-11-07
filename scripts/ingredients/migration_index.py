"""Compile reviewed identity selectors, never downloaded descriptions or brewing data."""
import hashlib
import json
import re
from pathlib import Path

FIELDS = {
    'grains': ['name', 'origin'],
    'hops': ['name', 'origin', 'form'],
    'yeasts': ['name', 'laboratory', 'product_id', 'form'],
    'misc_ingredients': ['name', 'ingredient_type'],
}


def normal(value):
    return re.sub(r'\s+', ' ', str(value or '').strip().lower())


def compile_index(baseline_path, output, rules_path):
    output = Path(output)
    baseline_bytes = Path(baseline_path).read_bytes()
    catalogue_bytes = (output / 'catalog.json').read_bytes()
    baseline, catalogue = json.loads(baseline_bytes), json.loads(catalogue_bytes)
    audit = json.loads((output / 'audit.json').read_text())
    if audit['baseline_sha256'] != hashlib.sha256(baseline_bytes).hexdigest() or audit['catalog_sha256'] != hashlib.sha256(catalogue_bytes).hexdigest():
        raise ValueError('Stale ingredient audit; rebuild the audit before compiling mappings')
    audited = {(r['table'], r['old_id']): r for r in audit['records']}
    targets = {t: {r['id'] for r in catalogue[t]} for t in FIELDS}
    selectors, ambiguous = {}, set()
    for table, fields in FIELDS.items():
        for row in baseline[table]:
            record = audited[table, row['id']]
            if record['status'] not in ('matched', 'remapped', 'excluded'):
                raise ValueError('Unresolved audit entry')
            target = record.get('new_id')
            if target and target not in targets[table]:
                raise ValueError('Mapping target is missing or in another ingredient table')
            key = json.dumps([table, *[normal(row.get(f)) for f in fields]], ensure_ascii=False, separators=(',', ':'))
            if key in selectors and selectors[key] != target:
                ambiguous.add(key)
            selectors[key] = target
    # Conflicting selectors must preserve the source ingredient, not pick a winner.
    for key in ambiguous:
        selectors[key] = None
    rules = json.loads(Path(rules_path).read_text())['rules']
    for rule in rules:
        table = rule['table']
        if table not in FIELDS or set(rule['match']) != set(FIELDS[table]) or rule['new_id'] not in targets[table]:
            raise ValueError('Incomplete or invalid scoped migration rule')
        key = json.dumps([table, *[normal(rule['match'][f]) for f in FIELDS[table]]], ensure_ascii=False, separators=(',', ':'))
        selectors[key] = rule['new_id']
    return {'version': 1, 'baseline_sha256': audit['baseline_sha256'], 'catalog_sha256': audit['catalog_sha256'],
            'fields': FIELDS, 'selectors': dict(sorted(selectors.items()))}
