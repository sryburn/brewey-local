'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { themeUtils } from '@/lib/design-system'
import type { IngredientSetupStatus } from '@/lib/server/ingredient-setup'

export default function IngredientSetup({ firstRun = false }: { firstRun?: boolean }) {
  const [status, setStatus] = useState<IngredientSetupStatus | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function poll() {
      try {
        const response = await fetch('/api/admin/ingredients', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to check ingredient setup.')
        if (!active) return
        setStatus(result); setError('')
        if (result.state === 'running') timer = setTimeout(() => void poll(), 1500)
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Unable to check ingredient setup.') }
    }
    void poll()
    return () => { active = false; controller.abort(); clearTimeout(timer) }
  }, [revision])
  async function start() {
    setStarting(true); setError('')
    try {
      const response = await fetch('/api/admin/ingredients', { method: 'POST', credentials: 'same-origin' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to start ingredient setup.')
      setStatus(result); setRevision(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to start ingredient setup.') }
    finally { setStarting(false) }
  }
  const total = Object.values(status?.counts || {}).reduce((sum, count) => sum + count, 0)
  const running = starting || status?.state === 'running'
  return <section className="space-y-4">
    <h2 className="text-xl font-semibold">{firstRun ? 'Set up your ingredients' : 'Ingredient catalogue'}</h2>
    <p>Brewey downloads ingredient data and beer-style descriptions from public sources into your local catalogue. This can take several minutes. Style names and brewing statistics are available offline.</p>
    <p className="text-sm">Style descriptions: BJCP 2021 Beer Style Guidelines, copyright © 2021 BJCP, Inc. <a className="underline" href="https://www.bjcp.org/bjcp-style-guidelines/" target="_blank" rel="noreferrer">Official guidelines</a> · <a className="underline" href="https://www.bjcp.org/faq/i-want-to-use-your-style-guidelines-can-i/" target="_blank" rel="noreferrer">Source terms</a>.</p>
    {!status && !error && <p role="status">Checking ingredient setup…</p>}
    {status?.state === 'idle' && <p>{total ? `${total.toLocaleString()} ingredients are already available. You can download the reviewed catalogue below.` : 'Download the catalogue to start building recipes.'}</p>}
    {running && <div role="status" className="space-y-2">
      <p>{status?.phase === 'merge' ? 'Combining and checking ingredients…' : status?.phase === 'styles' ? 'Downloading style descriptions…' : 'Downloading ingredient sources…'}</p>
      {status && status.total > 0 && <><progress aria-label="Ingredient sources processed" className="w-full" value={status.completed} max={status.total} /><p>{status.completed} of {status.total} sources processed.</p></>}
      <p className="text-sm">You can leave this page and return to Settings → Ingredients. Saved downloads will be reused.</p>
    </div>}
    {status?.state === 'ready' && <p role="status">Your catalogue is ready: {total.toLocaleString()} ingredients available.</p>}
    {status?.state === 'partial' && <div role="status" className="space-y-2">
      <p>{total.toLocaleString()} ingredients are available, but some source data could not be imported. You can continue with these ingredients and retry later in Settings → Ingredients.</p>
      {status.missing.length > 0 && <details><summary>{status.missing.length} unavailable sources</summary><ul className="list-disc pl-5 break-words">{status.missing.map(source => <li key={source}>{source}</li>)}</ul></details>}
      {!!status.rejected && <p>{status.rejected} source records could not be imported.</p>}
    </div>}
    {status?.state === 'failed' && <p role="alert" className="text-red-600">{status.error}</p>}
    {error && <div role="alert"><p className="text-red-600">{error}</p><button type="button" className="text-amber-600" onClick={() => setRevision(value => value + 1)}>Check again</button></div>}
    <div className="flex flex-wrap items-center gap-3">
      {status && !running && <button type="button" className={themeUtils.button('primary')} onClick={() => void start()}>{status.state === 'idle' ? 'Download ingredients' : status.state === 'ready' ? 'Check sources again' : 'Retry downloads'}</button>}
      {firstRun && !running && total > 0 && <Link href="/" className={themeUtils.button('secondary')}>{status?.state === 'partial' ? 'Continue with available ingredients' : 'Continue to Brewey'}</Link>}
    </div>
    {!firstRun && <p className="text-sm">Retries keep your recipes, custom ingredients and ingredients already used in recipes.</p>}
  </section>
}
