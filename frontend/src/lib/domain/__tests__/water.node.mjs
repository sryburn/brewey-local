import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateWater, calculateWaterAnalysis } from '../water.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/water.json', import.meta.url)));
for (const fixture of fixtures.cases) {
  test(`legacy water calculator parity: ${fixture.name}`, () => {
    assert.deepEqual(calculateWater(fixture.water), fixture.expected);
  });
}

test('unknown base ions leave calculations null; zero remains a known base value', () => {
  const water = fixtures.cases.find(item => item.name === 'all-zero-known-base').water;
  assert.equal(calculateWater(water).success, true);
  for (const field of ['ca', 'mg', 'na', 'so4', 'cl', 'hco3']) {
    assert.equal(calculateWater({ ...water, [`base_${field}_ppm`]: null }), null);
    assert.equal(calculateWater({ ...water, [`base_${field}_ppm`]: undefined }), null);
  }
});

test('salt additions cannot reduce ions already above target', () => {
  const fixture = fixtures.cases.find(item => item.name === 'lower-than-base');
  const result = calculateWater(fixture.water);
  assert.equal(result.success, true);
  assert.equal(result.total_salt_weight_grams, 0);
  assert.equal(result.calculated_profile.ca_ppm, 50);
  assert.equal(result.deviations.ca_ppm, 50);
});

test('achieved profile uses precise salts even when small displayed weights round to zero', () => {
  const fixture = fixtures.cases.find(item => item.name === 'precise-profile-rounded-salts');
  const result = calculateWater(fixture.water);
  assert.equal(result.total_salt_weight_grams, 0);
  assert(result.calculated_profile.ca_ppm > 0);
});

test('invalid volumes fail instead of allowing negative/infinite salt quantities', () => {
  const water = fixtures.cases[0].water;
  for (const volume_liters of [-1, 0, 0.01, 1001, Infinity, NaN]) {
    assert.equal(calculateWater({ ...water, volume_liters }).success, false);
  }
});

test('no chloride has an explicit balance; the MCP compatibility field uses ratio zero', () => {
  const profile = { Ca: 30, Mg: 5, Na: 10, SO4: 50, Cl: 0, HCO3: 80 };
  assert.equal(calculateWaterAnalysis(profile).sulfateChlorideRatio, null);
  const water = fixtures.cases.find(item => item.name === 'no-chloride-analysis').water;
  assert.equal(calculateWater(water).water_analysis.sulfate_chloride_ratio, 0);
  assert.equal(calculateWater(water).water_analysis.sulfate_chloride_balance, 'N/A (No Chloride)');
});

test('water optimisation does not mutate target or base profile fields', () => {
  const water = structuredClone(fixtures.cases[0].water);
  const before = structuredClone(water);
  calculateWater(water);
  assert.deepEqual(water, before);
});
