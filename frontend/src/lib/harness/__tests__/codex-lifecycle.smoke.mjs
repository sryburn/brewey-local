// Opt-in pinned native protocol check. Fresh temporary home; no auth, turn/start or compaction/inference.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexAppServerHarness } from '../codex-app-server.ts'
const home = await mkdtemp(join(tmpdir(), 'brewey-codex-lifecycle-smoke-'))
const binary = process.env.CODEX_BINARY || 'codex'
let harness = new CodexAppServerHarness({ codexHome: home, binary, requestTimeoutMs: 20_000 })
try {
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  assert.equal(version, 'codex-cli 0.159.2')
  assert.equal((await harness.account()).account, null)
  const model = (await harness.models())[0]
  // Validate the pinned resume configuration separately from authenticated inference.
  const start = () => harness.rpc('thread/start', { model: model.model, modelProvider: 'openai', allowProviderModelFallback: false, cwd: join(home, 'work'), sandbox: 'read-only', approvalPolicy: 'never', ephemeral: false, developerInstructions: 'Synthetic lifecycle protocol only.', dynamicTools: [] })
  const first = await start()
  assert.equal(first.thread.ephemeral, false)
  await harness.deleteThread(first.thread.id)
  const pending = await start()
  await harness.rpc('thread/unsubscribe', { threadId: pending.thread.id })
  harness.close()
  harness = new CodexAppServerHarness({ codexHome: home, binary, requestTimeoutMs: 20_000 })
  assert.equal((await harness.account()).account, null)
  // 0.159.2 does not persist an empty rollout before its first turn starts.
  await assert.rejects(harness.resumeThread(pending.thread.id, { developerInstructions: 'Fresh synthetic context.', config: { model_verbosity: 'high' }, sandbox: 'read-only', approvalPolicy: 'never' }), error => error.code === 'THREAD_MISSING')
  await harness.deleteThread(pending.thread.id)
  await harness.deleteThread('00000000-0000-4000-8000-000000000000')
  console.log(JSON.stringify({ version, unauthenticated: true, persistentStartAccepted: true, zeroTurnRestartRequiresRebuild: true, nativePermanentDeleteAccepted: true, missingDeleteIdempotent: true, inferenceStarted: false }))
} finally { harness.close(); await rm(home, { recursive: true, force: true }) }
