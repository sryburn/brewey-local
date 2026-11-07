import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { recoverAccount,recoveryOptions } from '../recover-account.mjs'
import { register,signIn,sessionUser,verifyPassword } from '../../frontend/src/lib/server/auth.ts'
import { getDatabase,closeDatabase } from '../../frontend/src/lib/server/database.ts'
const folder=await mkdtemp(join(tmpdir(),'brewey-recovery-')),previous=process.env.BREWEY_DATABASE_PATH
process.env.BREWEY_DATABASE_PATH=join(folder,'accounts.sqlite')
after(async()=>{closeDatabase();if(previous===undefined)delete process.env.BREWEY_DATABASE_PATH;else process.env.BREWEY_DATABASE_PATH=previous;await rm(folder,{recursive:true,force:true})})
test('operator password recovery preserves identity/preferences, revokes all sessions and prints no secrets',async()=>{
 const owner=await register('recover-owner','Previous-password'),extra=await signIn('recover-owner','Previous-password'),secret='Synthetic-new-password-123'
 getDatabase().prepare('UPDATE users SET user_metadata=? WHERE id=?').run('{"codexVerbosity":"high"}',owner.user.id)
 const result=await recoverAccount(process.env.BREWEY_DATABASE_PATH,'recover-owner',secret)
 assert.equal(JSON.stringify(result).includes(secret),false)
 assert.equal(sessionUser(owner.session),null);assert.equal(sessionUser(extra.session),null)
 const row=getDatabase().prepare('SELECT * FROM users WHERE id=?').get(owner.user.id)
 assert.equal(row.username,'recover-owner');assert.equal(row.is_admin,1);assert.equal(JSON.parse(row.user_metadata).codexVerbosity,'high');assert.equal(await verifyPassword(secret,row.password_hash),true)
 assert.throws(()=>recoveryOptions(['--database',process.env.BREWEY_DATABASE_PATH,'--user','recover-owner','--password',secret]),error=>!error.message.includes(secret))
})

test('the actual operator CLI reads a password from stdin and revokes the active session',async context=>{
 const secret='Another-synthetic-password-456',session=await signIn('recover-owner','Synthetic-new-password-123')
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../recover-account.mjs',import.meta.url)),'--database',process.env.BREWEY_DATABASE_PATH,'--user','recover-owner','--password-stdin'],{input:secret+'\n',encoding:'utf8'})
 if(result.error?.code==='EPERM'){context.skip('This filesystem sandbox does not permit Node child processes.');return}
 assert.equal(result.stdout.includes(secret),false);assert.equal(result.stderr.includes(secret),false)
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/All browser sessions.*revoked/)
 assert.equal(sessionUser(session.session),null)
 assert.equal(await verifyPassword(secret,getDatabase().prepare('SELECT password_hash FROM users WHERE id=?').get(session.user.id).password_hash),true)
})
