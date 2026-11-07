import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingredients.styles import parse_styles, download_styles
from ingredients.pipeline import digest

class StyleTests(unittest.TestCase):
    def data(self):
        return json.dumps({'styleguide': {'version': '2021', 'category': [{'subcategory': [
            {'id': '21B', 'name': 'Specialty IPA: Test IPA', 'impression': 'Synthetic description.', 'statistics': {'og': 99}},
            {'id': '21B', 'name': 'Specialty IPA: Another IPA', 'impression': 'Another synthetic description.'}]}]}}).encode()

    def test_substyles_match_names_and_never_import_statistics(self):
        result = parse_styles(self.data(), [{'number': '21B1', 'name': 'Test IPA'}])
        self.assertEqual(result, [{'number': '21B1', 'name': 'Test IPA', 'style_guide': 'BJCP 2021', 'overall_impression': 'Synthetic description.'}])

    def test_missing_and_ambiguous_style_rejected(self):
        with self.assertRaises(ValueError): parse_styles(self.data(), [{'number': '21B9', 'name': 'Missing'}])
        data = json.loads(self.data()); rows = data['styleguide']['category'][0]['subcategory']; rows.append(rows[0])
        with self.assertRaises(ValueError): parse_styles(json.dumps(data), [{'number': '21B1', 'name': 'Test IPA'}])

    def test_verified_cache_and_missing_source(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); data = self.data(); sha = digest(data)
            config = {'locations': [{'url': 'https://example.invalid/styles.json', 'sha256': sha}], 'targets': [{'number': '21B1', 'name': 'Test IPA'}]}
            rows, status = download_styles(config, base, True, base, None)
            self.assertEqual(rows, []); self.assertEqual(status['status'], 'unavailable')
            (base / sha).write_bytes(data)
            rows, status = download_styles(config, base, True, base, None)
            self.assertEqual(len(rows), 1); self.assertEqual(status['status'], 'loaded')
            (base / sha).write_text('corrupt')
            self.assertEqual(download_styles(config, base, True, base, None)[1]['status'], 'unavailable')
