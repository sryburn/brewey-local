import React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChatSettingsForm from './ChatSettingsForm'

const mockUpdateUser = jest.fn().mockResolvedValue({ error: null })
let mockAccount: { email: string; planType: string } | null
type MockModel = { id: string; displayName: string; description?: string; isDefault?: boolean; supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }>; defaultReasoningEffort?: string }
const codexDescriptor = { id: 'codex', displayName: 'Codex', accountLabel: 'ChatGPT', description: 'Isolated Codex connection', capabilities: { loginMethods: [{ id: 'deviceCode', label: 'Connect with a device code' }], modelCatalog: true, streaming: true, brewingTools: true, cancellation: true, reasoningEffort: true, reasoningSummaries: true, verbosity: ['low', 'medium', 'high'] } }
let mockAdapters = [codexDescriptor]
let mockModels: MockModel[]
let mockUser: { id: string; user_metadata: Record<string, unknown> }
jest.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mockUser }) }))
jest.mock('@/lib/auth-client', () => ({ authClient: { updateAgentConnection: (...args: unknown[]) => mockUpdateUser(...args) } }))

beforeEach(() => {
  mockAdapters = [codexDescriptor]
  mockAccount = null
  mockUser = { id: 'account-one', user_metadata: {} }
  mockModels = [{ id: 'gpt-codex', displayName: 'Codex model', description: 'A model from your connected account', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Quick decisions' },
    { reasoningEffort: 'medium', description: 'Balanced reasoning' },
    { reasoningEffort: 'high', description: 'Careful recipe analysis' },
  ] }]
  mockUpdateUser.mockClear()
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => {
    if (url === '/api/agent') return { adapters: mockAdapters, selectedAdapterId: String(mockUser.user_metadata.agentAdapter || 'codex'), preferences: mockUser.user_metadata.agentPreferences ? (mockUser.user_metadata.agentPreferences as Record<string, unknown>)[String(mockUser.user_metadata.agentAdapter || 'codex')] : { model: mockUser.user_metadata.codexModel, reasoningEffort: mockUser.user_metadata.codexReasoningEffort, verbosity: mockUser.user_metadata.codexVerbosity } }
    if (url === '/api/agent/account' && options?.method === 'DELETE') { mockAccount = null; return { success: true } }
    if (url === '/api/agent/account') return { account: mockAccount, requiresAuthentication: true }
    if (url === '/api/agent/models') return { models: mockModels }
    if (url === '/api/agent/login') return { method: 'deviceCode', verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-1234', loginId: 'login-one' }
    throw new Error(`Unexpected request: ${url}`)
  } }))
})

test('starts isolated device login and displays its link and code', async () => {
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByText('No ChatGPT account connected')
  await user.click(screen.getByRole('button', { name: 'Connect with a device code' }))
  expect(await screen.findByText('ABCD-1234')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open ChatGPT sign-in' })).toHaveAttribute('href', 'https://auth.openai.com/device')
  expect(global.fetch).toHaveBeenCalledWith('/api/agent/login', expect.objectContaining({ body: JSON.stringify({ method: 'deviceCode' }) }))
})

test('saves the raw Codex model identifier and can restore the server default', async () => {
  mockAccount = { email: 'owner@example.com', planType: 'plus' }
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByRole('option', { name: 'Codex model' })
  expect(screen.getByText('Connected as owner@example.com (plus)')).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Chat model'), 'gpt-codex')
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ adapterId: 'codex', preferences: { model: 'gpt-codex', reasoningEffort: 'medium', verbosity: 'low' } }))
  await user.selectOptions(screen.getByLabelText('Chat model'), '')
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  await waitFor(() => expect(mockUpdateUser).toHaveBeenLastCalledWith({ adapterId: 'codex', preferences: { model: null, reasoningEffort: 'medium', verbosity: 'low' } }))
})

