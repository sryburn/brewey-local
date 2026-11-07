import type { DatabaseSync } from 'node:sqlite';
import styles from './style-catalog.json' with { type: 'json' };

const fields = ['overall_impression', 'aroma', 'appearance', 'flavor', 'mouthfeel', 'comments', 'history', 'characteristic_ingredients', 'style_comparison', 'commercial_examples', 'entry_instructions', 'tags', 'currentlydefinedtypes', 'strengthclassifications'];

/** Called within the catalogue import transaction; fill prose without replacing user data. */
export function importStyleDescriptions(db: DatabaseSync, input: unknown) {
    if (!Array.isArray(input) || input.length > styles.length) throw new Error('Invalid styles.');
    const seen = new Set<string>();
    for (const row of input) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid style.');
        const seed = styles.find(style => style.number === row.number && style.name === row.name && style.style_guide === row.style_guide);
        if (!seed || seen.has(seed.id) || Object.keys(row).some(key => !['number', 'name', 'style_guide', ...fields].includes(key))) throw new Error('Unknown style.');
        seen.add(seed.id);
        for (const field of fields) if (row[field] !== undefined && (typeof row[field] !== 'string' || row[field].length > 50000)) throw new Error('Invalid style text.');
        const existing = db.prepare('SELECT data FROM beer_styles WHERE id=?').get(seed.id);
        if (!existing) continue;
        const data = JSON.parse(String(existing.data));
        if (data.number !== seed.number || data.name !== seed.name || data.style_guide !== seed.style_guide) continue;
        for (const field of fields) if (!data[field] && row[field]) data[field] = row[field];
        db.prepare('UPDATE beer_styles SET data=? WHERE id=?').run(JSON.stringify(data), seed.id);
    }
}
