"""Release boundary checks: styles and migration identities contain no downloaded prose."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('catalog', ROOT / 'scripts/check-catalog.py')
catalog = importlib.util.module_from_spec(spec); spec.loader.exec_module(catalog)

class ReferenceCatalogTests(unittest.TestCase):
    def test_public_metadata(self):
        self.assertEqual(catalog.validate(json.loads(catalog.SEED.read_text())), 123)
        self.assertEqual(catalog.validate_identities(json.loads((ROOT / 'catalog/legacy-identities.json').read_text())), 2117)

    def test_rejects_private_data_prose_duplicates_and_bad_statistics(self):
        seed = json.loads(catalog.SEED.read_text())
        for field in ['overall_impression','notes','email','user_id','inventory']:
            rows = copy.deepcopy(seed); rows[0][field] = 'unexpected'
            with self.assertRaises(ValueError): catalog.validate(rows)
        for mutate in [lambda rows: rows.append(rows[0]), lambda rows: rows[0].update(og_min=float('nan')), lambda rows: rows[0].update(og_min=99)]:
            rows = copy.deepcopy(seed); mutate(rows)
            with self.assertRaises(ValueError): catalog.validate(rows)
        data = json.loads((ROOT / 'catalog/legacy-identities.json').read_text()); data['grains'][0]['notes'] = 'unexpected'
        with self.assertRaises(ValueError): catalog.validate_identities(data)
