'use client'
import { useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { authClient } from '@/lib/auth-client'
import { themeUtils } from '@/lib/design-system'

export default function AccountSettingsForm() {
  const { user } = useAuth()
  return user ? <AccountSettingsFormForAccount key={user.id} /> : null
}

function AccountSettingsFormForAccount() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.user_metadata.full_name || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const identity = useRef(user?.id)
  useLayoutEffect(() => { identity.current = user?.id; return () => { identity.current = undefined } }, [user?.id])
  if (!user) return null
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (password && (password.length < 8 || !currentPassword)) { setError('Enter your current password and a new password with at least 8 characters.'); return }
    const owner = identity.current
    setSaving(true); setError(''); setMessage('')
    const result = await authClient.updateUser({ data: { full_name: name.trim() }, ...(password ? { password, currentPassword } : {}) })
    if (identity.current !== owner) return
    setSaving(false)
    if (result.error) setError(result.error.message)
    else { setMessage('Account settings saved.'); setPassword(''); setCurrentPassword('') }
  }
  return <form onSubmit={submit} className="space-y-5">
    <div><label htmlFor="account-username">Username</label><input id="account-username" value={user.username} readOnly className={themeUtils.input()} /></div>
    <div><label htmlFor="account-email">Email address (optional)</label><input id="account-email" value={user.email} readOnly className={themeUtils.input()} /></div>
    <div><label htmlFor="account-name">Display name</label><input id="account-name" value={name} onChange={e => setName(e.target.value)} className={themeUtils.input()} /></div>
    <p className="text-sm text-gray-500">To change your password, enter your current password and a new password.</p>
    <div><label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={themeUtils.input()} /></div>
    <div><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} className={themeUtils.input()} /></div>
    {error && <p role="alert" className="text-red-600">{error}</p>}{message && <p role="status">{message}</p>}
    <button disabled={saving} className={themeUtils.button('primary')}>{saving ? 'Saving...' : 'Save account settings'}</button>
  </form>
}
