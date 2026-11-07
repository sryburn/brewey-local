import { authClient } from './auth-client'
const user = { id: 'one', email: 'owner@example.com', user_metadata: {}, app_metadata: { provider: 'email' }, created_at: 'now', updated_at: 'now' }
function response(value: unknown, status = 200) { return { ok: status < 400, status, json: async () => value } as Response }
beforeEach(() => { global.fetch = jest.fn().mockResolvedValue(response({ user })); jest.clearAllMocks() })
test('local signin uses the same-origin HttpOnly session API without persisting credentials', async () => {
  const listener = jest.fn(); const sub = authClient.onAuthStateChange(listener)
  await authClient.signInWithPassword({ email: user.email, password: 'secret-password' })
  expect(fetch).toHaveBeenCalledWith('/api/auth/signin', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ email: user.email, password: 'secret-password' }) }))
  expect(listener).toHaveBeenCalledWith('SIGNED_IN', { user })
  expect(JSON.stringify(jest.mocked(localStorage.setItem).mock.calls)).not.toContain('secret-password')
  expect(JSON.stringify(jest.mocked(localStorage.setItem).mock.calls)).not.toContain(user.email)
  sub.data.subscription.unsubscribe()
})
test('cross-tab signout clears immediately and invalidates an outstanding session refresh', async () => {
  let finish: (response: Response) => void = () => {}
  jest.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const listener = jest.fn(); const sub = authClient.onAuthStateChange(listener)
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new StorageEvent('storage', { key: 'brewey-auth-event', newValue: JSON.stringify({ event: 'SIGNED_OUT' }) }))
  expect(listener).toHaveBeenLastCalledWith('SIGNED_OUT', null)
  finish(response({ user })); await new Promise(resolve => setTimeout(resolve, 0))
  expect(listener).toHaveBeenCalledTimes(1)
  sub.data.subscription.unsubscribe()
})
test('cross-tab sign-in discards previous identity before fetching the verified new session', async () => {
  const listener = jest.fn(); const sub = authClient.onAuthStateChange(listener)
  window.dispatchEvent(new StorageEvent('storage', { key: 'brewey-auth-event', newValue: JSON.stringify({ event: 'SIGNED_IN', user: { id: 'untrusted' } }) }))
  expect(listener).toHaveBeenCalledWith('SIGNED_OUT', null)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(listener).toHaveBeenLastCalledWith('SESSION_CHANGED', { user })
  expect(fetch).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ credentials: 'same-origin' }))
  sub.data.subscription.unsubscribe()
})
test('successful password change signs out because all server sessions are revoked', async () => {
  const listener = jest.fn(); const sub = authClient.onAuthStateChange(listener)
  await authClient.updateUser({ password: 'new-password', currentPassword: 'old-password' })
  expect(listener).toHaveBeenLastCalledWith('SIGNED_OUT', null)
  sub.data.subscription.unsubscribe()
})

test('a focus refresh started during sign-in cannot suppress or undo the completed login', async () => {
  let finishLogin: (response: Response) => void = () => {}
  let finishRefresh: (response: Response) => void = () => {}
  jest.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishLogin = resolve })).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve }))
  const listener = jest.fn(); const sub = authClient.onAuthStateChange(listener)
  const login = authClient.signInWithPassword({ email: user.email, password: 'password' })
  window.dispatchEvent(new Event('focus'))
  finishLogin(response({ user })); await login
  finishRefresh(response({ user: null })); await new Promise(resolve => setTimeout(resolve, 0))
  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenLastCalledWith('SIGNED_IN', { user })
  sub.data.subscription.unsubscribe()
})
