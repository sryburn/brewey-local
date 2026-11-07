/** @jest-environment node */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase } from '@/lib/server/database'
import { register, createManagedUser, signIn } from '@/lib/server/auth'
import { GET, POST } from './route'
let mockSession: string | undefined
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => mockSession ? { value: mockSession } : undefined }) }))
const directory = mkdtempSync(join(tmpdir(), 'brewey-ingredients-api-'))
const previous = process.env.BREWEY_DATABASE_PATH
let owner: string, member: string
beforeAll(async () => {
  closeDatabase(); process.env.BREWEY_DATABASE_PATH = join(directory, 'test.sqlite')
  const account = await register('owner', 'Test-password-123'); owner = account.session
  await createManagedUser(account.user.id, { username: 'member', password: 'Test-password-456' })
  member = (await signIn('member', 'Test-password-456')).session
})
afterAll(() => { closeDatabase(); rmSync(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.BREWEY_DATABASE_PATH; else process.env.BREWEY_DATABASE_PATH = previous })
test('catalogue setup is restricted to administrator sessions and matching origin', async () => {
  mockSession = undefined; expect((await GET()).status).toBe(401)
  expect((await POST(new Request('https://brewey.test/api/admin/ingredients', { method: 'POST', headers: { Origin: 'https://brewey.test', Authorization: 'Bearer fake-pat' } }))).status).toBe(401)
  mockSession = member; expect((await GET()).status).toBe(403)
  mockSession = owner
  const status = await GET(); expect(status.status).toBe(200); expect(await status.json()).toMatchObject({ state: 'idle', counts: { grains: 0 } })
  expect((await POST(new Request('https://brewey.test/api/admin/ingredients', { method: 'POST', headers: { Origin: 'https://untrusted.test' } }))).status).toBe(403)
})
