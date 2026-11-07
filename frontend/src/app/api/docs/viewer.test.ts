import { readFileSync } from 'node:fs'
import { generateOpenAPISpec } from '@/lib/api/openapi'

const fixture = {
  info: { title: 'Brewey API', description: '## Guide\n\nUse **tokens** and `JSON`.\n\n- [Manage tokens](/settings?tab=tokens)' },
  security: [{ BearerAuth: [] }], tags: [{ name: 'Recipes', description: 'Recipe operations.' }],
  paths: {
    '/api/v1/recipes/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], patch: { tags: ['Recipes'], summary: '<img src=x onerror=alert(1)>', description: 'Edit **one recipe**.', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Recipe' } } } }, responses: { '200': { description: 'Saved **recipe**.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Recipe' } } } } } } },
    '/api/mcp': { get: { tags: ['MCP'], summary: 'Public transport', security: [], responses: { '200': { description: 'Metadata' } } } },
  }, components: { schemas: { Recipe: { type: 'object', required: ['name'], additionalProperties: false, properties: { name: { type: 'string', description: 'A **recipe name**.', maxLength: 500 }, notes: { type: 'string', nullable: true }, format: { type: 'string', enum: ['native', 'json'] } }, example: { name: 'Example' } } } },
}
const descriptions = {
  [fixture.info.description]: '<h2>Guide</h2><p>Use <strong>tokens</strong> and <code>JSON</code>.</p><ul><li><a href="/settings?tab=tokens">Manage tokens</a></li></ul>',
  'Edit **one recipe**.': '<p>Edit <strong>one recipe</strong>.</p>',
  'Saved **recipe**.': '<p>Saved <strong>recipe</strong>.</p>',
  'A **recipe name**.': '<p>A <strong>recipe name</strong>.</p>',
}
function viewer(spec: unknown = fixture, rendered: Record<string, string> = descriptions) {
  document.body.innerHTML = '<main id="app"></main><script type="application/json" id="api-reference-data"></script>'
  document.getElementById('api-reference-data')!.textContent = JSON.stringify({ spec, descriptions: rendered })
  const fetcher = jest.fn().mockResolvedValue({ status: 200, statusText: 'OK', text: async () => '{"saved":true}' })
  const callbacks: Record<string, () => void> = {}
  const fakeWindow = { location: { origin: 'https://brewey.example', hash: '' }, addEventListener: (event: string, callback: () => void) => { if (event === 'DOMContentLoaded') callback(); else callbacks[event] = callback } }
  new Function('window', 'document', 'fetch', readFileSync('public/api-docs/initialize.js', 'utf8'))(fakeWindow, document, fetcher)
  return { fetcher, fakeWindow, callbacks }
}
const input = (selector: string) => document.querySelector<HTMLInputElement>(selector)!
const endpoint = () => document.querySelector<HTMLElement>('.endpoint[data-method=patch]')!
const form = () => endpoint().querySelector('form')!
async function submit() { form().dispatchEvent(new Event('submit', { cancelable: true })); await new Promise(resolve => setTimeout(resolve, 0)) }
function fillRequest() { form().querySelector('input')!.value = 'test/id'; form().querySelector('textarea')!.value = '{"name":"Example"}' }
afterEach(() => { document.body.replaceChildren() })

test('renders Markdown throughout the guide, endpoints, responses and schema tables', () => {
  viewer()
  expect(document.querySelector('h1')!.textContent).toBe('Brewey API')
  expect(document.querySelector('.introduction h2')!.textContent).toBe('Guide')
  expect(document.querySelector('.introduction strong')!.textContent).toBe('tokens')
  expect(document.querySelector('.introduction code')!.textContent).toBe('JSON')
  expect(document.querySelector('.introduction li a')!.getAttribute('href')).toBe('/settings?tab=tokens')
  expect(endpoint().querySelector('.prose strong')!.textContent).toBe('one recipe')
  expect(endpoint().querySelector('.response strong')!.textContent).toBe('recipe')
  const schema = document.getElementById('schema-Recipe')!
  expect(schema.querySelector('table strong')!.textContent).toBe('recipe name')
  expect(schema.textContent).toContain('nullable')
  expect(schema.textContent).toContain('required')
  expect(schema.textContent).toContain('Max. length: 500')
  expect(schema.textContent).toContain('Allowed: "native", "json"')
  expect(schema.textContent).toContain('Additional fields are not allowed.')
  expect(document.querySelector('img')).toBeNull()
  expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>')
})

test('search covers methods, paths, groups and parameters, and handles no matches and clearing', () => {
  viewer()
  const search = input('#endpoint-search')
  for (const term of [' PATCH ', 'recipes/{id}', 'recipes', 'search']) {
    search.value = term; search.dispatchEvent(new Event('input'))
    expect(document.querySelector('[role=status]')!.textContent).toBe('1 of 2 endpoints')
    expect(endpoint().hidden).toBe(false)
  }
  search.value = 'does not exist'; search.dispatchEvent(new Event('input'))
  expect(document.querySelector<HTMLElement>('.empty-state')!.hidden).toBe(false)
  expect([...document.querySelectorAll<HTMLElement>('.endpoint-group')].every(group => group.hidden)).toBe(true)
  search.value = ''; search.dispatchEvent(new Event('input'))
  expect(document.querySelector('[role=status]')!.textContent).toBe('2 of 2 endpoints')
  expect(document.querySelector<HTMLElement>('.empty-state')!.hidden).toBe(true)
})

