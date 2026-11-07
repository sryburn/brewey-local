/** @jest-environment node */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GET, POST } from './route'
import { createDatabaseBackup, restoreDatabaseBackup } from '@/lib/server/database-backup'
import { requireSession } from '@/lib/server-session'
import { requireAdmin } from '@/lib/server/auth'

const mockDelete = jest.fn()
jest.mock('next/headers', () => ({ cookies: async () => ({ delete: mockDelete }) }))
jest.mock('@/lib/server/database-backup', () => ({ createDatabaseBackup: jest.fn(), restoreDatabaseBackup: jest.fn(), MAX_BACKUP_BYTES: 100 * 1024 * 1024 }))
jest.mock('@/lib/server/auth', () => ({ requireAdmin: jest.fn(), AuthError: class extends Error {} }))
jest.mock('@/lib/server-session', () => ({ ...jest.requireActual('@/lib/server-session'), requireSession: jest.fn() }))
const session = jest.mocked(requireSession), admin = jest.mocked(requireAdmin)
const create = jest.mocked(createDatabaseBackup), restore = jest.mocked(restoreDatabaseBackup)
const failure = (status: number, message = 'Denied') => Object.assign(new Error(message), { status })
function upload(origin = 'https://brewey.test') {
  const body = new FormData()
  body.set('file', new File(['SQLite format 3\0fixture'], 'backup.sqlite'))
  return new Request('https://brewey.test/api/admin/backup', { method: 'POST', headers: { Origin: origin }, body })
}
beforeEach(() => {
  jest.resetAllMocks()
  session.mockResolvedValue({ user: { id: 'admin' } } as Awaited<ReturnType<typeof requireSession>>)
  restore.mockResolvedValue({ restartRequired: true })
  delete process.env.APP_ORIGIN
})

test('download returns an uncached standalone attachment and removes staging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brewey-download-'))
  const path = join(directory, 'backup.sqlite'), cleanup = jest.fn(async () => { await rm(directory, { recursive: true, force: true }) })
  await writeFile(path, 'SQLite format 3\0fixture')
  create.mockResolvedValue({ path, size: 23, cleanup })
  const response = await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/vnd.sqlite3')
  expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="brewey-.*\.sqlite"$/)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(await response.text()).toBe('SQLite format 3\0fixture')
  expect(admin).toHaveBeenCalledWith('admin')
  expect(cleanup).toHaveBeenCalledTimes(1)
})

test('anonymous/PAT-only and non-administrators cannot download or restore', async () => {
  session.mockRejectedValue(failure(401))
  expect((await GET()).status).toBe(401)
  expect((await POST(upload())).status).toBe(401)
  session.mockResolvedValue({ user: { id: 'member' } } as Awaited<ReturnType<typeof requireSession>>)
  admin.mockImplementation(() => { throw failure(403) })
  expect((await GET()).status).toBe(403)
  expect((await POST(upload())).status).toBe(403)
  expect(create).not.toHaveBeenCalled()
  expect(restore).not.toHaveBeenCalled()
})

test('cross-origin, malformed and oversized uploads never reach restore', async () => {
  expect((await POST(upload('https://untrusted.test'))).status).toBe(403)
  const malformed = new Request('https://brewey.test/api/admin/backup', { method: 'POST', headers: { Origin: 'https://brewey.test', 'Content-Type': 'multipart/form-data; boundary=bad' }, body: 'invalid' })
  expect((await POST(malformed)).status).toBe(400)
  const large = upload(); large.headers.set('Content-Length', String(101 * 1024 * 1024))
  expect((await POST(large)).status).toBe(413)
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(101 * 1024 * 1024)); controller.close() } })
  const chunked = new Request('https://brewey.test/api/admin/backup', { method: 'POST', headers: { Origin: 'https://brewey.test', 'Content-Type': 'multipart/form-data; boundary=large' }, body, duplex: 'half' } as RequestInit)
  expect((await POST(chunked)).status).toBe(413)
  expect(restore).not.toHaveBeenCalled()
})

test('session expiry during upload and busy restore preserve current session', async () => {
  session.mockResolvedValueOnce({ user: { id: 'admin' } } as Awaited<ReturnType<typeof requireSession>>).mockRejectedValueOnce(failure(401))
  expect((await POST(upload())).status).toBe(401)
  expect(restore).not.toHaveBeenCalled()
  restore.mockRejectedValue(failure(409, 'Finish the active chat first.'))
  expect((await POST(upload())).status).toBe(409)
  expect(mockDelete).not.toHaveBeenCalled()
})

test('accepted restore clears the cookie and exits only after returning success', async () => {
  jest.useFakeTimers()
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  try {
    const response = await POST(upload())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, restartRequired: true })
    expect(restore).toHaveBeenCalledWith('admin', expect.any(Uint8Array))
    expect(mockDelete).toHaveBeenCalledWith('brewey-session')
    expect(exit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1000)
    expect(exit).toHaveBeenCalledWith(0)
  } finally { jest.useRealTimers() }
})
