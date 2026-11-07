import { act, fireEvent, render, screen } from '@testing-library/react'
import BackupSettings from './BackupSettings'
import SettingsPage from '@/app/settings/page'

let mockUser: { id: string; is_admin: boolean } | null
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mockUser }) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSearchParams: () => new URLSearchParams('tab=backup') }))

const backup = () => new File(['synthetic SQLite fixture'], 'fixture.sqlite', { type: 'application/vnd.sqlite3' })
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
const choose = (file = backup()) => fireEvent.change(screen.getByLabelText('Backup file (.sqlite, up to 100 MiB)'), { target: { files: [file] } })
const confirm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore and replace all data' }))
}

beforeEach(() => {
  mockUser = { id: 'owner', is_admin: true }
  global.fetch = jest.fn()
  URL.createObjectURL = jest.fn(() => 'blob:synthetic-backup')
  URL.revokeObjectURL = jest.fn()
})
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers() })

it.each([null, { id: 'member', is_admin: false }])('does not expose backup actions or fetch for a non-admin identity %s', user => {
  mockUser = user
  render(<BackupSettings />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('integrates an administrator Backup tab, while a direct backup tab URL exposes no controls to members', () => {
  const view = render(<SettingsPage />)
  expect(screen.getByRole('button', { name: /^Backup/ })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Save backup' })).toBeInTheDocument()
  mockUser = { id: 'member', is_admin: false }
  view.rerender(<SettingsPage />)
  expect(screen.queryByRole('button', { name: /^Backup/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save backup' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('downloads the SQLite blob with its server filename and same-origin credentials, then revokes the URL', async () => {
  jest.useFakeTimers()
  const blob = new Blob(['synthetic backup'])
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => blob, headers: new Headers({ 'Content-Disposition': 'attachment; filename="installation.sqlite"' }) })
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<BackupSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Save backup' }))
  expect(screen.getByRole('button', { name: 'Saving backup…' })).toBeDisabled()
  await act(async () => { await Promise.resolve() })
  expect(fetch).toHaveBeenCalledWith('/api/admin/backup', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal: expect.any(AbortSignal) }))
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
  const clicked = click.mock.contexts[0] as HTMLAnchorElement
  expect(clicked?.download).toBe('installation.sqlite')
  expect(clicked?.href).toBe('blob:synthetic-backup')
  expect(clicked?.isConnected).toBe(false)
  expect(screen.getByRole('status')).toHaveTextContent('Keep this file private')
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  await act(async () => { await jest.advanceTimersByTimeAsync(1000) })
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-backup')
})

it.each([
  ["attachment; filename*=UTF-8''brewey%20saved.sqlite", 'brewey saved.sqlite'],
  ['attachment; filename="../../installation.sqlite"', 'installation.sqlite'],
  [null, null],
])('uses an encoded or safe fallback download filename for %s', async (disposition, expected) => {
  const headers = new Headers(disposition ? { 'Content-Disposition': disposition } : {})
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['fixture']), headers })
  let filename = ''
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
  render(<BackupSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Save backup' }))
  await screen.findByRole('status')
  if (expected) expect(filename).toBe(expected)
  else expect(filename).toMatch(/^brewey-backup-.*\.sqlite$/)
})

it('requires file selection and a separate confirmation before sending multipart restore; cancellation sends nothing', () => {
  render(<BackupSettings />)
  expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled()
  expect(screen.getByText('No file selected')).toBeInTheDocument()
  const picker = screen.getByLabelText('Backup file (.sqlite, up to 100 MiB)')
  const click = jest.spyOn(picker, 'click')
  fireEvent.click(screen.getByRole('button', { name: 'Choose backup file' }))
  expect(click).toHaveBeenCalledTimes(1)
  choose()
  expect(screen.getByText('fixture.sqlite')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
  expect(screen.getByText(/replaces all current installation data/)).toHaveTextContent('every account, recipe, chat, setting and API token')
  expect(screen.getByText(/Use the usernames and passwords/)).toBeInTheDocument()
  expect(screen.getByText(/Changes made since this backup will be lost/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Confirm restore and replace all data' })).not.toBeInTheDocument()
})

it('sends the selected file once and blocks other operations while restore is pending', async () => {
  let finish!: (value: ReturnType<typeof json>) => void
  global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<BackupSettings />)
  const file = backup()
  choose(file); confirm()
  const pending = screen.getByRole('button', { name: 'Restoring backup…' })
  fireEvent.click(pending)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [path, options] = jest.mocked(fetch).mock.calls[0]
  expect(path).toBe('/api/admin/backup')
  expect(options).toEqual(expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: expect.any(FormData), signal: expect.any(AbortSignal) }))
  expect(options?.headers).toBeUndefined()
  expect((options?.body as FormData).get('file')).toBe(file)
  expect(screen.getByRole('button', { name: 'Save backup' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Choose backup file' })).toBeDisabled()
  expect(screen.getByLabelText('Backup file (.sqlite, up to 100 MiB)')).toBeDisabled()
  await act(async () => { finish(json({ error: 'Another operation is running. Try again shortly.' }, 409)) })
  expect(screen.getByRole('alert')).toHaveTextContent('Another operation is running')
  expect(screen.getByRole('button', { name: 'Confirm restore and replace all data' })).toBeEnabled()
})

it.each(['empty', 'large', 'extension'] as const)('rejects an %s file locally without starting restore', kind => {
  render(<BackupSettings />)
  const file = kind === 'empty' ? new File([], 'empty.sqlite') : kind === 'extension' ? new File(['fixture'], 'backup.txt') : backup()
  if (kind === 'large') Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 + 1 })
  choose(file)
  expect(screen.getByRole('alert')).toHaveTextContent(kind === 'extension' ? 'Choose a .sqlite backup file.' : 'no larger than 100 MiB')
  expect(screen.getByRole('button', { name: 'Restore backup' })).toBeDisabled()
  expect(fetch).not.toHaveBeenCalled()
})

it('changing the selected file invalidates the old confirmation', () => {
  render(<BackupSettings />)
  choose()
  fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
  choose(new File(['different fixture'], 'different.sqlite'))
  expect(screen.queryByRole('button', { name: 'Confirm restore and replace all data' })).not.toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('waits for restart readiness after restore, with no health request during the first two seconds', async () => {
  jest.useFakeTimers()
  // JSDOM reports full-document navigation instead of loading the destination.
  const navigation = jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn().mockImplementation((path: string) => Promise.resolve(json(path === '/api/admin/backup' ? { success: true, restartRequired: true } : { status: 'ok' })))
  render(<BackupSettings />)
  choose(); confirm()
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('status')).toHaveTextContent('Backup restored. Brewey is restarting…')
  expect(screen.queryByRole('button', { name: 'Restore backup' })).not.toBeInTheDocument()
  await act(async () => { await jest.advanceTimersByTimeAsync(1999) })
  expect(fetch).toHaveBeenCalledTimes(1)
  await act(async () => { await jest.advanceTimersByTimeAsync(1) })
  expect(fetch).toHaveBeenLastCalledWith('/api/health', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }))
  expect(screen.getByRole('link', { name: 'Sign in with a restored account' })).toHaveAttribute('href', '/signin')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(navigation).toHaveBeenCalledWith(expect.stringContaining('Not implemented: navigation'))
})

it('offers operator restart and sign-in when the server does not return, without allowing another restore', async () => {
  jest.useFakeTimers()
  global.fetch = jest.fn().mockImplementation((path: string) => path === '/api/admin/backup' ? Promise.resolve(json({ success: true, restartRequired: true })) : Promise.reject(new Error('Offline')))
  render(<BackupSettings />)
  choose(); confirm()
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000) })
  expect(screen.getByRole('status')).toHaveTextContent('Backup restored. Restart Brewey, then sign in with an account from the backup.')
  expect(screen.getByRole('link', { name: 'Sign in with a restored account' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Restore backup' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save backup' })).toBeDisabled()
  expect(jest.mocked(fetch).mock.calls.filter(([path]) => path === '/api/admin/backup')).toHaveLength(1)
})