test('schema links open their definitions and direct hash navigation reveals the target', () => {
  const { fakeWindow, callbacks } = viewer()
  const schema = document.getElementById('schema-Recipe') as HTMLDetailsElement
  endpoint().querySelector<HTMLAnchorElement>('a[href="#schema-Recipe"]')!.click()
  expect(schema.open).toBe(true)
  schema.open = false; schema.scrollIntoView = jest.fn()
  fakeWindow.location.hash = '#schema-Recipe'; callbacks.hashchange()
  expect(schema.open).toBe(true); expect(schema.scrollIntoView).toHaveBeenCalled()
})

test('requests encode paths and queries and send only explicitly entered tokens with no cookies or redirects', async () => {
  const { fetcher } = viewer(); fillRequest()
  input('#api-token').value = ' test-token '
  form().querySelectorAll('input')[1].value = 'a&b / c'
  await submit()
  expect(fetcher).toHaveBeenCalledWith('https://brewey.example/api/v1/recipes/test%2Fid?search=a%26b+%2F+c', {
    method: 'PATCH', credentials: 'omit', redirect: 'error', cache: 'no-store', body: '{"name":"Example"}', headers: { Accept: 'application/json', Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  })
  expect(form().querySelector('.request-result')!.textContent).toContain('200 OK\n{\n  "saved": true\n}')
  expect(window.localStorage.length).toBe(0)
  document.querySelector<HTMLButtonElement>('.token-row button')!.click()
  expect(input('#api-token').value).toBe('')
  await submit()
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined()
})

test('invalid or missing JSON, missing path values and dot paths cannot send requests', async () => {
  const { fetcher } = viewer(); fillRequest()
  const body = form().querySelector('textarea')!
  for (const value of ['invalid JSON', ' ']) { body.value = value; await submit(); expect(fetcher).not.toHaveBeenCalled() }
  body.value = '{}'
  for (const value of ['', '..', '.']) { form().querySelector('input')!.value = value; await submit(); expect(fetcher).not.toHaveBeenCalled() }
  expect(form().querySelector<HTMLButtonElement>('button')!.disabled).toBe(false)
})

test('HTTP and network errors stay readable and never render response HTML', async () => {
  const { fetcher } = viewer(); fillRequest()
  fetcher.mockResolvedValueOnce({ status: 401, statusText: 'Unauthorized', text: async () => '<img src=x onerror=alert(1)>' })
  await submit(); expect(form().textContent).toContain('401 Unauthorized'); expect(document.querySelector('img')).toBeNull()
  fetcher.mockRejectedValueOnce(new Error('Network unavailable'))
  await submit(); expect(form().textContent).toContain('Network unavailable')
  expect(form().querySelector<HTMLButtonElement>('button')!.disabled).toBe(false)
})

test('all real endpoints, parameters, response statuses and schemas have readable views and working reference targets', () => {
  const spec = generateOpenAPISpec(); viewer(spec, {})
  let operationCount = 0
  for (const [path, operations] of Object.entries(spec.paths)) for (const [method, operation] of Object.entries(operations)) {
    if (!['get', 'post', 'patch', 'delete'].includes(method)) continue
    operationCount++
    const section = [...document.querySelectorAll<HTMLElement>('.endpoint')].find(node => node.dataset.path === path && node.dataset.method === method)!
    expect(section).toBeDefined()
    const op = operation as { responses: Record<string, unknown> }
    expect([...section.querySelectorAll('.response > summary')].map(node => node.textContent)).toEqual(Object.keys(op.responses))
  }
  expect(document.querySelectorAll('.endpoint')).toHaveLength(operationCount)
  expect(document.querySelectorAll('.schema-definition')).toHaveLength(Object.keys(spec.components.schemas).length)
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#schema-"]')) expect(document.getElementById(link.hash.slice(1))).not.toBeNull()
  for (const control of document.querySelectorAll('input, select, textarea')) expect(control.closest('label') || document.querySelector(`label[for="${control.id}"]`)).not.toBeNull()
  const kind = [...document.querySelectorAll<HTMLElement>('.endpoint')].find(node => node.dataset.path === '/api/v1/catalog/{kind}' && node.dataset.method === 'get')!.querySelector('select')!
  expect([...kind.options].map(option => option.value)).toEqual(['', 'grain', 'hop', 'yeast', 'misc', 'style'])
})

test('invalid document data shows a recovery link instead of leaving an empty page', () => {
  viewer(null)
  expect(document.querySelector('h1')!.textContent).toBe('API reference unavailable')
  expect(document.querySelector('a')!.getAttribute('href')).toBe('/api/docs/openapi.json')
})
