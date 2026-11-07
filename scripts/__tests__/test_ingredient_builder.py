"""Synthetic fixtures exercise identity, data quality and interrupted downloads."""
import copy
import io
import json
from pathlib import Path
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingredients.converters import parse_bsmx, parse_beerxml, parse_reviewed_json, norm
from ingredients.pipeline import build, deb_member, digest, dumps, fingerprint, merge, ingredient_id
from ingredients.audit import audit
from ingredients.quality import inspect, review


def grain(name='Example Malt', color=4, notes='Example notes', supplier='Example Maltster'):
    return f'<Grain><F_G_NAME>{name}</F_G_NAME><F_G_TYPE>0</F_G_TYPE><F_G_COLOR>{color}</F_G_COLOR><F_G_YIELD>80</F_G_YIELD><F_G_RECOMMEND_MASH>1</F_G_RECOMMEND_MASH><F_G_ORIGIN>NZ</F_G_ORIGIN><F_G_SUPPLIER>{supplier}</F_G_SUPPLIER><F_G_NOTES>{notes}</F_G_NOTES><F_G_INVENTORY>999</F_G_INVENTORY><F_G_PRICE>100</F_G_PRICE></Grain>'.encode()


def culture(name='Example Ale', form=0, low=70, high=80):
    return f'<Yeast><F_Y_NAME>{name}</F_Y_NAME><F_Y_LAB>Example Lab</F_Y_LAB><F_Y_PRODUCT_ID>X01</F_Y_PRODUCT_ID><F_Y_TYPE>0</F_Y_TYPE><F_Y_FORM>{form}</F_Y_FORM><F_Y_MIN_TEMP>64.4</F_Y_MIN_TEMP><F_Y_MAX_TEMP>71.6</F_Y_MAX_TEMP><F_Y_MIN_ATTENUATION>{low}</F_Y_MIN_ATTENUATION><F_Y_MAX_ATTENUATION>{high}</F_Y_MAX_ATTENUATION></Yeast>'.encode()


def record(data, source, priority=10, order=0):
    row = parse_bsmx(data)[0][0]
    return dict(row, source=source, priority=priority, order=order, source_sha256=digest(data))


def supplement():
    return {'version': 1, 'records': [{'table': 'yeasts',
        'data': {'name': 'Example New Yeast', 'laboratory': 'Example Lab', 'product_id': 'X02',
                 'form': 'dry', 'yeast_type': 'ale', 'attenuation_percent': 75,
                 'temperature_range_min': 18, 'temperature_range_max': 23, 'notes': 'Synthetic fixture.'},
        'extra': {'MIN_ATTENUATION': '70', 'MAX_ATTENUATION': '80'},
        'evidence': ['https://example.com/yeast'], 'reviewed_on': '2026-10-06',
        'reason': 'Current product absent from the legacy source pack.'}]}


