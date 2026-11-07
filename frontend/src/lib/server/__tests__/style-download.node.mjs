import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { importStyleDescriptions } from '../style-download.ts';
import styles from '../style-catalog.json' with { type: 'json' };

test('downloaded prose fills metadata while preserving identities, statistics and existing prose', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE beer_styles(id TEXT PRIMARY KEY, data TEXT NOT NULL)');
    const seed = styles[0];
    const original = { ...seed, comments: 'Custom style note.' };
    db.prepare('INSERT INTO beer_styles VALUES (?,?)').run(seed.id, JSON.stringify(original));
    const row = { number: seed.number, name: seed.name, style_guide: seed.style_guide, overall_impression: 'Synthetic style description.', comments: 'Downloaded note.' };
    importStyleDescriptions(db, [row]);
    const actual = JSON.parse(db.prepare('SELECT data FROM beer_styles').get().data);
    assert.deepEqual(actual, { ...original, overall_impression: row.overall_impression });
    importStyleDescriptions(db, []);
    assert.throws(() => importStyleDescriptions(db, [{ ...row, og_min: 1.1 }]));
    assert.throws(() => importStyleDescriptions(db, [{ ...row, name: 'Unknown style' }]));
    assert.throws(() => importStyleDescriptions(db, [row, row]));
  } finally { db.close(); }
});
