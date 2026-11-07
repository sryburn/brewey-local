import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FirstRunRestore from './first-run-restore'
import { waitForRestart } from '@/lib/backup-client'
jest.mock('@/lib/backup-client', () => ({ waitForRestart: jest.fn().mockResolvedValue(false) }))
const file = () => new File(['synthetic'], 'brewey.sqlite')
const choose = () => fireEvent.change(screen.getByLabelText(/Backup file/), { target: { files: [file()] } })
beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn() })
test('requires a validated preview and explicit confirmation; switching files invalidates the preview', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ accounts: 2, recipes: 9, conversations: 4, upgradedFrom: 3 }) } as Response)
  render(<FirstRunRestore onBack={jest.fn()} />); choose()
  expect(screen.queryByRole('button', { name: 'Confirm restore' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Check backup' }))
  expect(await screen.findByText('9 recipes, 2 accounts and 4 saved chats.')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/auth/setup/restore?mode=preview', expect.objectContaining({ credentials: 'same-origin', body: expect.any(FormData) }))
  expect(screen.getByRole('button', { name: 'Confirm restore' })).toBeEnabled()
  choose(); expect(screen.queryByRole('button', { name: 'Confirm restore' })).not.toBeInTheDocument()
})
test('restore waits for restart and explains restored credentials without creating an owner', async () => {
  jest.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ accounts: 1, recipes: 1, conversations: 0 }) } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, restartRequired: true }) } as Response)
  render(<FirstRunRestore onBack={jest.fn()} />); choose(); fireEvent.click(screen.getByRole('button', { name: 'Check backup' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm restore' }))
  await waitFor(() => expect(waitForRestart).toHaveBeenCalled())
  expect(await screen.findByText(/Restart Brewey, then sign in/)).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})
test('invalid backup leaves setup retryable and does not offer confirmation', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: 'Unsupported backup' }) } as Response)
  render(<FirstRunRestore onBack={jest.fn()} />); choose(); fireEvent.click(screen.getByRole('button', { name: 'Check backup' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported backup')
  expect(screen.queryByRole('button', { name: 'Confirm restore' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check backup' })).toBeEnabled()
})