class ConverterTests(unittest.TestCase):
    def test_reviewed_supplement_preserves_ranges_and_evidence(self):
        rows, errors = parse_reviewed_json(dumps(supplement()).encode())
        self.assertFalse(errors)
        self.assertEqual(rows[0]['data']['temperature_range_min'], 18)
        self.assertEqual(rows[0]['review']['evidence'], ['https://example.com/yeast'])
        self.assertEqual(rows[0]['extra']['MAX_ATTENUATION'], '80')

    def test_reviewed_supplement_rejects_private_fields_missing_evidence_and_conflicting_ranges(self):
        for change in ('owner', 'evidence', 'range', 'type'):
            data = supplement(); row = data['records'][0]
            if change == 'owner': row['data']['user_id'] = 'private-account'
            if change == 'evidence': row['evidence'] = []
            if change == 'range': row['data']['attenuation_percent'] = 99
            if change == 'type': del row['data']['yeast_type']
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse_reviewed_json(dumps(data).encode())

    def test_reviewed_supplement_rejects_bad_numeric_extras_and_credential_urls(self):
        data = supplement(); data['records'][0]['evidence'] = ['https://user:secret@example.com/spec']
        with self.assertRaisesRegex(ValueError, 'evidence'):
            parse_reviewed_json(dumps(data).encode())
        for extra in ({'PROTEIN': 'not-a-number'}, {'MOISTURE': '101'}):
            data = supplement(); row = data['records'][0]
            row.update(table='grains', data=parse_bsmx(grain())[0][0]['data'], extra=extra)
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                parse_reviewed_json(dumps(data).encode())
    def test_wrapped_fragments_units_and_privacy(self):
        data = b'<Grain><Name>Container</Name><Data>' + grain(notes='A & B') + grain('Another') + b'</Data></Grain>'
        rows, errors = parse_bsmx(data)
        self.assertEqual(len(rows), 2); self.assertEqual(errors, [])
        self.assertEqual(rows[0]['data']['color_ebc'], 7.88)
        self.assertEqual(rows[0]['data']['extract_potential'], .8)
        self.assertEqual(rows[0]['data']['notes'], 'A & B')
        self.assertNotIn('999', dumps(rows)); self.assertNotIn('PRICE', dumps(rows))

    def test_type_maps_are_not_legacy_importer_maps(self):
        for code, expected in [(1, 'liquid_extract'), (2, 'sugar'), (4, 'dry_extract'), (5, 'fruit'), (6, 'juice'), (7, 'honey')]:
            rows, _ = parse_bsmx(grain().replace(b'<F_G_TYPE>0', f'<F_G_TYPE>{code}'.encode()))
            self.assertEqual(rows[0]['data']['grain_type'], expected)
        for code, expected in [(2, 'herb'), (5, 'water_agent')]:
            rows, _ = parse_bsmx(f'<Misc><F_M_NAME>Example</F_M_NAME><F_M_TYPE>{code}</F_M_TYPE></Misc>'.encode())
            self.assertEqual(rows[0]['data']['ingredient_type'], expected)

    def test_specialty_name_takes_precedence_over_base_malt_words(self):
        for name in ('Pale Chocolate Malt', 'BEST Caramel®Munich I', 'Caramel Malt 2-Row'):
            rows, errors = parse_bsmx(grain(name=name))
            self.assertFalse(errors)
            self.assertEqual(rows[0]['data']['grain_type'], 'specialty')
        self.assertEqual(parse_bsmx(grain(name='Pale Ale Malt'))[0][0]['data']['grain_type'], 'base')

    def test_optional_bad_range_preserves_identity_with_evidence(self):
        rows, errors = parse_bsmx(culture(low=80, high=70))
        self.assertEqual(errors, []); self.assertEqual(rows[0]['data']['attenuation_percent'], 75)
        self.assertEqual(rows[0]['data']['temperature_range_min'], 18)
        self.assertEqual(rows[0]['data']['temperature_range_min'], 18)
        self.assertEqual(rows[0]['repairs'][0]['original'], [80, 70])
        rows, _ = parse_bsmx(culture(high=7802))
        self.assertIsNone(rows[0]['data']['attenuation_percent'])
        self.assertNotIn('MAX_ATTENUATION', rows[0]['extra'])

    def test_sugar_mash_flag_is_corrected_with_evidence(self):
        rows, errors = parse_bsmx(grain().replace(b'<F_G_TYPE>0', b'<F_G_TYPE>2'))
        self.assertFalse(errors)
        self.assertFalse(rows[0]['data']['must_mash'])
        self.assertEqual(rows[0]['repairs'][0]['field'], 'must_mash')

    def test_unknown_types_and_malformed_required_values_are_not_invented(self):
        rows, errors = parse_bsmx(grain().replace(b'<F_G_TYPE>0', b'<F_G_TYPE>99'))
        self.assertFalse(rows); self.assertEqual(len(errors), 1)
        for data in [grain()[:-8], b'<!DOCTYPE x>' + grain(), b'<html>Unavailable</html>']:
            with self.assertRaises(ValueError): parse_bsmx(data)

    def test_beerxml_adapter(self):
        rows, errors = parse_beerxml(b'<YEASTS><YEAST><NAME>Example Ale</NAME><TYPE>Ale</TYPE><FORM>Liquid</FORM><LABORATORY>Example Lab</LABORATORY><MIN_TEMPERATURE>18</MIN_TEMPERATURE><ATTENUATION>75</ATTENUATION></YEAST></YEASTS>')
        self.assertEqual(errors, []); self.assertEqual(rows[0]['data']['attenuation_percent'], 75)


