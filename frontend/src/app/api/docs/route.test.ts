/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
jest.mock('@/lib/api/reference-markdown', () => ({ referenceData: () => '{"spec":{},"descriptions":{}}' }))
import { GET } from './route'
import { GET as getSpecification } from './openapi.json/route'

test('serves the browser reference as HTML with local assets and a specification download', async () => {
  const response = GET()
  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
  const html = await response.text()
  expect(html).toContain('<title>Brewey API Documentation</title>')
  expect(html).toContain('<main id="app">')
  expect(html).toContain('id="api-reference-data"')
  expect(html).toContain('/api/docs/openapi.json')
  expect(html).toContain('href="/settings?tab=tokens"')
  expect(html).toContain('/api-docs/initialize.js')
  expect(html).not.toMatch(/(?:src|href)="https?:/)
})

test('serves OpenAPI JSON with resolvable schema references and implemented route methods', async () => {
  const response = getSpecification()
  expect(response.headers.get('content-type')).toContain('application/json')
  const specification = await response.json()
  expect(specification.openapi).toBe('3.0.3')
  expect(specification.servers).toEqual([{ url: '/', description: 'This Brewey installation' }])
  const references = [...JSON.stringify(specification).matchAll(/"\$ref":"#\/components\/schemas\/([^"\/]+)"/g)]
  expect(references.length).toBeGreaterThan(0)
  for (const [, name] of references) expect(specification.components.schemas[name]).toBeDefined()
  for (const [path, operations] of Object.entries(specification.paths)) {
    const routeFile = join(process.cwd(), 'src/app', path.replace(/\{([^}]+)\}/g, '[$1]'), 'route.ts')
    const route = readFileSync(routeFile, 'utf8')
    for (const method of Object.keys(operations as object)) {
      if (['get', 'post', 'patch', 'delete'].includes(method)) {
        expect(route).toMatch(new RegExp(`export (?:async )?function ${method.toUpperCase()}\\(`))
      }
    }
  }
  expect(specification.paths['/api/v1/recipes'].post.responses['201'].content['application/json'].schema.properties.data.$ref).toBe('#/components/schemas/Recipe')
  expect(specification.paths['/api/mcp'].get.security).toEqual([])
  expect(specification.paths['/api/mcp'].post.description).toContain('same domain capabilities')
  expect(specification.info.description).toContain('recipes:write')
  expect(specification.info.description).not.toContain('**api** scope')
  expect(specification.paths['/api/v1/recipes'].get.responses['200'].content['application/json'].schema.properties.meta.$ref).toBe('#/components/schemas/PageMetadata')
  expect(specification.paths['/api/v1/recipes/{id}/export'].get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/NativeImport')
  expect(specification.paths['/api/v1/catalog/{kind}'].get.parameters.map((parameter: { name: string }) => parameter.name)).toContain('min_alpha_acid_percent')
  expect(specification.components.schemas.RecipeInput.additionalProperties).toBe(false)
  expect(specification.components.schemas.NativeImport.required).toEqual(['format', 'recipe'])
  expect(specification.components.schemas.RecipeInput.example).toEqual({ name: 'Weekend pale ale', batch_size_liters: 20, boil_time_minutes: 60, efficiency_percent: 75 })
  expect(specification.components.schemas.MashStep.required).toContain('duration_minutes')
  expect(specification.components.schemas.FermentationStep.required).toContain('duration_days')
  expect(specification.components.schemas.HopItem.properties.time_minutes.nullable).toBe(true)
  expect(specification.components.schemas.WaterItem.properties.water_calculations.nullable).toBe(true)
})