test('reports failed login and allows retry without exposing a stale link', async () => {
  const normalFetch = global.fetch
  global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => url === '/api/agent/login'
    ? Promise.resolve({ ok: false, json: async () => ({ error: 'Device sign-in is unavailable' }) })
    : normalFetch(url, options))
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByText('No ChatGPT account connected')
  await user.click(screen.getByRole('button', { name: 'Connect with a device code' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Device sign-in is unavailable')
  expect(screen.queryByRole('link', { name: 'Open ChatGPT sign-in' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connect with a device code' })).toBeEnabled()
})


test('reconnect replaces the old account and ignores a stale account response while waiting for device login', async () => {
  jest.useFakeTimers()
  try {
    mockAccount = { email: 'old@example.com', planType: 'plus' }
    const normalFetch = global.fetch
    let delayAccountRead = false
    let resolveOldAccount: (response: unknown) => void = () => {}
    global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/agent/account' && options?.method !== 'DELETE' && delayAccountRead) {
        delayAccountRead = false
        return new Promise(resolve => { resolveOldAccount = resolve })
      }
      return normalFetch(url, options)
    })
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    render(<ChatSettingsForm />)
    await screen.findByRole('option', { name: 'Codex model' })
    delayAccountRead = true
    await user.click(screen.getByRole('button', { name: 'Refresh connection' }))
    await user.click(screen.getByRole('button', { name: 'Reconnect with a device code' }))
    await screen.findByText('ABCD-1234')
    expect(global.fetch).toHaveBeenCalledWith('/api/agent/account', { method: 'DELETE' })
    expect(screen.queryByLabelText('Chat model')).not.toBeInTheDocument()
    await act(async () => {
      resolveOldAccount({ ok: true, json: async () => ({ account: { email: 'old@example.com', planType: 'plus' } }) })
    })
    await act(async () => { jest.advanceTimersByTime(5000) })
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument()
    expect(screen.getByText('No ChatGPT account connected')).toBeInTheDocument()
    mockAccount = { email: 'new@example.com', planType: 'plus' }
    await act(async () => { jest.advanceTimersByTime(5000) })
    expect(screen.queryByText('ABCD-1234')).not.toBeInTheDocument()
    expect(screen.getByText('Connected as new@example.com (plus)')).toBeInTheDocument()
    expect(screen.getByLabelText('Chat model')).toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})


test('preserves saved preferences and selects the new model default when models change', async () => {
  mockAccount = { email: 'owner@example.com', planType: 'plus' }
  mockModels.push({ id: 'fast-model', displayName: 'Fast model', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Fast-model thinking' }] })
  mockUser.user_metadata = { codexModel: 'gpt-codex', codexReasoningEffort: 'high', codexVerbosity: 'high' }
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByRole('option', { name: 'Codex model' })
  expect(screen.getByLabelText('Reasoning effort')).toHaveValue('high')
  expect(screen.getByLabelText('Verbosity')).toHaveValue('high')
  expect(screen.getByText('Careful recipe analysis')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  expect(mockUpdateUser).toHaveBeenCalledWith({ adapterId: 'codex', preferences: { model: 'gpt-codex', reasoningEffort: 'high', verbosity: 'high' } })
  await user.selectOptions(screen.getByLabelText('Chat model'), 'fast-model')
  expect(screen.getByLabelText('Reasoning effort')).toHaveValue('low')
  expect(within(screen.getByLabelText('Reasoning effort')).queryByRole('option', { name: 'High' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Verbosity')).toHaveValue('high')
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  expect(mockUpdateUser).toHaveBeenLastCalledWith({ adapterId: 'codex', preferences: { model: 'fast-model', reasoningEffort: 'low', verbosity: 'high' } })
})

test('shows and saves concrete model defaults without Automatic options', async () => {
  mockAccount = { email: 'owner@example.com', planType: 'plus' }
  mockModels = [
    { id: 'first-model', displayName: 'First model', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'First thinking' }] },
    { id: 'default-model', displayName: 'Default model', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Default model thorough thinking' }] },
  ]
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByRole('option', { name: 'Default model' })
  expect(screen.getByLabelText('Chat model')).toHaveValue('')
  expect(within(screen.getByLabelText('Reasoning effort')).queryByRole('option', { name: 'Low' })).not.toBeInTheDocument()
  expect(screen.getByText('Default model thorough thinking')).toBeInTheDocument()
  expect(screen.getByLabelText('Reasoning effort')).toHaveValue('high')
  expect(screen.getByLabelText('Verbosity')).toHaveValue('low')
  expect(screen.queryByRole('option', { name: /Automatic/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  expect(mockUpdateUser).toHaveBeenLastCalledWith({ adapterId: 'codex', preferences: { model: null, reasoningEffort: 'high', verbosity: 'low' } })
  await user.selectOptions(screen.getByLabelText('Reasoning effort'), 'high')
  await user.selectOptions(screen.getByLabelText('Verbosity'), 'medium')
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  expect(mockUpdateUser).toHaveBeenLastCalledWith({ adapterId: 'codex', preferences: { model: null, reasoningEffort: 'high', verbosity: 'medium' } })
})

test('drops an unsupported saved effort instead of sending a stale catalog value', async () => {
  mockAccount = { email: 'owner@example.com', planType: 'plus' }
  mockUser.user_metadata = { codexReasoningEffort: 'xhigh', codexVerbosity: 'low' }
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByRole('option', { name: 'Codex model' })
  expect(screen.getByLabelText('Reasoning effort')).toHaveValue('medium')
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  expect(mockUpdateUser).toHaveBeenCalledWith({ adapterId: 'codex', preferences: { model: null, reasoningEffort: 'medium', verbosity: 'low' } })
})

test('metadata refresh preserves drafts but a previous identity save cannot change the new account view', async () => {
  mockAccount = { email: 'owner@example.com', planType: 'plus' }
  const user = userEvent.setup()
  const { rerender } = render(<ChatSettingsForm />)
  await screen.findByRole('option', { name: 'Codex model' })
  await user.selectOptions(screen.getByLabelText('Reasoning effort'), 'high')
  await user.selectOptions(screen.getByLabelText('Verbosity'), 'low')
  mockUser = { id: 'account-one', user_metadata: { codexReasoningEffort: 'medium', codexVerbosity: 'medium' } }
  rerender(<ChatSettingsForm />)
  expect(screen.getByLabelText('Reasoning effort')).toHaveValue('high')
  expect(screen.getByLabelText('Verbosity')).toHaveValue('low')
  let resolveSave: (value: { error: null }) => void = () => {}
  mockUpdateUser.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve }))
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  mockUser = { id: 'account-two', user_metadata: { codexReasoningEffort: 'low', codexVerbosity: 'high' } }
  rerender(<ChatSettingsForm />)
  await waitFor(() => expect(screen.getByLabelText('Reasoning effort')).toHaveValue('low'))
  await act(async () => { resolveSave({ error: null }) })
  expect(screen.getByLabelText('Verbosity')).toHaveValue('high')
  expect(screen.queryByText('Chat preferences saved. They will apply to your next message.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save chat preferences' })).toBeEnabled()
})


test('only displays capabilities declared by another adapter and saves its own preferences', async () => {
  mockAdapters = [{ ...codexDescriptor, id: 'synthetic', displayName: 'Synthetic agent', accountLabel: 'Synthetic', capabilities: { ...codexDescriptor.capabilities, loginMethods: [], reasoningEffort: false, reasoningSummaries: false, verbosity: [] } }]
  mockUser.user_metadata = { agentAdapter: 'synthetic', agentPreferences: { synthetic: { model: 'gpt-codex', reasoningEffort: null, verbosity: null } }, codexReasoningEffort: 'high', codexVerbosity: 'high' }
  mockAccount = { email: 'test@example.com', planType: 'test' }
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  await screen.findByRole('option', { name: 'Codex model' })
  expect(screen.getByLabelText('Chat model')).toHaveValue('gpt-codex')
  expect(screen.queryByLabelText('Reasoning effort')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Verbosity')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Reconnect/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save chat preferences' }))
  expect(mockUpdateUser).toHaveBeenLastCalledWith({ adapterId: 'synthetic', preferences: { model: 'gpt-codex', reasoningEffort: null, verbosity: null } })
})

test('an unavailable selection remains explicit and can be changed to an installed adapter', async () => {
  mockUser.user_metadata = { agentAdapter: 'removed' }
  const user = userEvent.setup()
  render(<ChatSettingsForm />)
  expect(await screen.findByRole('alert')).toHaveTextContent('The selected agent is unavailable')
  expect(screen.getByLabelText('Agent')).toHaveValue('removed')
  expect(global.fetch).not.toHaveBeenCalledWith('/api/agent/account', expect.anything())
  await user.selectOptions(screen.getByLabelText('Agent'), 'codex')
  expect(mockUpdateUser).toHaveBeenCalledWith({ adapterId: 'codex' })
})
