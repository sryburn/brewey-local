'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { authClient } from '@/lib/auth-client'
import { themeUtils } from '@/lib/design-system'

export default function AccountCancellation() {
  const { user } = useAuth()
  return user ? <AccountCancellationForAccount key={user.id} /> : null
}

function AccountCancellationForAccount() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const owner = useRef(user?.id)
  useLayoutEffect(() => { owner.current = user?.id; return () => { owner.current = undefined } }, [user?.id])
  if (!user) return null
  async function remove(event: React.FormEvent) {
    event.preventDefault()
    const identity = owner.current
    setDeleting(true); setError('')
    const result = await authClient.deleteUser(password)
    if (owner.current !== identity) return
    setDeleting(false)
    if (result.error) setError(result.error.message)
  }
  return <div className="space-y-4"><h3 className="font-medium">Delete account</h3><p className="text-sm">Permanently delete your account, recipes and Codex connection from this installation.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)} className={themeUtils.button('danger')}>Delete account</button> : <form onSubmit={remove} className="space-y-3">
      <p>This cannot be undone. Enter your password to confirm.</p><label htmlFor="delete-password">Password</label><input id="delete-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={themeUtils.input()} />
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <button disabled={deleting || !password} className={themeUtils.button('danger')}>{deleting ? 'Deleting...' : 'Permanently delete account'}</button><button type="button" onClick={() => { setOpen(false); setPassword('') }} className={themeUtils.button('secondary')}>Cancel</button>
    </form>}
  </div>
}
