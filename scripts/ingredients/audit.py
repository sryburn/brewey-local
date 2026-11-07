"""Baseline-to-new catalogue mapping. Fuzzy suggestions never count as matches."""
from collections import defaultdict, Counter
from difflib import SequenceMatcher
from pathlib import Path
from .pipeline import read_json, dumps, norm, country, producer, digest, atomic_write
from .converters import TABLES


def audit(baseline_path, output, decisions_path=None):
    output = Path(output)
    baseline, catalog = read_json(baseline_path), read_json(output / 'catalog.json')
    provenance = read_json(output / 'provenance.json')
    decisions = read_json(decisions_path).get('mappings', {}) if decisions_path else {}
    names, codes = defaultdict(set), defaultdict(set)
    rows = {row['id']: row for table in TABLES for row in catalog[table]}
    for identifier, p in provenance.items():
        row = rows[identifier]; table = p['table']
        for name in {row['name']} | {r['name'] for r in p['sources']}:
            names[table, norm(name)].add(identifier)
        if table == 'yeasts' and norm(row.get('product_id')):
            codes[producer(row.get('laboratory')), norm(row['product_id']), row['form']].add(identifier)
    results = []
    for table in TABLES:
        for old in baseline[table]:
            entry = {'table': table, 'old_id': old['id'], 'name': old['name']}
            if old['id'] in decisions:
                decision = decisions[old['id']]
                if decision['old_name'] != old['name']: raise ValueError('stale audit decision')
                target = decision.get('new_id')
                if decision['status'] not in ('remapped', 'missing', 'excluded'):
                    raise ValueError('invalid audit decision status')
                if (decision['status'] == 'remapped') != bool(target):
                    raise ValueError('audit decision target does not match status')
                if target and (target not in rows or provenance[target]['table'] != table): raise ValueError('invalid reviewed mapping target')
                entry.update(status=decision['status'], new_id=target, reason=decision['reason'])
                if target: entry['new_name'] = rows[target]['name']
                results.append(entry); continue
            candidates = set(names[table, norm(old['name'])])
            # Product codes are only usable when they select one new identity.
            if table == 'yeasts' and norm(old.get('product_id')):
                found = codes[producer(old.get('laboratory')), norm(old['product_id']), old['form']]
                if len(found) == 1: candidates = set(found)
            compatible = set()
            for identifier in candidates:
                row = rows[identifier]
                if table in ('hops', 'yeasts') and old.get('form') != row.get('form'): continue
                if table == 'yeasts' and producer(old.get('laboratory')) != producer(row.get('laboratory')): continue
                if table in ('hops', 'grains') and old.get('origin') and row.get('origin') and country(old['origin']) != country(row['origin']): continue
                compatible.add(identifier)
            if len(compatible) == 1:
                identifier = compatible.pop()
                entry.update(status='matched', new_id=identifier, new_name=rows[identifier]['name'], reason='Unique name/alias or producer product code, compatible origin/form.')
            else:
                suggestions = []
                for row in catalog[table]:
                    score = max(SequenceMatcher(None, norm(old['name']), norm(s['name'])).ratio() for s in provenance[row['id']]['sources'])
                    if score >= .40: suggestions.append({'id': row['id'], 'name': row['name'], 'score': round(score, 3), 'origin': row.get('origin'), 'form': row.get('form'), 'laboratory': row.get('laboratory')})
                entry.update(status='review', reason='Ambiguous identity' if compatible else 'No compatible exact identity', suggestions=sorted(suggestions, key=lambda s: (-s['score'], s['id']))[:5])
            results.append(entry)
    summary = {t: dict(Counter(r['status'] for r in results if r['table'] == t)) for t in TABLES}
    document = {'baseline_sha256': digest(Path(baseline_path).read_bytes()), 'catalog_sha256': digest((output / 'catalog.json').read_bytes()), 'summary': summary, 'records': results}
    atomic_write(output / 'audit.json', dumps(document).encode())
    atomic_write(output / 'cloud-id-map.json', dumps({r['old_id']: r['new_id'] for r in results if r.get('new_id')}).encode())
    missing = [r for r in results if r['status'] in ('missing', 'review')]
    atomic_write(output / 'missing.json', dumps(missing).encode())
    excluded = [r for r in results if r['status'] == 'excluded']
    atomic_write(output / 'excluded-legacy.json', dumps(excluded).encode())
    build = read_json(output / 'build-report.json')
    total = sum(build['counts'].values())
    matched = sum(bool(r.get('new_id')) for r in results)
    repairs = [s for p in provenance.values() for s in p['sources'] if s.get('repairs')]
    lines = ['# Ingredient catalogue audit', '', 'This command compares the bundled reference catalogue only. Reviewed decisions may incorporate a separate production usage check; baseline UUIDs are not verified production UUIDs.', '',
             f"The build contains **{total:,} ingredients**, compiled from {build['input_records']:,} records in {sum(s['status'] == 'loaded' for s in build['sources'])} loaded source definitions. It merges {build['merged_records']:,} overlapping records. Counts: " + ', '.join(f'{t} {n:,}' for t, n in build['counts'].items()) + '.', '',
             f"**{matched:,} of {len(results):,} existing ingredient records ({matched / len(results):.1%}) have a match or reviewed proposed remapping.** {len(excluded)} are intentionally excluded by reviewed decisions; {len(missing)} remain missing or unresolved.", '',
             'Reviewed remappings can include commodity supplier or yeast-form substitutions. These are proposed migration choices, not claims that the original formulations were identical. The full mapping table below identifies those decisions.', '',
             f"Build completeness: {'partial; inspect unavailable sources in build-report.json' if build['partial'] else 'all selected sources loaded'}. Rejected records: {len(build['rejected'])}. Source records with logged repairs/omissions: {len(repairs)}. Field disagreements resolved by priority: {build['conflict_count']}. These counts do not imply independent verification of every supplier specification.", '',
             'Outputs include ingredients.sqlite, catalog.json, schema-oriented beerjson.json, per-field provenance.json and conflicts.json. The current application catalogue is unchanged.', '',
             '| Table | Matched | Reviewed remapping | Excluded | Missing/unresolved | Needs review |', '|---|---:|---:|---:|---:|---:|']
    for t, counts in summary.items(): lines.append(f"| {t} | {counts.get('matched', 0)} | {counts.get('remapped', 0)} | {counts.get('excluded', 0)} | {counts.get('missing', 0)} | {counts.get('review', 0)} |")
    lines += ['', '## Missing ingredients and unresolved identities', '']
    for r in missing: lines += [f"- **{r['name']}** ({r['table']}): {r['reason']}"]
    lines += ['', '## Intentionally excluded legacy entries', '']
    for r in excluded: lines += [f"- **{r['name']}** ({r['table']}): {r['reason']}"]
    lines += ['', '## Reviewed remappings', '', '| Old name | New name | Reason |', '|---|---|---|']
    for r in results:
        if r['status'] == 'remapped': lines.append('| ' + ' | '.join(str(r[k]).replace('|', '/') for k in ('name', 'new_name', 'reason')) + ' |')
    lines += ['', 'Machine-readable details: audit.json, missing.json and cloud-id-map.json. A remapping may intentionally change brewing values; it is not a guarantee of identical recipe calculations.', '']
    atomic_write(output / 'AUDIT.md', '\n'.join(lines).encode())
    return document
