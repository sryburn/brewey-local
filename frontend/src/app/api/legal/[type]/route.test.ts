/** @jest-environment node */
import { GET } from './route'
test.each(['terms_of_use', 'privacy_policy'])('serves the existing public page contract for %s without a hosted backend', async type => {
  const response = await GET(new Request('http://localhost/api/legal/' + type), { params: Promise.resolve({ type }) })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.data).toMatchObject({ document_type: type, is_active: true, version: '2' })
  expect(body.data.content).toContain('installation')
  expect(body.data.content).not.toContain('Supabase')
})
test('does not expose arbitrary documents', async () => {
  const response = await GET(new Request('http://localhost/api/legal/unknown'), { params: Promise.resolve({ type: 'unknown' }) })
  expect(response.status).toBe(404)
})