class IdentityTests(unittest.TestCase):
    def test_attenuation_range_cannot_come_from_another_midpoint_source(self):
        preferred = record(culture(), 'preferred', 5)
        preferred['extra'] = {}
        fallback = record(culture(low=80, high=90), 'fallback', 20)
        _, provenance, *_ = merge([preferred, fallback], {'version': 1})
        p = next(iter(provenance.values()))
        self.assertNotIn('MIN_ATTENUATION', p['extra'])
        self.assertEqual(p['fields']['attenuation_percent'], 'preferred')
        fp = fingerprint(fallback)
        with self.assertRaisesRegex(ValueError, 'midpoint'):
            merge([fallback], {'version': 1, 'overrides': {fp: {'fields': {'attenuation_percent': 60}}}})
    def test_quality_flags_do_not_merge_shared_codes_or_zero_extract(self):
        records = [record(culture(name='Example One'), 'one'), record(culture(name='Example Two'), 'two'),
                   record(grain().replace(b'<F_G_YIELD>80', b'<F_G_YIELD>0'), 'three')]
        catalog, provenance, conflicts, *_ = merge(records, {'version': 1})
        before = copy.deepcopy(catalog)
        result = inspect(catalog, provenance, conflicts)
        self.assertEqual(result['summary']['shared_yeast_code'], 1)
        self.assertEqual(result['summary']['zero_extract'], 1)
        self.assertEqual(catalog, before)

    def test_priority_missing_field_fill_and_content_independent_id(self):
        a = record(grain(notes=''), 'primary', 10)
        b = record(grain(color=8, notes='Fallback notes'), 'fallback', 20)
        fp = fingerprint(a); reg = {'version': 1, 'aliases': {fp: 'permanent-example'}}
        both = merge([b, a], reg)
        only = merge([b], reg)
        self.assertEqual(both[0]['grains'][0]['id'], only[0]['grains'][0]['id'])
        self.assertEqual(both[0]['grains'][0]['color_ebc'], 7.88)
        self.assertEqual(both[0]['grains'][0]['notes'], 'Fallback notes')
        self.assertEqual(both[1][ingredient_id('permanent-example')]['fields']['notes'], 'fallback')
        self.assertTrue(both[2])

    def test_different_forms_producers_and_plus_variants_remain_distinct(self):
        records = [record(culture(), 'one'), record(culture(form=1), 'two'), record(culture(name='Example Ale+'), 'three'), record(grain(), 'four'), record(grain(supplier='Another Maltster'), 'five')]
        result = merge(records, {'version': 1})[0]
        self.assertEqual(len(result['yeasts']), 3); self.assertEqual(len(result['grains']), 2)
        self.assertNotEqual(norm('Ale+'), norm('Ale'))
        self.assertEqual(len({r['name'] for r in result['grains']}), 2)

    def test_reviewed_alias_survives_preferred_source_disappearance(self):
        a = record(grain(name='Manufacturer Example'), 'preferred')
        b = record(grain(name='Example - Distributor'), 'fallback', 20)
        registry = {'version': 1, 'aliases': {fingerprint(a): 'stable-example', fingerprint(b): 'stable-example'}}
        normal = merge([a, b], registry)[0]['grains']
        fallback = merge([b], registry)[0]['grains']
        self.assertEqual(len(normal), 1)
        self.assertEqual(normal[0]['id'], fallback[0]['id'])

    def test_invalid_review_override_cannot_bypass_schema(self):
        r = record(grain(), 'one'); fp = fingerprint(r)
        with self.assertRaisesRegex(ValueError, 'grain_type'):
            merge([r], {'version': 1, 'overrides': {fp: {'fields': {'grain_type': 'unknown'}}}})

    def test_reviewed_extra_percentage_is_validated_and_has_provenance(self):
        r = record(grain(), 'one'); fp = fingerprint(r)
        registry = {'version': 1, 'overrides': {fp: {'extra_fields': {'MAX_IN_BATCH': 25}}}}
        result = merge([r], registry)
        p = result[1][ingredient_id(fp)]
        self.assertEqual(p['extra']['MAX_IN_BATCH'], '25')
        self.assertEqual(p['extra_sources']['MAX_IN_BATCH'], 'reviewed override')
        registry['overrides'][fp]['extra_fields']['MAX_IN_BATCH'] = 101
        with self.assertRaisesRegex(ValueError, 'extra override'):
            merge([r], registry)


