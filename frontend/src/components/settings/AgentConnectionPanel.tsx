'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { authClient } from '@/lib/auth-client'
import { componentCombos, themeUtils } from '@/lib/design-system'
import { DEFAULT_CHAT_VERBOSITY } from '@/lib/codex-chat-defaults.mjs'
import type { AgentAdapterDescriptor } from '@/lib/harness/types'

type AgentAccount = { type?: string; email?: string; planType?: string }
type AgentModel = {
  id: string
  displayName?: string
  description?: string
  isDefault?: boolean
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description: string }>
  defaultReasoningEffort?: string
}
type AnswerDetail = '' | 'low' | 'medium' | 'high'
const effortLabels: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum', ultra: 'Ultra' }
const answerDetail = (value: unknown): AnswerDetail => value === 'low' || value === 'medium' || value === 'high' ? value : ''
const savedEffort = (value: unknown): string => typeof value === 'string' ? value : ''
type LoginResult = { method: string; verificationUrl?: string; authUrl?: string; userCode?: string; loginId: string }

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || body.message || 'Unable to contact the agent')
  return body as T
}

// Login runs in an isolated server-side agent home for the signed-in Brewey user.
// Only the public login URL/code and account description ever reach the browser.
export default function AgentConnectionPanel() {
  const { user } = useAuth()
  const [adapters, setAdapters] = useState<AgentAdapterDescriptor[]>([])
  const [adapterId, setAdapterId] = useState<string>(typeof user?.user_metadata?.agentAdapter === 'string' ? user.user_metadata.agentAdapter : 'codex')
  const [requiresAuthentication, setRequiresAuthentication] = useState(true)
  const [account, setAccount] = useState<AgentAccount | null>(null)
  const [models, setModels] = useState<AgentModel[]>([])
  const [model, setModel] = useState<string>(user?.user_metadata?.codexModel || '')
  const [reasoningEffort, setReasoningEffort] = useState(() => savedEffort(user?.user_metadata?.codexReasoningEffort))
  const [verbosity, setVerbosity] = useState<AnswerDetail>(() => answerDetail(user?.user_metadata?.codexVerbosity))
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [login, setLogin] = useState<LoginResult | null>(null)
  const generation = useRef(0)
  const loadedPreferencesFor = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const currentGeneration = generation.current
    try {
      const configuration = await readResponse<{ adapters: AgentAdapterDescriptor[]; selectedAdapterId: string; preferences: { model: string | null; reasoningEffort: string | null; verbosity: AnswerDetail | null } | null; selectionError?: string }>(await fetch('/api/agent', { cache: 'no-store' }))
      if (currentGeneration !== generation.current) return
      setAdapters(configuration.adapters)
      setAdapterId(configuration.selectedAdapterId)
      if (loadedPreferencesFor.current !== configuration.selectedAdapterId) {
        setModel(configuration.preferences?.model || '')
        setReasoningEffort(savedEffort(configuration.preferences?.reasoningEffort))
        setVerbosity(answerDetail(configuration.preferences?.verbosity))
        loadedPreferencesFor.current = configuration.selectedAdapterId
      }
      const activeAdapter = configuration.adapters.find(candidate => candidate.id === configuration.selectedAdapterId)
      if (!activeAdapter || configuration.selectionError) { setAccount(null); setModels([]); throw new Error(configuration.selectionError || 'The selected agent is unavailable.') }
      const status = await readResponse<{ account: AgentAccount | null; requiresAuthentication: boolean }>(await fetch('/api/agent/account', { cache: 'no-store' }))
      if (currentGeneration !== generation.current) return
      setAccount(status.account)
      setRequiresAuthentication(status.requiresAuthentication)
      if (status.account || !status.requiresAuthentication) {
        setLogin(null)
        const catalog = activeAdapter.capabilities.modelCatalog ? await readResponse<{ models: AgentModel[] }>(await fetch('/api/agent/models', { cache: 'no-store' })) : { models: [] }
        if (currentGeneration !== generation.current) return
        setModels(catalog.models || [])
      } else {
        setModels([])
      }
      setError('')
    } catch (err) {
      if (currentGeneration === generation.current) setError(err instanceof Error ? err.message : 'Unable to load agent connection')
    } finally {
      if (currentGeneration === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    generation.current += 1
    loadedPreferencesFor.current = null
    setAdapterId(typeof user?.user_metadata?.agentAdapter === 'string' ? user.user_metadata.agentAdapter : 'codex')
    setRequiresAuthentication(true)
    setAccount(null)
    setModels([])
    setLogin(null)
    setModel(user?.user_metadata?.codexModel || '')
    setReasoningEffort(savedEffort(user?.user_metadata?.codexReasoningEffort))
    setVerbosity(answerDetail(user?.user_metadata?.codexVerbosity))
    setLoading(true)
    setWorking(false)
    setError('')
    setSuccess('')
    void refresh()
    return () => { generation.current += 1 }
    // Metadata updates after saving should preserve the connection view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, refresh])

  useEffect(() => {
    if (!login) return
    const timer = setInterval(() => { void refresh() }, 5000)
    const expiry = setTimeout(() => {
      clearInterval(timer)
      setLogin(null)
      setError('Sign-in timed out. Start a new sign-in if you still need to connect.')
    }, 10 * 60 * 1000)
    return () => { clearInterval(timer); clearTimeout(expiry) }
  }, [login, refresh])

  const startLogin = async () => {
    let currentGeneration = ++generation.current
    setWorking(true)
    setError('')
    setSuccess('')
    setLogin(null)
    try {
      if (account) {
        await readResponse<{ success: boolean }>(await fetch('/api/agent/account', { method: 'DELETE' }))
        if (currentGeneration !== generation.current) return
        // Invalidate account reads started before logout completed so an old
        // account response cannot hide the replacement login code or link.
        currentGeneration = ++generation.current
        setAccount(null)
        setModels([])
      }
      const result = await readResponse<LoginResult>(await fetch('/api/agent/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: adapter?.capabilities.loginMethods[0]?.id }),
      }))
      if (currentGeneration !== generation.current) return
      if (result.method === 'deviceCode' && (!result.verificationUrl || !result.userCode)) throw new Error('The agent did not return a device code. Try again.')
      setLogin(result)
    } catch (err) {
      if (currentGeneration === generation.current) setError(err instanceof Error ? err.message : 'Unable to start sign-in')
    } finally {
      if (currentGeneration === generation.current) setWorking(false)
    }
  }

  const savePreferences = async (event: React.FormEvent) => {
    event.preventDefault()
    const currentGeneration = generation.current
    setWorking(true)
    setError('')
    setSuccess('')
    try {
      const { error: saveError } = await authClient.updateAgentConnection({ adapterId, preferences: {
        model: adapter?.capabilities.modelCatalog ? model || null : null,
        reasoningEffort: adapter?.capabilities.reasoningEffort ? selectedEffort?.reasoningEffort || null : null,
        verbosity: adapter?.capabilities.verbosity.length ? effectiveVerbosity : null,
      } })
      if (currentGeneration !== generation.current) return
      if (saveError) throw saveError
      setSuccess('Chat preferences saved. They will apply to your next message.')
    } catch (err) {
      if (currentGeneration === generation.current) setError(err instanceof Error ? err.message : 'Unable to save chat preferences')
    } finally {
      if (currentGeneration === generation.current) setWorking(false)
    }
  }

  const adapter = adapters.find(candidate => candidate.id === adapterId)
  const capabilities = adapter?.capabilities
  const connected = !!account || !requiresAuthentication
  const effectiveVerbosity = capabilities?.verbosity.includes(verbosity as 'low' | 'medium' | 'high') ? verbosity as 'low' | 'medium' | 'high'
    : capabilities?.verbosity.includes(DEFAULT_CHAT_VERBOSITY) ? DEFAULT_CHAT_VERBOSITY : capabilities?.verbosity[0] || null
  const chooseAdapter = async (nextId: string) => {
    const currentGeneration = ++generation.current
    setWorking(true); setError(''); setLogin(null)
    try {
      const { error: selectionError } = await authClient.updateAgentConnection({ adapterId: nextId })
      if (currentGeneration !== generation.current) return
      if (selectionError) throw selectionError
      loadedPreferencesFor.current = null
      setModel(''); setReasoningEffort(''); setVerbosity(''); setAccount(null); setModels([])
      setLoading(true)
      await refresh()
    } catch (err) { if (currentGeneration === generation.current) setError(err instanceof Error ? err.message : 'Unable to select agent') }
    finally { if (currentGeneration === generation.current) setWorking(false) }
  }
  const selectedModel = models.find(candidate => candidate.id === model)
  const effectiveModel = model ? selectedModel : models.find(candidate => candidate.isDefault) || models[0]
  const reasoningOptions = effectiveModel?.supportedReasoningEfforts || []
  const selectedEffort = reasoningOptions.find(option => option.reasoningEffort === reasoningEffort)
    || reasoningOptions.find(option => option.reasoningEffort === effectiveModel?.defaultReasoningEffort)

  useEffect(() => {
    if (!effectiveModel) return
    setReasoningEffort(previous => effectiveModel.supportedReasoningEfforts?.some(option => option.reasoningEffort === previous) ? previous : '')
  }, [effectiveModel])

  const loginUrl = login?.verificationUrl || login?.authUrl

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">Agent connection</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Choose an installed agent to chat about and update your recipes. Its connection is separate from your Brewey sign-in.
        </p>
      </div>
      <div className={componentCombos.formField}>
        <label htmlFor="agent-adapter" className={componentCombos.formLabel}>Agent</label>
        <select id="agent-adapter" value={adapterId} disabled={working || !adapters.length} onChange={event => { void chooseAdapter(event.target.value) }} className={themeUtils.input()}>
          {!adapter && <option value={adapterId}>{adapterId} (unavailable)</option>}
          {adapters.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
        </select>
        {adapter && <p className="text-sm text-gray-600 dark:text-gray-400">{adapter.description}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {success && <p role="status" className="text-sm text-green-700 dark:text-green-300">{success}</p>}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <p className="text-sm text-gray-900 dark:text-gray-100" role="status">
          {loading ? 'Checking connection…' : account ? `Connected${account.email ? ` as ${account.email}` : ''}${account.planType ? ` (${account.planType})` : ''}` : !requiresAuthentication ? 'Connection does not require sign-in' : `No ${adapter?.accountLabel || 'agent'} account connected`}
        </p>
        <div className="flex flex-wrap gap-3">
          {!!capabilities?.loginMethods.length && <button type="button" disabled={working || loading} onClick={() => { void startLogin() }} className={themeUtils.button('primary')}>
            {account ? capabilities.loginMethods[0]?.id === 'deviceCode' ? 'Reconnect with a device code' : 'Reconnect' : capabilities?.loginMethods[0]?.label || 'Connect'}
          </button>}
          <button type="button" disabled={working} onClick={() => { void refresh() }} className={themeUtils.button('secondary')}>Refresh connection</button>
        </div>
        {account && <p className="text-xs text-gray-500 dark:text-gray-400">Reconnect replaces this agent connection. You will sign in again to choose an account.</p>}
        {capabilities?.loginMethods.some(method => method.id === 'deviceCode') && <p className="text-xs text-gray-500 dark:text-gray-400">Your {adapter?.accountLabel} account must allow device-code sign-in. Open the sign-in link and enter the code to approve this connection.</p>}
        {login && loginUrl && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950 p-4 space-y-2 text-sm text-gray-900 dark:text-gray-100">
            <a href={loginUrl} target="_blank" rel="noopener noreferrer" className="text-amber-700 dark:text-amber-400 underline">Open {adapter?.accountLabel || 'agent'} sign-in</a>
            {login.userCode && <p>Enter this code: <strong className="font-mono select-all">{login.userCode}</strong></p>}
            <p>Complete sign-in in the new tab. This connection will update automatically.</p>
          </div>
        )}
      </div>
      {connected && adapter && (
        <form onSubmit={savePreferences} className="space-y-3">
          {capabilities?.modelCatalog && <>
          <label htmlFor="agent-model" className={componentCombos.formLabel}>Chat model</label>
          <select id="agent-model" value={model} disabled={working || !models.length} onChange={event => { setModel(event.target.value); setReasoningEffort('') }} className={themeUtils.input()}>
            <option value="">Use {adapter.displayName} default</option>
            {model && !selectedModel && <option value={model}>{model} (unavailable)</option>}
            {models.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.displayName || candidate.id}</option>)}
          </select>
          {effectiveModel?.description && <p className="text-sm text-gray-600 dark:text-gray-400">{effectiveModel.description}</p>}
          </>}
          {capabilities?.reasoningEffort && <div className={componentCombos.formField}>
            <label htmlFor="agent-reasoning-effort" className={componentCombos.formLabel}>Reasoning effort</label>
            <select id="agent-reasoning-effort" value={selectedEffort?.reasoningEffort || ''} disabled={working || !reasoningOptions.length} onChange={event => setReasoningEffort(event.target.value)} className={themeUtils.input()}>
              {!selectedEffort && <option value="" disabled>Unavailable</option>}
              {reasoningOptions.map(option => <option key={option.reasoningEffort} value={option.reasoningEffort}>{effortLabels[option.reasoningEffort] || option.reasoningEffort}</option>)}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {reasoningOptions.length ? 'More thinking can help with complex recipes and troubleshooting, but replies may take longer.' : 'This model does not advertise adjustable reasoning effort.'}
            </p>
            {selectedEffort?.description && <p className="text-xs text-gray-500 dark:text-gray-400">
              {selectedEffort.description}
            </p>}
          </div>}
          {!!capabilities?.verbosity.length && <div className={componentCombos.formField}>
            <label htmlFor="agent-verbosity" className={componentCombos.formLabel}>Verbosity</label>
            <select id="agent-verbosity" value={effectiveVerbosity || ''} disabled={working} onChange={event => setVerbosity(answerDetail(event.target.value))} className={themeUtils.input()}>
              {capabilities?.verbosity.map(value => <option key={value} value={value}>{effortLabels[value]}</option>)}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400">Choose how much explanation accompanies your recipes and brewing advice.</p>
          </div>}
          <button type="submit" disabled={working || (!!capabilities?.modelCatalog && !models.length) || (!!model && !selectedModel)} className={themeUtils.button('primary')}>Save chat preferences</button>
        </form>
      )}
    </div>
  )
}
