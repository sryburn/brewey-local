#!/usr/bin/env node
// Use disposable test-account PATs with all capabilities, recipes:read only,
// and a second account with all capabilities, respectively. Never print tokens.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const origin = process.env.BREWEY_API_ORIGIN
const token = process.env.BREWEY_API_TOKEN
const reader = process.env.BREWEY_API_READ_TOKEN
const other = process.env.BREWEY_API_OTHER_TOKEN
if (!origin || !token || !reader || !other) throw new Error('Set BREWEY_API_ORIGIN and the three disposable-account API token environment variables.')
const base = new URL(origin)
if (base.pathname !== '/' || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new Error('BREWEY_API_ORIGIN must be an HTTP(S) origin.')
const created = new Set()
const tag = 'API acceptance ' + randomUUID()
async function call(path, { method = 'GET', key = token, body, status = 200 } = {}) {
  const response = await fetch(new URL(path, base), {
    method, headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  })
  assert.equal(response.status, status, method + ' ' + path + ' returned an unexpected status')
  if (status >= 400) {
    const result = await response.json()
    assert.equal(typeof result.error, 'string', 'Errors must contain a message.')
    return { response, result }
  }
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const result = await response.json()
  if (key) {
    assert.ok(Number(response.headers.get('X-RateLimit-Limit')) > 0)
    assert.ok(Number(response.headers.get('X-RateLimit-Reset')) > Date.now() / 1000)
  }
  return { response, result }
}
async function create(name) {
  const { result } = await call('/api/v1/recipes', { method: 'POST', body: { name, batch_size_liters: 20 }, status: 201 })
  created.add(result.data.id)
  return result.data
}
try {
  await call('/api/v1/recipes', { key: null, status: 401 })
  const recipe = await create(tag + ' source')
  const wrongPath = await create(tag + ' wrong path')
  const root = '/api/v1/recipes/' + recipe.id
  await call(root, { key: reader })
  await call(root, { key: other, status: 404 })
  await call(root, { method: 'PATCH', key: reader, body: { name: 'Denied' }, status: 403 })
  await call(root, { method: 'DELETE', key: other, status: 404 })
  await call('/api/v1/profile', { key: reader, status: 403 })
  await call('/api/v1/catalog/grain', { key: reader, status: 403 })
  await call('/api/v1/recipes?limit=501', { status: 400 })
  await call('/api/v1/recipes?limit=1&limit=2', { status: 400 })
  await call('/api/v1/catalog/grain?min_alpha_acid_percent=1', { status: 400 })
  await call('/api/v1/recipes', { method: 'POST', body: { name: 'Denied owner', user_id: 'other' }, status: 400 })
  const added = {}
  const specs = {
    grain: { amount_kg: 4 }, hop: { amount_grams: 25, use_type: 'boil', time_minutes: 60 },
    yeast: { amount_units: 1 }, misc: { amount_units: 1, use_type: 'mash' },
    water: { name: 'Acceptance water', volume_liters: 25, ca_ppm: 50, mg_ppm: 5, na_ppm: 5, so4_ppm: 50, cl_ppm: 50, hco3_ppm: 20, base_ca_ppm: 0, base_mg_ppm: 0, base_na_ppm: 0, base_so4_ppm: 0, base_cl_ppm: 0, base_hco3_ppm: 0 },
  }
  for (const [kind, spec] of Object.entries(specs)) {
    if (kind !== 'water') {
      const { result: catalog } = await call('/api/v1/catalog/' + kind + '?limit=1' + (kind === 'grain' ? '&q=pilsner' : ''))
      assert.equal(catalog.meta.limit, 1)
      assert.ok(catalog.meta.total > 0)
      const id = catalog.data[0].id
      const { result: record } = await call('/api/v1/catalog/' + kind + '/' + id)
      assert.equal(record.data.id, id)
      spec[kind + '_id'] = id
    }
    const path = root + '/ingredients/' + kind
    const { result } = await call(path, { method: 'POST', body: spec, status: 201 })
    added[kind] = result.data
    const { result: list } = await call(path)
    assert.equal(list.data.length, 1)
    await call(path + '/' + result.data.id, { key: other, status: 404 })
    await call('/api/v1/recipes/' + wrongPath.id + '/ingredients/' + kind + '/' + result.data.id, { status: 404 })
    const update = kind === 'grain' ? { amount_kg: 5 } : kind === 'hop' ? { amount_grams: 30 } : kind === 'water' ? { volume_liters: 26 } : { amount_units: 2 }
    await call(path + '/' + result.data.id, { method: 'PATCH', body: update })
  }
  await call(root + '/ingredients/hop', { method: 'POST', body: { hop_id: specs.hop.hop_id, amount_grams: 10, use_type: 'boil', time_minutes: 61 }, status: 400 })
  const { result: mash } = await call(root + '/steps/mash', { method: 'POST', body: { name: 'First mash', temperature_c: 65, duration_minutes: 30 }, status: 201 })
  const { result: next } = await call(root + '/steps/mash', { method: 'POST', body: { name: 'Second mash', temperature_c: 67, duration_minutes: 30 }, status: 201 })
  await call(root + '/steps/mash/' + next.data.id, { method: 'PATCH', body: { step_order: 1 } })
  const { result: steps } = await call(root + '/steps/mash')
  assert.deepEqual(steps.data.map(row => row.name), ['Second mash', 'First mash'])
  const { result: fermentation } = await call(root + '/steps/fermentation', { method: 'POST', body: { name: 'Primary', temperature_c: 19, duration_days: 7 }, status: 201 })
  await call(root + '/steps/fermentation/' + fermentation.data.id, { method: 'PATCH', body: { end_temperature_c: 21 } })
  const { result: calculated } = await call(root + '/calculations')
  assert.ok(calculated.data.calculated_og > 1)
  assert.equal(calculated.data.batch_size_liters, 20)
  await call(root + '/styles', { key: reader, status: 403 })
  const { result: matches } = await call(root + '/styles?keywords=pale,ale&limit=2')
  assert.equal(matches.data.recipe.id, recipe.id)
  assert.ok(matches.data.returned_count <= 2)
  const { response: exportedResponse, result: exported } = await call(root + '/export')
  assert.equal(exportedResponse.headers.get('Content-Disposition'), 'attachment; filename="recipe.brewey"')
  assert.equal(exported.format, 'brewey-native')
  const { result: imported } = await call('/api/v1/recipes/import', { method: 'POST', body: exported, status: 201 })
  created.add(imported.data.id)
  assert.notEqual(imported.data.id, recipe.id)
  assert.equal(imported.data.recipe_grains[0].amount_kg, 5)
  const { result: cloned } = await call(root + '/clone', { method: 'POST', body: { name: tag + ' clone' }, status: 201 })
  created.add(cloned.data.id)
  const { result: completeClone } = await call('/api/v1/recipes/' + cloned.data.id)
  assert.equal(completeClone.data.recipe_mash_steps.length, 2)
  assert.notEqual(completeClone.data.recipe_grains[0].id, added.grain.id)
  const { result: paged } = await call('/api/v1/recipes?q=' + encodeURIComponent(tag) + '&sort=name&limit=1&offset=1')
  assert.equal(paged.meta.total, 4)
  assert.equal(paged.data.length, 1)
  await call(root + '/steps/mash/' + next.data.id, { method: 'DELETE' })
  const { result: remaining } = await call(root + '/steps/mash')
  assert.equal(remaining.data[0].id, mash.data.id)
  assert.equal(remaining.data[0].step_order, 1)
  await call(root + '/steps/fermentation/' + fermentation.data.id, { method: 'DELETE' })
  for (const [kind, item] of Object.entries(added)) await call(root + '/ingredients/' + kind + '/' + item.id, { method: 'DELETE' })
} finally {
  for (const id of created) await call('/api/v1/recipes/' + id, { method: 'DELETE' })
}
console.log('Live API v1 acceptance passed: scoped PATs, isolation, catalogue, CRUD, timing, calculations, style matching, process order, native import/export and cloning. Disposable recipes removed.')
