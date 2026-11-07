'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { waitForRestart } from '@/lib/backup-client'
import { FolderOpen } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { themeUtils } from '@/lib/design-system'

const MAX_BACKUP_BYTES = 100 * 1024 * 1024

function downloadFilename(disposition: string | null) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const ordinary = disposition?.match(/filename="([^"]+)"|filename=([^;]+)/i)
  let filename = ordinary?.[1] || ordinary?.[2]?.trim()
  if (encoded) {
    try { filename = decodeURIComponent(encoded.trim()) } catch { /* use ordinary filename or fallback */ }
  }
  filename = filename?.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '')
  return filename?.toLowerCase().endsWith('.sqlite') ? filename : `brewey-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
}

async function requestError(response: Response, fallback: string) {
  try {
    const body = await response.json()
    return typeof body.error === 'string' ? body.error : fallback
  } catch { return fallback }
}

export default function BackupSettings() {
  const { user } = useAuth()
  return user?.is_admin ? <InstallationBackup key={user.id} /> : null
}

function InstallationBackup() {
  const [file, setFile] = useState<File | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [restored, setRestored] = useState(false)
  const mounted = useRef(false)
  const request = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort() }
  }, [])
  useEffect(() => { if (confirming) cancelRef.current?.focus() }, [confirming])

  const begin = (operation: 'save' | 'restore') => {
    if (request.current || restored) return null
    const controller = new AbortController()
    request.current = controller
    setBusy(operation); setError(''); setMessage('')
    return controller
  }
  const finish = (controller: AbortController) => {
    if (request.current === controller) request.current = null
    if (mounted.current) setBusy(null)
  }
  const save = async () => {
    const controller = begin('save')
    if (!controller) return
    try {
      const response = await fetch('/api/admin/backup', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      if (!response.ok) throw new Error(await requestError(response, 'Unable to save backup. Please try again.'))
      const blob = await response.blob()
      if (!mounted.current || controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = downloadFilename(response.headers.get('Content-Disposition'))
        document.body.append(link); link.click(); link.remove()
        setMessage('Backup download started. Keep this file private; it contains all installation data and account credentials.')
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to save backup. Please try again.')
    } finally { finish(controller) }
  }
  const chooseFile = (selected: File | null) => {
    setConfirming(false); setError(''); setMessage(''); setFile(null)
    if (!selected) return
    if (!selected.name.toLowerCase().endsWith('.sqlite')) { setError('Choose a .sqlite backup file.'); return }
    if (!selected.size || selected.size > MAX_BACKUP_BYTES) { setError('Choose a nonempty backup file no larger than 100 MiB.'); return }
    setFile(selected)
  }
  const restore = async () => {
    if (!file || !confirming) return
    const controller = begin('restore')
    if (!controller) return
    const body = new FormData()
    body.append('file', file)
    try {
      const response = await fetch('/api/admin/backup', { method: 'POST', credentials: 'same-origin', body, signal: controller.signal })
      if (!response.ok) throw new Error(await requestError(response, 'Unable to restore backup. Please try again.'))
      const result = await response.json()
      if (result.success !== true) throw new Error('Unable to confirm backup restore. Please check the installation before trying again.')
      if (!mounted.current || controller.signal.aborted) return
      setRestored(true); setConfirming(false)
      setMessage('Backup restored. Brewey is restarting…')
      const ready = !result.restartRequired || await waitForRestart(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      // Restore invalidates every session and clears the current cookie on the server.
      // A full reload also discards auth and caches from the replaced installation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (ready) window.location.assign('/signin')
      else setMessage('Backup restored. Restart Brewey, then sign in with an account from the backup.')
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to restore backup. Please try again.')
    } finally { finish(controller) }
  }

  return <div className="space-y-6">
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Installation backup</h2>
      <p className="text-sm">Save or restore all local installation data: accounts, recipes, chats, settings and API tokens. Keep backup files private.</p>
      <p className="text-sm">ChatGPT and other external agent connections are not included. You may need to reconnect on another machine.</p>
    </div>
    <button type="button" disabled={Boolean(busy) || restored} className={themeUtils.button('primary')} onClick={() => { void save() }}>{busy === 'save' ? 'Saving backup…' : 'Save backup'}</button>
    <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
      <h3 className="font-semibold">Restore backup</h3>
      <p className="text-sm">Backup file (.sqlite, up to 100 MiB)</p>
      <input ref={fileInputRef} type="file" accept=".sqlite" aria-label="Backup file (.sqlite, up to 100 MiB)" disabled={Boolean(busy) || restored} hidden onChange={event => { chooseFile(event.target.files?.[0] || null); event.target.value = '' }} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={Boolean(busy) || restored} className={`${themeUtils.button('secondary')} inline-flex items-center gap-2`} onClick={() => fileInputRef.current?.click()}>
          <FolderOpen className="h-4 w-4" aria-hidden="true" />
          Choose backup file
        </button>
        <span className="min-w-0 break-all text-sm" aria-live="polite">{file?.name || 'No file selected'}</span>
      </div>
      {!restored && (!confirming ? <button type="button" disabled={!file || Boolean(busy)} className={themeUtils.button('secondary')} onClick={() => { setConfirming(true); setError(''); setMessage('') }}>Restore backup</button> : <div className="space-y-3 rounded border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
        <p>Restore “{file?.name}”? This replaces all current installation data, including every account, recipe, chat, setting and API token. Changes made since this backup will be lost.</p>
        <p>You will be signed out. Use the usernames and passwords saved in the backup to sign in again.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={Boolean(busy)} className={themeUtils.button('danger')} onClick={() => { void restore() }}>{busy === 'restore' ? 'Restoring backup…' : 'Confirm restore and replace all data'}</button>
          <button ref={cancelRef} type="button" disabled={Boolean(busy)} className={themeUtils.button('secondary')} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </div>)}
    </div>
    {error && <p role="alert" className="text-red-700 dark:text-red-400">{error}</p>}
    {message && <p role="status">{message}</p>}
    {restored && !busy && <a href="/signin" className="underline">Sign in with a restored account</a>}
  </div>
}
