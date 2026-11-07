from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingredients.refresh import refresh, RELATIONS


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / 'app.sqlite'
        self.catalog_path = self.root / 'catalog.json'
        self.backup = self.root / 'backup.sqlite'
        common = lambda name: {'id': str(uuid4()), 'name': name, 'created_at': '1970-01-01T00:00:00.000Z', 'updated_at': '1970-01-01T00:00:00.000Z', 'notes': None}
        self.catalog = {
            'grains': [dict(common('Synthetic Malt'), grain_type='base', color_ebc=5, extract_potential=.8, must_mash=True, origin=None)],
            'hops': [dict(common('Synthetic Hop'), alpha_acid_percent=5, beta_acid_percent=None, form='pellet', hop_type='aroma', origin=None)],
            'yeasts': [dict(common('Synthetic Yeast'), yeast_type='ale', form='dry', laboratory=None, product_id=None, attenuation_percent=75, temperature_range_min=18, temperature_range_max=22)],
            'misc_ingredients': [dict(common('Synthetic Misc'), ingredient_type='other')],
        }
        self.catalog_path.write_text(json.dumps(self.catalog))
        with closing(sqlite3.connect(self.database)) as db, db:
            db.executescript('''PRAGMA user_version=4; PRAGMA foreign_keys=ON;
                CREATE TABLE users(id TEXT PRIMARY KEY, data TEXT);
                INSERT INTO users VALUES ('owner','synthetic account');
                CREATE TABLE installation_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                INSERT INTO installation_settings VALUES ('setup_complete','true');
                CREATE TABLE recipes(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));
                INSERT INTO recipes VALUES ('recipe','owner');
                CREATE TABLE beer_styles(id TEXT PRIMARY KEY,data TEXT NOT NULL);
                CREATE TABLE conversations(id TEXT PRIMARY KEY,recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,status TEXT);
                INSERT INTO conversations VALUES ('chat','recipe','active');
                CREATE TRIGGER recipes_deleted BEFORE DELETE ON recipes BEGIN
                    UPDATE conversations SET status='archived' WHERE recipe_id=OLD.id;
                END;
            ''')
            style = {'id': str(uuid4()), 'name': 'Synthetic Style', 'number': '1A', 'created_at': '1970-01-01', 'updated_at': '1970-01-01'}
            db.execute('INSERT INTO beer_styles VALUES (?,?)', (style['id'], json.dumps(style)))
            for table in self.catalog:
                db.execute(f'CREATE TABLE {table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)')
                db.execute(f'INSERT INTO {table} VALUES (?,?)', ('old-'+table, '{}'))
            for table in RELATIONS:
                db.execute(f'CREATE TABLE {table}(id TEXT PRIMARY KEY,recipe_id TEXT REFERENCES recipes(id) ON DELETE CASCADE)')
                db.execute(f'INSERT INTO {table} VALUES (?,?)', ('old-'+table, 'recipe'))
        with closing(sqlite3.connect(self.database)) as db:
            db.execute('PRAGMA journal_mode=WAL')
        self.before = self.dump(self.database)

    def dump(self, path):
        with closing(sqlite3.connect(path)) as db:
            return '\n'.join(db.iterdump())

    def run_refresh(self, **kwargs):
        return refresh(self.database, self.catalog_path, self.backup, **kwargs)

    def test_refresh_preserves_accounts_styles_and_backup(self):
        result = self.run_refresh(discard_recipes=True)
        self.assertEqual(result['recipes_removed'], 1)
        self.assertEqual(self.dump(self.backup), self.before)
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.backup.read_bytes()[18:20], b'\x01\x01')
        with closing(sqlite3.connect(self.database)) as db, db:
            self.assertEqual(db.execute('SELECT * FROM users').fetchall(), [('owner', 'synthetic account')])
            self.assertEqual(db.execute("SELECT value FROM installation_settings WHERE key='setup_complete'").fetchone()[0], 'true')
            self.assertEqual(db.execute('SELECT count(*) FROM recipes').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM beer_styles').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT recipe_id,status FROM conversations').fetchall(), [(None, 'archived')])
            for table, rows in self.catalog.items():
                self.assertEqual(json.loads(db.execute(f'SELECT data FROM {table}').fetchone()[0]), rows[0])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_failure_rolls_back_recipe_deletion_and_catalogue(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute("CREATE TRIGGER reject_refresh BEFORE INSERT ON hops BEGIN SELECT RAISE(ABORT,'synthetic failure'); END")
        before = self.dump(self.database)
        with self.assertRaisesRegex(sqlite3.IntegrityError, 'synthetic failure'):
            self.run_refresh(discard_recipes=True)
        self.assertEqual(self.dump(self.database), before)
        self.assertEqual(self.dump(self.backup), before)

    def test_requires_consent_and_valid_input_and_unused_backup(self):
        with self.assertRaisesRegex(ValueError, 'discard-recipes'):
            self.run_refresh()
        self.backup.write_text('do not overwrite')
        with self.assertRaises(FileExistsError):
            self.run_refresh(discard_recipes=True)
        self.assertEqual(self.backup.read_text(), 'do not overwrite')
        self.backup.unlink()
        self.catalog['yeasts'][0]['attenuation_percent'] = 101
        self.catalog_path.write_text(json.dumps(self.catalog))
        with self.assertRaises(ValueError):
            self.run_refresh(discard_recipes=True)
        self.assertFalse(self.backup.exists())
        self.assertEqual(self.dump(self.database), self.before)


if __name__ == '__main__':
    unittest.main()
