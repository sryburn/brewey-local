/** @jest-environment node */
import { POST } from './route'
import { requireFirstRunRestore, previewFirstRunBackup, restoreFirstRunBackup } from '@/lib/server/database-backup'
const mockDelete = jest.fn()
jest.mock('next/headers', () => ({ cookies: async () => ({ delete: mockDelete }) }))
jest.mock('@/lib/server/database-backup', () => ({ requireFirstRunRestore: jest.fn(), previewFirstRunBackup: jest.fn(), restoreFirstRunBackup: jest.fn(), MAX_BACKUP_BYTES: 100 * 1024 * 1024 }))
const authorize = jest.mocked(requireFirstRunRestore), preview = jest.mocked(previewFirstRunBackup), restore = jest.mocked(restoreFirstRunBackup)
function request(mode = 'preview', origin = 'https://brewey.test') {
  const body = new FormData(); body.set('file', new File(['SQLite format 3\0fixture'], 'backup.sqlite'))
  return new Request(`https://brewey.test/api/auth/setup/restore?mode=${mode}`, { method: 'POST', headers: { Origin: origin }, body })
}
beforeEach(() => { jest.resetAllMocks(); delete process.env.APP_ORIGIN })
test('preview is uncached, never restores, and closed setup denies both paths', async () => {
  preview.mockResolvedValue({ accounts: 1, recipes: 7, conversations: 0, schemaVersion: 4, upgradedFrom: null })
  const response = await POST(request())
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
  expect((await response.json()).recipes).toBe(7); expect(restore).not.toHaveBeenCalled()
  authorize.mockImplementation(() => { throw Object.assign(new Error('Closed'), { status: 403 }) })
  expect((await POST(request())).status).toBe(403)
  expect((await POST(request('restore'))).status).toBe(403)
  expect(restore).not.toHaveBeenCalled()
})
test('cross-origin, unknown modes and oversize bodies cannot reach storage', async () => {
  expect((await POST(request('preview', 'https://evil.test'))).status).toBe(403)
  expect((await POST(request('anything'))).status).toBe(400)
  const large = request(); large.headers.set('content-length', String(101 * 1024 * 1024))
  expect((await POST(large)).status).toBe(413)
  expect(preview).not.toHaveBeenCalled(); expect(restore).not.toHaveBeenCalled()
})
test('successful setup restore clears stale cookies and restarts only after responding', async () => {
  jest.useFakeTimers()
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  try {
    restore.mockResolvedValue({ restartRequired: true })
    const response = await POST(request('restore'))
    expect(await response.json()).toEqual({ success: true, restartRequired: true })
    expect(mockDelete).toHaveBeenCalledWith('brewey-session'); expect(exit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1000); expect(exit).toHaveBeenCalledWith(0)
  } finally { jest.useRealTimers(); exit.mockRestore() }
})