class DownloadBudgetTests(unittest.TestCase):
    def test_expired_network_budget_still_allows_pinned_local_and_cached_sources(self):
        from ingredients.pipeline import artifact
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); cache = base / 'cache'; cache.mkdir()
            data = grain(); expected = digest(data); (base / 'local.bsmx').write_bytes(data)
            deadline = time.monotonic() - 1
            with patch('ingredients.pipeline.urlopen') as download:
                with self.assertRaisesRegex(ValueError, 'budget exhausted'):
                    artifact({'url': 'https://example.test/source', 'sha256': expected}, cache, False, base, deadline)
                self.assertEqual(artifact({'path': 'local.bsmx', 'sha256': expected}, cache, False, base, deadline)[0], data)
                self.assertEqual(artifact({'url': 'https://example.test/source', 'sha256': expected}, cache, False, base, deadline)[1], 'cache')
                download.assert_not_called()


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        (self.root / 'registry.json').write_text(dumps({'version': 1}))
        (self.root / 'good.bsmx').write_bytes(grain())
        self.good = {'path': 'good.bsmx', 'sha256': digest(grain())}
        self.manifest = {'version': 1, 'registry': 'registry.json', 'sources': [{'id': 'example', 'priority': 10, 'format': 'bsmx', 'locations': [self.good]}]}

    def tearDown(self): self.temp.cleanup()

    def run_build(self):
        path = self.root / 'manifest.json'; path.write_text(dumps(self.manifest))
        return build(path, self.root / 'out', self.root / 'cache', offline=True)

    def test_unavailable_optional_source_fallback_sqlite_and_repeatability(self):
        bad = {'path': 'missing.bsmx', 'sha256': '0' * 64}
        self.manifest['sources'][0]['locations'].insert(0, bad)
        self.manifest['sources'].append({'id': 'unavailable', 'priority': 20, 'format': 'bsmx', 'locations': [bad]})
        report = self.run_build()
        self.assertTrue(report['partial']); self.assertTrue(report['sources'][0]['fallback_errors'])
        before = (self.root / 'out/catalog.json').read_bytes()
        self.run_build(); self.assertEqual(before, (self.root / 'out/catalog.json').read_bytes())
        with closing(sqlite3.connect(self.root / 'out/ingredients.sqlite')) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM grains').fetchone()[0], 1)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_checksum_change_and_total_failure_do_not_replace_existing_output(self):
        self.run_build(); before = (self.root / 'out/catalog.json').read_bytes()
        self.manifest['sources'][0]['locations'] = [{'path': 'good.bsmx', 'sha256': '0' * 64}]
        with self.assertRaisesRegex(ValueError, 'no usable'): self.run_build()
        self.assertEqual(before, (self.root / 'out/catalog.json').read_bytes())

    def test_required_source_failure(self):
        self.manifest['sources'][0].update(required=True, locations=[{'path': 'absent', 'sha256': '0' * 64}])
        with self.assertRaisesRegex(ValueError, 'required source'): self.run_build()

    def test_bundled_supplement_builds_without_network_and_retains_evidence(self):
        payload = dumps(supplement()).encode(); (self.root / 'supplement.json').write_bytes(payload)
        self.manifest['sources'] = [{'id': 'reviewed', 'priority': 5, 'required': True,
            'format': 'reviewed-json', 'locations': [{'path': 'supplement.json', 'sha256': digest(payload)}]}]
        report = self.run_build()
        self.assertEqual(report['counts']['yeasts'], 1)
        p = json.loads((self.root / 'out/provenance.json').read_text())
        self.assertEqual(next(iter(p.values()))['sources'][0]['review']['evidence'], ['https://example.com/yeast'])

    def test_quality_review_must_be_repeated_when_values_change(self):
        payload = grain(color=50); (self.root / 'other.bsmx').write_bytes(payload)
        self.manifest['sources'].append({'id': 'other', 'priority': 20, 'format': 'bsmx',
            'locations': [{'path': 'other.bsmx', 'sha256': digest(payload)}]})
        self.run_build()
        report = review(self.root / 'out')
        finding = next(f for f in report['findings'] if f['kind'] == 'numeric_disagreement')
        decisions = self.root / 'reviews.json'
        decisions.write_text(dumps({'decisions': {finding['issue_key']: {
            'status': 'retain', 'reason': 'Synthetic primary source verified.', 'evidence': ['https://example.com/spec']}}}))
        self.assertEqual(review(self.root / 'out', decisions)['actionable_summary'], {})
        path = self.root / 'out/catalog.json'; data = json.loads(path.read_text())
        data['grains'][0]['color_ebc'] = 10
        path.write_text(dumps(data))
        self.assertEqual(review(self.root / 'out', decisions)['actionable_summary'], {'numeric_disagreement': 1})

    def test_audit_fuzzy_suggestion_does_not_count_as_match(self):
        self.run_build()
        catalog = json.loads((self.root / 'out/catalog.json').read_text())
        baseline = copy.deepcopy(catalog); baseline['grains'][0]['name'] = 'Example Other Malt'
        path = self.root / 'baseline.json'; path.write_text(dumps(baseline))
        report = audit(path, self.root / 'out')
        self.assertEqual(report['summary']['grains'], {'review': 1})

    def test_reviewed_exclusion_is_not_a_missing_or_mapped_ingredient(self):
        self.run_build()
        baseline = json.loads((self.root / 'out/catalog.json').read_text())
        row = baseline['grains'][0]
        path = self.root / 'baseline.json'; path.write_text(dumps(baseline))
        decisions = self.root / 'decisions.json'
        decision = {'old_name': row['name'], 'status': 'excluded', 'new_id': None, 'reason': 'Unused synthetic ingredient.'}
        decisions.write_text(dumps({'mappings': {row['id']: decision}}))
        report = audit(path, self.root / 'out', decisions)
        self.assertEqual(report['summary']['grains'], {'excluded': 1})
        self.assertEqual(json.loads((self.root / 'out/missing.json').read_text()), [])
        self.assertEqual(json.loads((self.root / 'out/cloud-id-map.json').read_text()), {})
        decision['new_id'] = row['id']
        decisions.write_text(dumps({'mappings': {row['id']: decision}}))
        with self.assertRaisesRegex(ValueError, 'target does not match'):
            audit(path, self.root / 'out', decisions)

    def test_retired_identity_redirects_and_cycle_rejection(self):
        fp = fingerprint(record(grain(), 'synthetic'))
        reg = {'version': 1, 'aliases': {fp: 'current'}, 'redirects': {'oldest': 'old', 'old': 'current'}}
        (self.root / 'registry.json').write_text(dumps(reg))
        self.run_build()
        redirects = json.loads((self.root / 'out/retired-id-map.json').read_text())
        self.assertEqual(redirects[ingredient_id('oldest')], ingredient_id('current'))
        reg['redirects']['old'] = 'oldest'
        (self.root / 'registry.json').write_text(dumps(reg))
        with self.assertRaisesRegex(ValueError, 'cyclic'):
            self.run_build()

    def test_archive_reader_only_reads_requested_regular_member(self):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
            entry = tarfile.TarInfo('./usr/share/example.bsmx'); entry.size = len(grain()); tar.addfile(entry, io.BytesIO(grain()))
        payload = buffer.getvalue()
        header = f"{'data.tar.gz/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(payload):<10}`\n".encode()
        archive = b'!<arch>\n' + header + payload + (b'\n' if len(payload) % 2 else b'')
        self.assertEqual(deb_member(archive, 'usr/share/example.bsmx'), grain())
        with self.assertRaises(ValueError): deb_member(archive, '../../other')


if __name__ == '__main__': unittest.main()
