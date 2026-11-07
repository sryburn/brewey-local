import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingredients.migration_index import FIELDS, compile_index


class MigrationIndexTests(unittest.TestCase):
    def fixture(self, root, conflict=False):
        baseline = {table: [] for table in FIELDS}
        baseline['hops'] = [{'id': 'old-a', 'name': 'Saaz', 'origin': 'United States', 'form': 'pellet', 'notes': 'Never ship this prose'}]
        if conflict:
            baseline['hops'].append({**baseline['hops'][0], 'id': 'old-b'})
        catalogue = {table: [] for table in FIELDS}
        catalogue['hops'] = [{'id': 'canonical'}, {'id': 'other'}]
        def write(name, data):
            p = root / name; p.write_text(json.dumps(data)); return hashlib.sha256(p.read_bytes()).hexdigest()
        b = write('baseline.json', baseline); c = write('catalog.json', catalogue)
        write('audit.json', {'baseline_sha256': b, 'catalog_sha256': c, 'records': [
            {'table': 'hops', 'old_id': r['id'], 'status': 'matched', 'new_id': 'canonical' if i == 0 else 'other'} for i, r in enumerate(baseline['hops'])]})
        write('rules.json', {'rules': []})
        return lambda: compile_index(root / 'baseline.json', root, root / 'rules.json')

    def test_only_selectors_are_shipped_and_stale_audits_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); build = self.fixture(root)
            encoded = json.dumps(build())
            self.assertNotIn('Never ship', encoded); self.assertNotIn('old-a', encoded)
            (root / 'catalog.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Stale'): build()

    def test_conflicting_selectors_preserve_originals(self):
        with tempfile.TemporaryDirectory() as directory:
            build = self.fixture(Path(directory), conflict=True)
            self.assertEqual(list(build()['selectors'].values()), [None])

    def test_scoped_rules_require_complete_identity_and_existing_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); build = self.fixture(root)
            for match, target in [({'name': 'Saaz'}, 'canonical'), ({'name': 'Saaz', 'origin': 'United States', 'form': 'pellet'}, 'absent')]:
                (root / 'rules.json').write_text(json.dumps({'rules': [{'table': 'hops', 'match': match, 'new_id': target}]}))
                with self.assertRaisesRegex(ValueError, 'scoped'): build()
