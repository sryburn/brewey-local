#!/usr/bin/env node
/** Consistent online SQLite backup, including committed WAL data.
 * node ops/backup-sqlite.mjs --database /data/brewey.sqlite --output /backups/brewey.sqlite
 * Refuses to overwrite. Restore with application stopped, keeping the old database
 * and removing its stale -wal/-shm companions before opening the restored file.
 */
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
function options(args, allowed) {
  const result = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || result[args[i]]) throw new Error('Invalid arguments.')
    result[args[i]] = args[i + 1]
  }
  for (const key of allowed) if (!result[key]) throw new Error('Missing required arguments.')
  return result
}
export async function backupDatabase(database, output) {
  const sources = [new URL('../src/lib/server/database-backup.ts', import.meta.url)]
  const source = sources.find(path => existsSync(path))
  if (!source) throw new Error('Brewey SQLite backup module is unavailable.')
  const helper = await import(source.href)
  return helper.backupDatabase(database, output)
}

export async function runBackupCli() {
  try {
    const args = options(process.argv.slice(2), ['--database', '--output'])
    console.log(JSON.stringify(await backupDatabase(args['--database'], args['--output'])))
  } catch {
    console.error('SQLite backup failed; existing backup files were preserved. Check paths, permissions, database integrity and destination availability.')
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runBackupCli()
