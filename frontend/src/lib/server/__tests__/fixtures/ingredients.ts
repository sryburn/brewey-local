import type { DatabaseSync } from 'node:sqlite';
/** Explicit synthetic catalogue for recipe tests; runtime first-run data is empty. */
export function seedIngredients(db: DatabaseSync) {
    const common = { created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z', notes: 'Test fixture.' };
    const rows = {
        grains: { id: '00000000-0000-4000-8000-000000000001', name: 'Pilsner Malt', grain_type: 'base', color_ebc: 3.5, extract_potential: .8, must_mash: true, origin: 'Test' },
        hops: { id: '00000000-0000-4000-8000-000000000002', name: 'Cascade', alpha_acid_percent: 12, beta_acid_percent: 4, form: 'pellet', hop_type: 'aroma', origin: 'Test' },
        yeasts: { id: '00000000-0000-4000-8000-000000000003', name: 'US-05', laboratory: 'Test', product_id: null, yeast_type: 'ale', form: 'dry', attenuation_percent: 75, temperature_range_min: 18, temperature_range_max: 22 },
        misc_ingredients: { id: '00000000-0000-4000-8000-000000000004', name: 'Gypsum', ingredient_type: 'water_agent' },
    };
    for (const [table, row] of Object.entries(rows)) db.prepare(`INSERT OR IGNORE INTO ${table}(id,data) VALUES(?,?)`).run(row.id, JSON.stringify({ ...common, ...row }));
}
