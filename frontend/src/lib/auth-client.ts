import type { AppUser } from '@/types/user'

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED' | 'SESSION_CHANGED'
export type LocalSession = { user: AppUser }
type Listener = (event: AuthEvent, session: LocalSession | null) => void
const listeners = new Set<Listener>()
let stopNotifications: (() => void) | undefined
let revision = 0
const eventKey = 'brewey-auth-event'

function notify(event: AuthEvent, user: AppUser | null) {
  for (const listener of listeners) listener(event, user ? { user } : null)
}
function announce(event: AuthEvent) {
  // Only a refresh signal crosses tabs. No user information or session secrets.
  try { localStorage.setItem(eventKey, JSON.stringify({ event, nonce: crypto.randomUUID() })) } catch { /* focus refresh is still available */ }
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  const result = response.status === 204 ? {} : await response.json()
  if (!response.ok) throw new Error(result.error || result.message || 'Unable to complete account request')
  return result as T
}
async function mutate(path: string, method: string, body: unknown, event: AuthEvent) {
  const current = ++revision
  try {
    const result = await request<{ user: AppUser }>(path, method, body)
    if (current === revision) { ++revision; notify(event, event === 'SIGNED_OUT' ? null : result.user); announce(event) }
    return { data: { user: result.user }, error: null }
  } catch (error) {
    return { data: { user: null }, error: error instanceof Error ? error : new Error('Account request failed') }
  }
}
function startNotifications() {
  if (typeof window === 'undefined' || stopNotifications) return
  const refresh = async () => {
    const current = revision
    const result = await authClient.getSession()
    if (current === revision) notify('SESSION_CHANGED', result.data.session?.user ?? null)
  }
  const remoteEvent = (event: unknown) => {
    if (event === 'SIGNED_OUT') { ++revision; notify('SIGNED_OUT', null) }
    else if (event === 'SIGNED_IN') { ++revision; notify('SIGNED_OUT', null); void refresh() }
    else if (event === 'USER_UPDATED') void refresh()
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== eventKey || !event.newValue) return
    try { remoteEvent(JSON.parse(event.newValue).event) } catch { /* ignore malformed signals */ }
  }
  const onFocus = () => { void refresh() }
  window.addEventListener('storage', onStorage)
  window.addEventListener('focus', onFocus)
  stopNotifications = () => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', onFocus); stopNotifications = undefined }
}

export const authClient = {
  async getSession() {
    try { const { user } = await request<{ user: AppUser | null }>('/api/auth/session'); return { data: { session: user ? { user } : null }, error: null } }
    catch (error) { return { data: { session: null }, error: error instanceof Error ? error : new Error('Unable to load account') } }
  },
  signInWithPassword: (body: { username?: string; email?: string; password: string }) => mutate('/api/auth/signin', 'POST', body, 'SIGNED_IN'),
  signUp: (body: { username: string; email?: string; password: string }) => mutate('/api/auth/signup', 'POST', body, 'SIGNED_IN'),
  updateUser: (body: { data?: Record<string, unknown>; password?: string; currentPassword?: string }) => mutate('/api/auth/user', 'PATCH', body, body.password ? 'SIGNED_OUT' : 'USER_UPDATED'),
  updateAgentConnection: (body: { adapterId: string; preferences?: { model: string | null; reasoningEffort: string | null; verbosity: 'low' | 'medium' | 'high' | null } }) => mutate('/api/agent', 'PATCH', body, 'USER_UPDATED'),
  async signOut() {
    ++revision
    notify('SIGNED_OUT', null)
    announce('SIGNED_OUT')
    try { await request('/api/auth/signout', 'POST'); announce('SIGNED_OUT'); return { error: null } }
    catch (error) { return { error: error instanceof Error ? error : new Error('Unable to sign out') } }
  },
  async deleteUser(password: string) {
    try { await request('/api/auth/user', 'DELETE', { password }); ++revision; notify('SIGNED_OUT', null); announce('SIGNED_OUT'); return { error: null } }
    catch (error) { return { error: error instanceof Error ? error : new Error('Unable to delete account') } }
  },
  onAuthStateChange(listener: Listener) {
    listeners.add(listener)
    startNotifications()
    return { data: { subscription: { unsubscribe: () => { listeners.delete(listener); if (!listeners.size) stopNotifications?.() } } } }
  },
}
