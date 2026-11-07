'use client'
import { useEffect, useRef, useState } from 'react'
import { themeUtils } from '@/lib/design-system'
import { waitForRestart } from '@/lib/backup-client'

type Preview = { accounts: number; recipes: number; conversations: number; upgradedFrom: number | null }
export default function FirstRunRestore({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [restored, setRestored] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit(mode: 'preview' | 'restore') {
    if (!file || pending.current || restored || mode === 'restore' && !preview) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError('')
    const body = new FormData(); body.append('file', file)
    try {
      const response = await fetch(`/api/auth/setup/restore?mode=${mode}`, { method: 'POST', credentials: 'same-origin', body, signal: controller.signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to restore this backup.')
      if (controller.signal.aborted) return
      if (mode === 'preview') setPreview(result)
      else {
        if (!result.success) throw new Error('Unable to confirm restore. Check the installation before retrying.')
        setRestored(true); setMessage('Backup restored. Brewey is restarting…')
        const ready = await waitForRestart(controller.signal)
        if (controller.signal.aborted) return
        // Discard all state from the empty installation.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (ready) window.location.assign('/signin')
        else setMessage('Backup restored. Restart Brewey, then sign in using the username and password saved in the backup.')
      }
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to restore this backup.') }
    finally { if (pending.current === controller) pending.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="space-y-4">
    <h3 className="font-semibold">Restore a Brewey backup</h3>
    <p>Choose a .sqlite backup from another local installation or a download from hosted Brewey. Accounts and their passwords are preserved. External chat connections must be connected separately.</p>
    <p>For a hosted download, your recipes include their required ingredients. After signing in, download the remaining catalogue in Settings → Ingredients.</p>
    <label className="block">Backup file (.sqlite, up to 100 MiB)<input className="block w-full mt-2" type="file" accept=".sqlite" disabled={busy || restored} onChange={event => {
      const selected = event.target.files?.[0] || null
      setPreview(null); setError(''); setFile(null)
      if (selected && (!selected.size || selected.size > 100 * 1024 * 1024 || !selected.name.toLowerCase().endsWith('.sqlite'))) setError('Choose a nonempty .sqlite backup no larger than 100 MiB.')
      else setFile(selected)
    }} /></label>
    {preview && <div role="status"><p>{preview.recipes} recipes, {preview.accounts} accounts and {preview.conversations} saved chats.</p>{preview.upgradedFrom && <p>This backup will be upgraded to the current database version.</p>}<p>After restoring, sign in with a username and password from this backup. For a hosted download, use the credentials you chose when exporting.</p></div>}
    {!restored && <button className={themeUtils.button('primary')} disabled={!file || busy} onClick={() => void submit(preview ? 'restore' : 'preview')}>{busy ? 'Please wait…' : preview ? 'Confirm restore' : 'Check backup'}</button>}
    {!restored && <button className={`ml-3 ${themeUtils.button('secondary')}`} disabled={busy} onClick={onBack}>Back</button>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>
}
