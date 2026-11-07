#!/usr/bin/env node
/** Recover one local account password. Never accepts or prints a password argument. */
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const help = 'Usage: node ops/recover-account.mjs --database /path/brewey.sqlite --user USERNAME_OR_EMAIL [--password-stdin]'
async function readPassword(stdin) {
  if (!process.stdin.isTTY) {
    if (!stdin) throw new Error('Use --password-stdin to supply a password through a private pipe.')
    process.stdin.setEncoding('utf8')
    let value = ''
    for await (const chunk of process.stdin) { value += chunk; if (value.length > 1026) throw new Error('Password input is too long.') }
    return value.replace(/\r?\n$/, '')
  }
  process.stderr.write('New password: ')
  process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume()
  try {
    return await new Promise((resolvePassword,reject) => {
      let value = ''
      const onData = chunk => {
        for (const char of chunk) {
          if (char==='\u0003') { cleanup(); reject(new Error('Cancelled.')); return }
          if (char==='\r'||char==='\n') { cleanup(); resolvePassword(value); return }
          if (char==='\u007f'||char==='\b') value=value.slice(0,-1)
          else if (char>=' ') value+=char
          if (value.length>1024) { cleanup(); reject(new Error('Password input is too long.')); return }
        }
      }
      const cleanup = () => process.stdin.removeListener('data',onData)
      process.stdin.on('data',onData)
    })
  } finally { process.stdin.setRawMode(false); process.stdin.pause(); process.stderr.write('\n') }
}
export async function recoverAccount(database, user, password) {
  process.umask(0o077)
  process.env.BREWEY_DATABASE_PATH = await realpath(resolve(database))
  const sources = [new URL('../frontend/src/lib/server/auth.ts',import.meta.url),new URL('../src/lib/server/auth.ts',import.meta.url)]
  const source = sources.find(path => existsSync(path))
  if (!source) throw new Error('Brewey authentication source is unavailable.')
  const { recoverPassword } = await import(source.href)
  return recoverPassword(user,password)
}
export function recoveryOptions(args) {
  const options = {}
  for (let index=0;index<args.length;index++) {
    const flag=args[index]
    if (flag==='--password-stdin') options.stdin=true
    else if (flag==='--database'||flag==='--user') { const value=args[++index]; if (!value||value.startsWith('--')) throw new Error(help); options[flag.slice(2)]=value }
    else throw new Error(help)
  }
  if (!options.database||!options.user) throw new Error(help)
  return options
}
export async function runRecoveryCli() {
  const options=recoveryOptions(process.argv.slice(2))
  const password=await readPassword(options.stdin)
  await recoverAccount(options.database,options.user,password)
  process.stdout.write('Password updated. All browser sessions for this account were revoked.\n')
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) runRecoveryCli().catch(error => { process.stderr.write((error instanceof Error ? error.message : 'Account recovery failed.')+'\n'); process.exitCode=1 })
