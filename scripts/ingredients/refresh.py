"""Offline operator maintenance for an existing local Brewey installation."""
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from uuid import UUID

from .converters import validate as validate_ingredient
from .pipeline import TABLES

ROOT = Path(__file__).resolve().parents[1]
RELATIONS = ('recipe_grains', 'recipe_hops', 'recipe_yeasts', 'recipe_misc',
             'recipe_water', 'recipe_mash_steps', 'recipe_fermentation_steps')


def refresh(database, catalog_path, backup_path, *, discard_recipes=False):
    """Replace only ingredient tables, after explicit recipe-discard consent.

    The application must be stopped. Keep the same database file/inode, schema,
    accounts, settings, styles and provider state. Recipe-dependent rows follow
    the application's foreign keys/triggers. No production/network access.
    """
    if not discard_recipes:
        raise ValueError('Explicit --discard-recipes is required.')
    database = Path(database).resolve(strict=True)
    catalog_path = Path(catalog_path).resolve(strict=True)
    backup_path = Path(backup_path).absolute()
    if backup_path.resolve() in (database, catalog_path):
        raise ValueError('Backup must have a separate, unused path.')
    raw = catalog_path.read_bytes()
    catalog = json.loads(raw)
    if not isinstance(catalog, dict) or set(catalog) != set(TABLES):
        raise ValueError('Expected exactly the four ingredient tables.')
    corrections = json.loads((ROOT.parent / 'frontend/src/lib/server/reference-catalog-updates.json').read_text())
    with closing(sqlite3.connect(database.as_uri() + '?mode=rw', uri=True, timeout=10)) as db:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            if db.execute('PRAGMA user_version').fetchone()[0] not in (2, 3, 4):
                raise ValueError('Unsupported application database schema.')
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Existing database failed integrity checks.')
            ids = set()
            for table, records in catalog.items():
                if not isinstance(records, list) or not records: raise ValueError('Ingredient tables must be nonempty arrays.')
                names = set()
                fields = {'grains': {'color_ebc','extract_potential','grain_type','must_mash','origin'}, 'hops': {'alpha_acid_percent','beta_acid_percent','form','hop_type','origin'}, 'yeasts': {'attenuation_percent','form','laboratory','product_id','temperature_range_min','temperature_range_max','yeast_type'}, 'misc_ingredients': {'ingredient_type'}}
                for row in records:
                    if not isinstance(row, dict) or set(row) - fields[table] - {'id','name','notes','created_at','updated_at'}: raise ValueError('Unexpected ingredient fields.')
                    UUID(row['id'])
                    if row['id'] in ids or row['name'] in names: raise ValueError('Duplicate ingredient identity.')
                    ids.add(row['id']); names.add(row['name'])
                    validate_ingredient(table, row)
            before = {t: db.execute(f'SELECT count(*) FROM {t}').fetchone()[0]
                      for t in (*TABLES, 'recipes', 'users')}
            # Reserve the file privately and exclusively; never overwrite backups.
            backup_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            try:
                # A second read-only connection can snapshot the pre-write state
                # while BEGIN IMMEDIATE prevents another writer changing it.
                source = sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)
                snapshot = sqlite3.connect(backup_path)
                try:
                    source.backup(snapshot)
                    snapshot.execute('PRAGMA journal_mode=DELETE')
                    if snapshot.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or snapshot.execute('PRAGMA foreign_key_check').fetchall():
                        raise ValueError('Backup failed integrity checks.')
                finally:
                    snapshot.close()
                    source.close()
                with backup_path.open('rb') as backup_file:
                    os.fsync(backup_file.fileno())
            except BaseException:
                backup_path.unlink(missing_ok=True)
                raise
            db.execute('DELETE FROM recipes')
            for table in RELATIONS:
                if db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]:
                    raise ValueError('Recipe cleanup left dependent rows.')
            for table in TABLES:
                db.execute(f'DELETE FROM {table}')
                db.executemany(f'INSERT INTO {table}(id,data) VALUES (?,?)',
                               [(row['id'], json.dumps(row, ensure_ascii=False, separators=(',', ':'))) for row in catalog[table]])
            # Old bundled corrections must not be applied by name to new data.
            previous = db.execute("SELECT value FROM installation_settings WHERE key='reference_catalog_revision'").fetchone()
            revision = max(int(previous[0]) if previous else 0, corrections['revision'])
            db.executemany('INSERT INTO installation_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                           [('reference_catalog_revision', str(revision)),
                            ('ingredient_catalog_sha256', hashlib.sha256(raw).hexdigest())])
            if db.execute('PRAGMA foreign_key_check').fetchall() or db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('Refreshed database failed integrity checks.')
            db.commit()
        except BaseException:
            db.rollback()
            raise
        return {'database': str(database), 'backup': str(backup_path),
                'recipes_removed': before['recipes'], 'accounts_preserved': before['users'],
                'counts': {t: len(catalog[t]) for t in TABLES},
                'catalog_sha256': hashlib.sha256(raw).hexdigest(), 'integrity': 'ok'}
