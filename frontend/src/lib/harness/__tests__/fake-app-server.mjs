#!/usr/bin/env node
// Local fake protocol peer: no network access, credentials or inference.
import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
const send = message => process.stdout.write(JSON.stringify(message) + '\n')
const reply = (request, result) => send({ id: request.id, result })
const notify = (method, params = {}) => send({ method, params })
let scenario = ''
let turnId = 'turn-1'
let captured = {}
let capturedTurn = {}
let capturedResume = {}
let turnStarts = 0
const durable = () => { try { return JSON.parse(readFileSync('fake-thread.json', 'utf8')) } catch { return null } }
const mode = () => { try { return readFileSync('mock-mode', 'utf8').trim() } catch { return '' } }
const finish = status => notify('turn/completed', { threadId: 'thread-1', turn: { id: turnId, status, error: status === 'failed' ? { message: 'Model limit reached' } : null } })
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (!request.method) {
    if (request.id === 'tool-request') {
      notify('item/agentMessage/delta', { threadId: 'thread-1', turnId, delta: request.result?.success ? 'Tool succeeded.' : 'Tool failed.' })
      finish('completed')
    }
    return
  }
  const params = request.params ?? {}
  switch (request.method) {
    case 'initialize':
      if (!params.capabilities?.experimentalApi) throw new Error('Experimental capabilities required')
      reply(request, { userAgent: 'fake' }); break
    case 'initialized': break
    case 'account/read':
      reply(request, { account: mode() === 'unauthenticated' ? null : mode() === 'apiKey' ? { type: 'apiKey' } : { type: 'chatgpt', email: 'test@example.invalid', planType: 'plus' }, requiresOpenaiAuth: true,
        diagnostic: { hasOwnerKey: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.ACCESS_TOKEN), codexHome: process.env.CODEX_HOME, home: process.env.HOME, captured, capturedTurn, capturedResume, turnStarts } }); break
    case 'model/list':
      reply(request, params.cursor ? { data: [{ id: 'other', model: 'other', displayName: 'Other' }], nextCursor: null } : { data: [{ id: 'catalog-default', model: 'catalog-default', displayName: 'Default', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }] }], nextCursor: 'page-2' }); break
    case 'account/login/start': reply(request, { type: params.type, loginId: 'login-1', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-ONLY' }); notify('account/login/completed', { loginId: 'login-1', success: true, error: null }); break
    case 'account/login/cancel': reply(request, { status: 'canceled' }); break
    case 'account/logout': reply(request, {}); break
    case 'thread/start':
      captured = params
      if (params.model !== 'catalog-default') throw new Error('Default model not selected')
      if (params.sandbox !== 'read-only' || params.approvalPolicy !== 'never') throw new Error('Isolation not enabled')
      reply(request, { thread: { id: 'thread-1' } }); break
    case 'thread/resume':
      if (mode() === 'missing' || !durable() || params.threadId !== 'thread-1') { send({ id: request.id, error: { code: -32600, message: 'no rollout found for thread id ' + params.threadId } }); break }
      if (mode() === 'resume-busy') { send({ id: request.id, error: { code: -32600, message: 'thread is busy' } }); break }
      if (mode() === 'resume-permission') { send({ id: request.id, error: { code: -32600, message: 'permission denied while loading rollout' } }); break }
      captured = durable().captured
      capturedResume = params
      if ('dynamicTools' in params || 'history' in params || 'path' in params) throw new Error('Resume must use native thread id and saved tools only')
      reply(request, { thread: { id: 'thread-1' }, modelProvider: 'openai' }); break
    case 'thread/delete':
      if (mode() === 'delete-missing' || mode() === 'delete-permission') { send({ id: request.id, error: { code: -32600, message: mode() === 'delete-missing' ? 'no rollout found for thread id ' + params.threadId : 'permission denied' } }); break }
      try { unlinkSync('fake-thread.json') } catch { /* Missing persisted file is already deleted. */ }
      reply(request, {}); notify('thread/deleted', { threadId: params.threadId }); break
    case 'thread/compact/start':
      reply(request, {})
      turnId = 'turn-compact'
      notify('turn/started', { threadId: 'thread-1', turn: { id: turnId, status: 'inProgress' } })
      if (mode() === 'compact-crash') { process.exit(2); break }
      if (mode() === 'compact-wait') break
      notify('item/started', { threadId: 'unrelated-thread', turnId, item: { type: 'contextCompaction', id: 'foreign' } })
      if (mode() !== 'compact-no-item') notify('item/started', { threadId: 'thread-1', turnId, item: { type: 'contextCompaction', id: 'compact-1' } })
      if (mode() === 'compact-error') { notify('error', { threadId: 'thread-1', turnId, willRetry: false, error: { message: 'Compaction network failure' } }); break }
      setTimeout(() => {
        notify('item/completed', { threadId: 'thread-1', turnId: 'wrong-turn', item: { type: 'contextCompaction', id: 'compact-1' } })
        if (mode() !== 'compact-no-item' && mode() !== 'compact-wrong-item') notify('item/completed', { threadId: 'thread-1', turnId, item: { type: 'contextCompaction', id: 'compact-1' } })
        if (mode() === 'compact-wrong-item') notify('item/completed', { threadId: 'thread-1', turnId, item: { type: 'contextCompaction', id: 'wrong-item' } })
        finish(mode() === 'compact-fail' ? 'failed' : 'completed')
      }, 40)
      break
    case 'turn/start':
      turnStarts++
      if (!captured.ephemeral) writeFileSync('fake-thread.json', JSON.stringify({ captured }))
      capturedTurn = params
      if (mode() === 'turn-missing') { send({ id: request.id, error: { code: -32600, message: 'no rollout found for thread id thread-1' } }); break }
      scenario = params.input[0].text
      turnId = 'turn-1'
      notify('turn/started', { threadId: 'thread-1', turn: { id: turnId, status: 'inProgress' } })
      if (scenario.includes('crash')) { process.exit(2); break }
      if (scenario.includes('malformed')) { process.stdout.write('not-json\n'); break }
      reply(request, { turn: { id: turnId, status: 'inProgress' } })
      notify('item/agentMessage/delta', { threadId: 'unrelated-thread', turnId, delta: 'Ignored' })
      if (scenario.includes('wait')) break
      if (scenario.includes('auto-compact')) {
        notify('item/started', { threadId: 'thread-1', turnId, item: { type: 'contextCompaction', id: 'auto-1' } })
        notify('item/completed', { threadId: 'thread-1', turnId, item: { type: 'contextCompaction', id: 'auto-1' } })
      }
      if (scenario.includes('failure')) { finish('failed'); break }
      if (scenario.includes('tool')) {
        send({ id: 'tool-request', method: 'item/tool/call', params: { threadId: 'thread-1', turnId, callId: 'call-1', namespace: 'brewing', tool: scenario.includes('unknown') ? 'not_registered' : 'calculate_recipe', arguments: { recipe_id: 'recipe-1' } } })
        break
      }
      notify('item/agentMessage/delta', { threadId: 'thread-1', turnId, delta: 'Hello brewer.' })
      notify('item/reasoning/summaryTextDelta', { threadId: 'thread-1', turnId, delta: 'Checking recipe.' })
      notify('thread/tokenUsage/updated', { threadId: 'thread-1', turnId, tokenUsage: { last: { inputTokens: 8, outputTokens: 3, cachedInputTokens: 2 } } })
      finish('completed'); break
    case 'turn/interrupt': reply(request, {}); finish('interrupted'); break
    case 'thread/unsubscribe': reply(request, {}); break
    default: send({ id: request.id, error: { code: -32601, message: 'Unsupported fake method' } })
  }
})
