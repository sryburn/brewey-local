import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateRecipe, calculateOg, calculateFg, calculateIbu, calculateAbv, roundNumeric, whirlpoolUtilization } from '../calculations.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/postgres.json', import.meta.url)));
for (const fixture of fixtures.cases) {
  test(`PostgreSQL parity: ${fixture.name}`, () => {
    assert.deepEqual(calculateRecipe(fixture.recipe), fixture.expected);
  });
}

test('numeric rounding matches PostgreSQL half-away-from-zero at decimal ties', () => {
  assert.equal(roundNumeric(1.0505, 3), 1.051);
  assert.equal(roundNumeric(2.675, 2), 2.68);
  assert.equal(roundNumeric(-1.25, 1), -1.3);
  assert.equal(roundNumeric(0.00000001, 3), 0);
  assert.equal(calculateAbv(1.058, 1.015), 5.64);
  assert.equal(calculateAbv(null, 1.01), null);
});

test('missing/invalid batch volume returns null calculations rather than NaN or Infinity', () => {
  const expected = { calculated_og: null, calculated_fg: null, calculated_abv: null, calculated_ibu: null, calculated_ebc: null };
  for (const batch_size_liters of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.deepEqual(calculateRecipe({ batch_size_liters }), expected);
  }
  // Domain inputs are metric; an imperial input must first pass unit conversion.
  assert.deepEqual(calculateRecipe({ batch_size_gallons: 5 }), expected);
});

test('NULL OG arguments recalculate gravity, matching private function defaults', () => {
  const recipe = fixtures.cases.find(item => item.name === 'efficiency-75').recipe;
  assert.equal(calculateFg(recipe, null), calculateFg(recipe));
  assert.equal(calculateIbu(recipe, null), calculateIbu(recipe));
});

test('unknown extract propagates null gravity; unknown colour is skipped independently', () => {
  const recipe = { batch_size_liters: 20, recipe_grains: [{ amount_kg: 4, grains: { extract_potential: null, color_ebc: null, must_mash: true } }] };
  assert.deepEqual(calculateRecipe(recipe), { calculated_og: null, calculated_fg: null, calculated_abv: null, calculated_ibu: null, calculated_ebc: 0 });
});

test('only mash-required fermentables receive efficiency, including an explicit zero', () => {
  const grain = { amount_kg: 4, grains: { extract_potential: 0.8, color_ebc: 4, must_mash: true } };
  const mashed = { batch_size_liters: 20, efficiency_percent: 0, recipe_grains: [grain] };
  assert.equal(calculateOg(mashed), 1);
  assert.equal(calculateOg({ ...mashed, recipe_grains: [{ ...grain, grains: { ...grain.grains, must_mash: false } }] }), 1.061);
});

test('whirlpool bands use inclusive temperature boundaries and NULL is minimal utilisation', () => {
  for (const [temperature, factor] of [[null, 0.02], [59.9, 0.02], [60, 0.043], [65, 0.07], [70, 0.1], [75, 0.165], [80, 0.23], [85, 0.36], [90, 0.49], [95, 0.75]]) {
    assert.equal(whirlpoolUtilization(temperature), factor);
  }
});

test('calculations do not mutate the persisted metric recipe', () => {
  const recipe = structuredClone(fixtures.cases.find(item => item.name === 'mixed-fermentables-and-yeasts').recipe);
  const original = structuredClone(recipe);
  calculateRecipe(recipe);
  assert.deepEqual(recipe, original);
});
