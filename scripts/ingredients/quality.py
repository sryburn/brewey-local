"""Reproducible triage of a generated catalogue; findings are not auto-fixes."""
from collections import Counter, defaultdict
from pathlib import Path
import re
from .pipeline import atomic_write, digest, dumps, norm, producer, read_json


def inspect(catalog, provenance, conflicts):
    findings, codes, descriptions = [], defaultdict(list), defaultdict(list)
    rows = {r['id']: r for values in catalog.values() for r in values}

    def flag(kind, members, detail, severity='review'):
        key = digest(dumps({'kind': kind, 'ids': sorted(r['id'] for r in members), 'detail': detail}).encode())
        findings.append({'kind': kind, 'severity': severity, 'issue_key': key,
                         'ingredients': [{'id': r['id'], 'name': r['name']} for r in members],
                         'detail': detail})

    for table, values in catalog.items():
        for row in values:
            p = provenance[row['id']]
            note = row.get('notes') or ''
            brand = producer(row.get('laboratory') or p['extra'].get('SUPPLIER'))
            if not note.strip():
                flag('missing_description', [row], 'Source supplies no description.', 'information')
            elif len(note.split()) > 180:
                flag('long_description', [row], f'{len(note.split())} words; review display suitability.', 'information')
            if brand and len(norm(note)) > 100:
                descriptions[table, brand, norm(note)].append(row)
            if table == 'yeasts':
                code = norm(row.get('product_id'))
                # Generic placeholders/species are not unique product codes.
                if code and code not in {'blend', 'brettanomyces', 'lactobacillus', 'dyxx'}:
                    codes[brand, code, row['form']].append(row)
            if table == 'grains':
                if row['grain_type'] == 'base' and re.search(r'crystal|chocolat|caramel|roast|black|biscuit', row['name'], re.I):
                    flag('base_specialty_conflict', [row], 'Specialty process in a base-malt name.')
                if row['extract_potential'] == 0 and not re.search(r'hull|husk', row['name'], re.I):
                    flag('zero_extract', [row], 'Check whether non-fermentability was confused with zero soluble extract.')
    for (brand, code, form), members in sorted(codes.items()):
        if len(members) > 1:
            flag('shared_yeast_code', members, f'{brand} / {code} / {form}: verify identity; a shared code is not proof of duplication.')
    for (_, brand, _), members in sorted(descriptions.items()):
        if len(members) > 1:
            flag('shared_description', members, f'Same description within {brand}; ranges and organic variants may legitimately share text.', 'information')
    seen = set()
    for item in conflicts:
        row = rows[item['id']]
        a, b = row.get(item['field']), item['alternative']
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (a, b)):
            continue
        # A reviewed override already resolves this particular field.
        if provenance[row['id']]['fields'].get(item['field']) == 'reviewed override':
            continue
        difference = abs(a - b)
        threshold = 5 if item['field'].startswith('temperature_') else max(abs(a), abs(b)) * .30
        key = row['id'], item['field'], a, b
        if difference > threshold and key not in seen:
            seen.add(key)
            flag('numeric_disagreement', [row], {'field': item['field'], 'current': a,
                 'alternative': b, 'source': item['alternative_source']})
    return {'counts': {table: len(values) for table, values in catalog.items()},
            'summary': dict(sorted(Counter(f['kind'] for f in findings).items())),
            'findings': findings,
            'scope': 'All records screened by explicit rules. Findings need human interpretation; this is not independent verification of every ingredient.'}


def review(output, decisions_path=None):
    output = Path(output)
    report = inspect(read_json(output / 'catalog.json'), read_json(output / 'provenance.json'),
                     read_json(output / 'conflicts.json'))
    report['catalog_sha256'] = digest((output / 'catalog.json').read_bytes())
    decisions = read_json(decisions_path).get('decisions', {}) if decisions_path else {}
    for finding in report['findings']:
        decision = decisions.get(finding['issue_key'])
        if decision:
            if decision.get('status') not in {'retain', 'distinct', 'unresolved'} or not decision.get('reason') or not decision.get('evidence'):
                raise ValueError('invalid quality review decision')
            finding['review'] = decision
    report['actionable_summary'] = dict(sorted(Counter(
        f['kind'] for f in report['findings'] if f['severity'] == 'review'
        and f.get('review', {}).get('status') not in {'retain', 'distinct'}).items()))
    report['decision_matching'] = 'Reviews apply only to an exact issue kind, ingredient IDs and detail/value snapshot; changed findings need a new review.'
    atomic_write(output / 'quality-report.json', dumps(report).encode())
    return report
