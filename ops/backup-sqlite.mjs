#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBackupCli } from '../frontend/scripts/backup-sqlite.mjs'
export { backupDatabase } from '../frontend/scripts/backup-sqlite.mjs'
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runBackupCli()
