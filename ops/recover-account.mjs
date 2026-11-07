#!/usr/bin/env node
// Operator entry point; the implementation also ships inside the frontend image.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRecoveryCli } from '../frontend/scripts/recover-account.mjs'
export { recoverAccount, recoveryOptions } from '../frontend/scripts/recover-account.mjs'
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runRecoveryCli().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : 'Account recovery failed.') + '\n')
  process.exitCode = 1
})
