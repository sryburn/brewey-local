'use client'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { themeUtils } from '@/lib/design-system'
type ManagedUser = { id: string; username: string; email: string | null; is_admin: boolean }
export default function UserManagementSection() {
  const { user } = useAuth()
  return user?.is_admin ? <AdminUsers key={user.id} /> : null
}
function AdminUsers() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [admin, setAdmin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    void fetch('/api/admin/users', { cache: 'no-store', credentials: 'same-origin' }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load accounts.')
      if (mounted.current) setUsers(body.users)
    }).catch(error => { if (mounted.current) setError(error.message) })
    return () => { mounted.current = false }
  }, [])
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage(''); setSaving(true)
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, ...(email ? { email } : {}), is_admin: admin }) })
      const body = await response.json()
      if (!mounted.current) return
      if (!response.ok) throw new Error(body.error || 'Unable to create account.')
      setUsers(previous => [...previous, body.user]); setUsername(''); setPassword(''); setEmail(''); setAdmin(false)
      setMessage('Account created. Give the new user their username and chosen password. No email is sent.')
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Unable to create account.') }
    finally { if (mounted.current) setSaving(false) }
  }
  return <div className="space-y-6"><h3 className="font-semibold">Local accounts</h3><p className="text-sm">Administrators create accounts here. Each account has its own recipe library and agent connection.</p>
    <table className="w-full text-sm text-left"><thead><tr><th>Username</th><th>Role</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.username}</td><td>{user.is_admin ? 'Administrator' : 'User'}</td></tr>)}</tbody></table>
    <form onSubmit={create} className="space-y-4"><h4 className="font-medium">Create account</h4>
      <div><label htmlFor="managed-username">Username</label><input id="managed-username" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" className={themeUtils.input()} /></div>
      <div><label htmlFor="managed-password">Initial password</label><input id="managed-password" type="password" required minLength={8} maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className={themeUtils.input()} /></div>
      <div><label htmlFor="managed-email">Email address (optional)</label><input id="managed-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" className={themeUtils.input()} /></div>
      <label className="flex gap-2"><input type="checkbox" checked={admin} onChange={e => setAdmin(e.target.checked)} />Administrator access</label>
      {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status">{message}</p>}
      <button disabled={saving} className={themeUtils.button('primary')}>{saving ? 'Creating...' : 'Create account'}</button>
    </form>
  </div>
}
