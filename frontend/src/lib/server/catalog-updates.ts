import type { DatabaseSync } from 'node:sqlite';
import corrections from './reference-catalog-updates.json' with { type: 'json' };

type Correction = {
    table: string;
    id: string;
    name: string;
    changes: Partial<Record<string, { from: unknown; to: unknown }>>;
};
const allowed: Record<string, readonly string[]> = {
    grains: ['grain_type', 'origin'],
    hops: ['hop_type', 'origin'],
    misc_ingredients: ['ingredient_type'],
};

/** Called inside the startup transaction; reference metadata only, never reseed. */
export function applyReferenceCatalogUpdates(db: DatabaseSync): void {
    const ledger = 'reference_catalog_revision';
    const previous = db.prepare('SELECT value FROM installation_settings WHERE key=?').get(ledger);
    const revision = Number(previous?.value ?? 0);
    if (!Number.isSafeInteger(revision) || revision < 0)
        throw new Error('Invalid reference catalogue revision.');
    if (revision >= corrections.revision) return;

    const updates: Correction[] = corrections.updates;
    for (const correction of updates) {
        if (!allowed[correction.table] || Object.keys(correction.changes).some(field => !allowed[correction.table].includes(field)))
            throw new Error('Invalid reference catalogue correction.');
        let existing = db.prepare(`SELECT id,data FROM ${correction.table} WHERE id=? AND json_extract(data,'$.name')=?`).get(correction.id, correction.name);
        if (!existing) {
            // The PostgreSQL cutover preserved generated reference IDs. Resolve
            // their exact name only when unambiguous, keeping those IDs intact.
            const matches = db.prepare(`SELECT id,data FROM ${correction.table} WHERE json_extract(data,'$.name')=?`).all(correction.name);
            if (matches.length === 1) existing = matches[0];
        }
        if (!existing) continue;
        const row = JSON.parse(String(existing.data)) as Record<string, unknown>;
        // Names identify bundled rows. Guard each old value so imported or
        // independently edited metadata never gets replaced by a seed refresh.
        if (row.id !== existing.id || row.name !== correction.name) continue;
        let changed = false;
        for (const [field, values] of Object.entries(correction.changes)) {
            if (!values) throw new Error('Invalid reference catalogue correction.');
            if (row[field] === values.from) {
                row[field] = values.to;
                changed = true;
            }
        }
        if (changed)
            db.prepare(`UPDATE ${correction.table} SET data=? WHERE id=?`).run(JSON.stringify(row), existing.id);
    }
    db.prepare('INSERT INTO installation_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(ledger, String(corrections.revision));
}
