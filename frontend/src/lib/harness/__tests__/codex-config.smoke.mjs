// Opt-in protocol smoke against the installed pinned CLI. No login or turn/start/inference.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexAppServerHarness } from '../codex-app-server.ts'

const home = await mkdtemp(join(tmpdir(), 'brewey-codex-config-smoke-'))
const binary = process.env.CODEX_BINARY || 'codex'
const harness = new CodexAppServerHarness({ codexHome: home, binary, requestTimeoutMs: 20_000 })
try {
  const version = execFileSync(binary, ['--version'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
  assert.equal(version, 'codex-cli 0.159.2', 'Review generated protocol schemas before testing a different binary.')
  const account = await harness.account()
  assert.equal(account.account, null, 'The smoke must never use an authenticated account.')
  const models = await harness.models()
  assert.ok(models.length)
  const values = ['low', 'medium', 'high']
  for (const model of models) {
    for (const verbosity of values) {
      // Deliberately bypass the chat/auth entry point for thread-only schema validation.
      const thread = await harness.rpc('thread/start', {
        model: model.model, modelProvider: 'openai', allowProviderModelFallback: false,
        cwd: join(home, 'work'), sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
        config: { model_verbosity: verbosity }, baseInstructions: 'Brewey protocol smoke only.',
      })
      assert.equal(thread.thread.ephemeral, true)
      assert.equal(thread.sandbox.type, 'readOnly')
      assert.equal(thread.sandbox.networkAccess, false)
      await harness.rpc('thread/unsubscribe', { threadId: thread.thread.id })
    }
  }
  await assert.rejects(harness.rpc('thread/start', {
    model: models[0].model, ephemeral: true, config: { model_verbosity: 'invalid-smoke-value' },
  }), error => error.code === 'RPC')
  console.log(JSON.stringify({
    version, unauthenticated: true, modelsChecked: models.length, acceptedVerbosityValues: values,
    invalidVerbosityRejected: true, modelListExposesVerbosityCapability: models.some(model => Object.keys(model).some(key => /verbosity/i.test(key))),
    inferenceStarted: false,
  }))
} finally {
  harness.close()
  await rm(home, { recursive: true, force: true })
}
