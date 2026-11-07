'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FirstRunRestore from './first-run-restore'
import { useAuth } from '@/lib/auth-context'
import { themeUtils, componentCombos } from '@/lib/design-system'

export default function AuthForm({ initialMode = 'signin' }: { initialMode?: 'signin' | 'signup' }) {
  const { signIn, signUp } = useAuth()
  const router = useRouter()
  const [setupMode, setSetupMode] = useState<'choose' | 'fresh' | 'restore'>('choose')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [setup, setSetup] = useState<{ needsSetup: boolean; registrationDisabled?: boolean } | null>(null)
  const signup = initialMode === 'signup' || setup?.needsSetup === true && !setup.registrationDisabled
  useEffect(() => {
    let active = true
    void fetch('/api/auth/setup', { cache: 'no-store', credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error('Unable to check account setup.')
      const result = await response.json()
      if (active) setSetup(result)
    }).catch(() => { if (active) setError('Unable to check account setup. Try again later.') })
    return () => { active = false }
  }, [])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return }
    if (signup && (!setup?.needsSetup || setup.registrationDisabled)) return
    if (signup && password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')
    try {
      const result = signup ? await signUp(username.trim(), password) : await signIn(username.trim(), password)
      if (result.error) setError(result.error.message)
      else router.push(signup ? '/setup/ingredients' : '/')
    } catch { setError('Unable to complete account request') }
    finally { setLoading(false) }
  }
  const closed = signup && setup && (!setup.needsSetup || setup.registrationDisabled)
  return <div className="flex items-center justify-center bg-gray-50 dark:bg-gray-900 min-h-screen">
    <div className={`max-w-md w-full space-y-8 p-8 ${themeUtils.card()}`}>
      <h2 className={`text-center ${themeUtils.text('heading', 'h1')}`}>{signup ? 'Welcome to Brewey' : 'Sign in to Brewey'}</h2>
      {closed ? <div className="space-y-4"><p>Account registration is closed. Ask an administrator to create your account in Settings.</p><Link href="/signin" className="text-amber-600">Back to sign in</Link></div> : signup && !setup ? <p>{error || 'Checking account setup...'}</p> : signup && setupMode === 'choose' ? <div className="space-y-4"><p>Start a new installation or restore a backup from hosted Brewey or another local installation.</p><button className={`w-full ${themeUtils.button('primary')}`} onClick={() => setSetupMode('fresh')}>Start fresh</button><button className={`w-full ${themeUtils.button('secondary')}`} onClick={() => setSetupMode('restore')}>Restore a Brewey backup</button></div> : signup && setupMode === 'restore' ? <FirstRunRestore onBack={() => setSetupMode('choose')} /> : <>
        <p className={`text-sm ${themeUtils.text('body', 'secondary')}`}>{signup ? 'Create the owner account for this installation. Additional accounts are created by an administrator in Settings.' : 'Use your local username or your existing account email.'}</p>
        <form className="space-y-6" onSubmit={submit}>
          {error && <p role="alert" className="text-red-600">{error}</p>}
          <div className={componentCombos.formField}><label htmlFor="username" className={componentCombos.formLabel}>{signup ? 'Username' : 'Username or email'}</label><input id="username" type="text" autoComplete="username" required minLength={signup ? 3 : undefined} maxLength={signup ? 64 : 254} pattern={signup ? '[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}' : undefined} value={username} onChange={e => setUsername(e.target.value)} className={themeUtils.input()} /></div>
          <div className={componentCombos.formField}><label htmlFor="password" className={componentCombos.formLabel}>Password{signup ? ' (min 8 characters)' : ''}</label><input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} className={themeUtils.input()} /></div>
          <button disabled={loading} className={`w-full ${themeUtils.button('primary')}`}>{loading ? 'Please wait...' : signup ? 'Create owner account' : 'Sign In'}</button>
          <div className="flex flex-col items-start gap-3 text-sm">
            {signup && <button type="button" disabled={loading} onClick={() => setSetupMode('choose')} className="text-amber-600">Back to setup choices</button>}
            {signup ? <Link href="/signin" className="text-amber-600">Already have an account? Sign in</Link> : setup?.needsSetup && !setup.registrationDisabled && <Link href="/signup" className="text-amber-600">Set up Brewey</Link>}
          </div>
        </form>
      </>}
    </div>
  </div>
}