it('shows a safe generic error for a non-JSON failed download and enables retry', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => { throw new Error('Malformed response') } })
  render(<BackupSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Save backup' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save backup. Please try again.')
  expect(screen.getByRole('button', { name: 'Save backup' })).toBeEnabled()
})

it('aborts and ignores a late previous-account download after an identity switch', async () => {
  let finish!: (value: unknown) => void
  global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const view = render(<BackupSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Save backup' }))
  const signal = jest.mocked(fetch).mock.calls[0][1]?.signal
  mockUser = { id: 'different-owner', is_admin: true }
  view.rerender(<BackupSettings />)
  expect(signal?.aborted).toBe(true)
  await act(async () => { finish({ ok: true, blob: async () => new Blob(['fixture']), headers: new Headers() }) })
  expect(click).not.toHaveBeenCalled()
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save backup' })).toBeEnabled()
})

it('cancels restart polling on unmount instead of navigating a later account', async () => {
  jest.useFakeTimers()
  global.fetch = jest.fn().mockResolvedValue(json({ success: true, restartRequired: true }))
  const view = render(<BackupSettings />)
  choose(); confirm()
  await act(async () => { await Promise.resolve() })
  view.unmount()
  await act(async () => { await jest.advanceTimersByTimeAsync(30_000) })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not show restore success or start restart polling for a late previous-account response', async () => {
  let finish!: (value: ReturnType<typeof json>) => void
  global.fetch = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<BackupSettings />)
  choose(); confirm()
  mockUser = { id: 'different-owner', is_admin: true }
  view.rerender(<BackupSettings />)
  await act(async () => { finish(json({ success: true, restartRequired: true })) })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save backup' })).toBeEnabled()
  expect(fetch).toHaveBeenCalledTimes(1)
})
