import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ProfileSettingsForm from './ProfileSettingsForm'
import { getProfile, saveProfile } from '@/lib/api/profile'
let mockUser: { id: string; user_metadata: Record<string, unknown> } | null
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mockUser }) }))
jest.mock('@/lib/api/profile', () => ({ getProfile: jest.fn(), saveProfile: jest.fn() }))
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => function Editor({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <textarea aria-label="Brewer profile" value={value} onChange={event => onChange(event.target.value)} /> } }))
beforeEach(() => { jest.useFakeTimers(); mockUser = { id: 'one', user_metadata: {} }; jest.mocked(getProfile).mockResolvedValue({ data: { id: 'one', profile: 'My first profile', unit_system: 'metric', created_at: '', updated_at: '' }, error: null }); jest.mocked(saveProfile).mockResolvedValue({ data: null, error: null }); jest.clearAllMocks() })
afterEach(() => { jest.useRealTimers() })
test('an account switch cancels a pending autosave of the previous brewer profile', async () => {
  const view = render(<ProfileSettingsForm />)
  await act(async () => {})
  fireEvent.change(screen.getByRole('textbox', { name: 'Brewer profile' }), { target: { value: 'Private first-account notes' } })
  mockUser = { id: 'two', user_metadata: {} }
  jest.mocked(getProfile).mockResolvedValue({ data: { id: 'two', profile: 'Second brewer', unit_system: 'imperial', created_at: '', updated_at: '' }, error: null })
  view.rerender(<ProfileSettingsForm />)
  await act(async () => { jest.advanceTimersByTime(1500) })
  expect(saveProfile).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Brewer profile' })).toHaveValue('Second brewer')
})
test('a late previous-account profile response cannot replace the new brewer profile', async () => {
  let finish: (value: Awaited<ReturnType<typeof getProfile>>) => void = () => {}
  jest.mocked(getProfile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const view = render(<ProfileSettingsForm />)
  mockUser = { id: 'two', user_metadata: {} }
  jest.mocked(getProfile).mockResolvedValue({ data: { id: 'two', profile: 'Second brewer', unit_system: 'metric', created_at: '', updated_at: '' }, error: null })
  view.rerender(<ProfileSettingsForm />)
  await act(async () => { finish({ data: { id: 'one', profile: 'Private first-account notes', unit_system: 'imperial', created_at: '', updated_at: '' }, error: null }) })
  expect(screen.getByRole('textbox', { name: 'Brewer profile' })).toHaveValue('Second brewer')
})
