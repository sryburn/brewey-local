import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalIngredientId, mapHostedIngredients } from '../hosted-ingredients.ts'

const us = '788bb695-5a95-5ba4-997e-5cd84813520a'
const hop = { id: 'production-id', name: 'Saaz', origin: 'United States', form: 'pellet', alpha_acid_percent: 4, notes: 'Synthetic notes' }
function snapshot(hops, recipe_hops) {
  return { grains: [], recipe_grains: [], hops, recipe_hops, yeasts: [], recipe_yeasts: [], misc_ingredients: [], recipe_misc: [] }
}
test('scoped US Saaz mapping tolerates casing/spacing but never crosses origin or form', () => {
  assert.equal(canonicalIngredientId('hops', hop), us)
  assert.equal(canonicalIngredientId('hops', { ...hop, id: 'other-production-id', origin: ' UNITED  STATES ' }), us)
  for (const changes of [{ origin: '' }, { origin: 'Czech Republic' }, { form: 'whole' }, { name: 'Saaz Plus' }]) {
    assert.notEqual(canonicalIngredientId('hops', { ...hop, ...changes }), us)
  }
})
test('export maps only referenced ingredients, keeps source properties, and does not mutate the input', () => {
  const source = snapshot([hop, { ...hop, id: 'unused' }], [{ id: 'relation', hop_id: hop.id, amount_grams: 20 }])
  const before = structuredClone(source), result = mapHostedIngredients(source)
  assert.deepEqual(source, before)
  assert.equal(result.tables.hops.length, 1)
  assert.deepEqual(result.tables.hops[0], { ...hop, id: us })
  assert.equal(result.tables.recipe_hops[0].hop_id, us)
})
test('duplicate aliases merge while different brewing values remain separate and deterministic', () => {
  const rows = [{ ...hop, id: 'a' }, { ...hop, id: 'b', notes: 'Other synthetic notes' }, { ...hop, id: 'c', alpha_acid_percent: 9 }, { ...hop, id: 'd', alpha_acid_percent: 9 }]
  const source = snapshot(rows, rows.map(row => ({ hop_id: row.id }))), result = mapHostedIngredients(source)
  assert.equal(result.tables.hops.length, 2)
  assert.deepEqual(result.summary, { mapped: 2, preserved: 0, variants: 2, merged: 2 })
  const variantId = result.tables.recipe_hops[2].hop_id
  assert.notEqual(variantId, us)
  assert.equal(result.tables.recipe_hops[3].hop_id, variantId)
  assert.equal(result.tables.hops.find(row => row.id === variantId).alpha_acid_percent, 9)
  assert.deepEqual(mapHostedIngredients(snapshot([...rows].reverse(), source.recipe_hops)), result)
})
test('unknown and formerly excluded ingredients are retained, missing referenced rows fail', () => {
  const unknown = { ...hop, name: 'Synthetic proprietary blend' }
  const source = snapshot([unknown], [{ hop_id: hop.id }])
  const a = mapHostedIngredients(source), b = mapHostedIngredients(source)
  assert.deepEqual(a, b); assert.equal(a.summary.preserved, 1)
  assert.notEqual(a.tables.hops[0].id, hop.id)
  assert.throws(() => mapHostedIngredients(snapshot([], [{ hop_id: 'missing' }])), /missing/)
  const excluded = { id: 'custom', name: 'Dutch cocoa', ingredient_type: 'flavor' }
  const misc = { ...snapshot([], []), misc_ingredients: [excluded], recipe_misc: [{ misc_id: 'custom' }] }
  assert.equal(mapHostedIngredients(misc).tables.misc_ingredients[0].name, 'Dutch cocoa')
})
