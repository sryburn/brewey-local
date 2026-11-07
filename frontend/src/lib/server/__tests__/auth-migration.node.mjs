import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { hashSync } from 'bcryptjs'
import { getDatabase, closeDatabase, CATALOG_TABLES, SCHEMA_VERSION } from '../database.ts'
import { CAPABILITIES } from '../../../types/access.ts'
import * as auth from '../auth.ts'
import { createToken, authenticateAccessToken, updateToken, normalizeTokenPermissions } from '../tokens.ts'
import { hasCapability, requireCapability } from '../access.ts'
const folder = await mkdtemp(join(tmpdir(),'brewey-auth-v2-'))
async function sandbox(name,fn) {
  const previousPath=process.env.BREWEY_DATABASE_PATH
  closeDatabase(); process.env.BREWEY_DATABASE_PATH=join(folder,name+'.sqlite')
  try { await fn() } finally { closeDatabase(); if (previousPath===undefined) delete process.env.BREWEY_DATABASE_PATH; else process.env.BREWEY_DATABASE_PATH=previousPath }
}
after(async()=>{closeDatabase();await rm(folder,{recursive:true,force:true})})
test('v1 migration preserves UUIDs, hashes, sessions, data and legacy PAT access, and is idempotent',()=>sandbox('migration',async()=>{
  const path=process.env.BREWEY_DATABASE_PATH,db=new DatabaseSync(path),owner=randomUUID(),other=randomUUID(),password=hashSync('Preserved-password',4),session='preserved-session'
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,user_metadata TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER);
    CREATE TABLE recipes(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT);
    CREATE TABLE user_profiles(id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,profile TEXT,preferences TEXT);
    CREATE TABLE api_tokens(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,scopes TEXT,key_hash TEXT);
    PRAGMA user_version=1;`)
  for (const table of CATALOG_TABLES) db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`)
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(owner,'brewer@example.test',password,'{"codexModel":"kept"}','2020-01-01','2020-01-01')
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(other,'brewer@another.test',password,'{}','2021-01-01','2021-01-01')
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(auth.secretHash(session),owner,Date.now()+3600000)
  db.prepare('INSERT INTO recipes VALUES(?,?,?)').run('recipe',owner,'Private recipe')
  db.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run(owner,'Private profile','{"unit_system":"imperial"}')
  db.prepare('INSERT INTO api_tokens VALUES(?,?,?,?)').run('token',owner,'["mcp"]','existing-secret-hash')
  db.close()
  const migrated=getDatabase()
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION)
  assert.equal(migrated.prepare('PRAGMA foreign_keys').get().foreign_keys,1)
  assert.equal(migrated.prepare('SELECT password_hash FROM users WHERE id=?').get(owner).password_hash,password)
  assert.equal(auth.sessionUser(session).id,owner);assert.equal(auth.sessionUser(session).username,'brewer');assert.equal(auth.sessionUser(session).is_admin,true)
  assert.equal(migrated.prepare('SELECT username,is_admin FROM users WHERE id=?').get(other).username,'brewer-2')
  assert.equal(migrated.prepare('SELECT is_admin FROM users WHERE id=?').get(other).is_admin,0)
  assert.equal(migrated.prepare('SELECT user_id FROM recipes WHERE id=?').get('recipe').user_id,owner)
  assert.equal(migrated.prepare('SELECT profile FROM user_profiles WHERE id=?').get(owner).profile,'Private profile')
  assert.deepEqual(JSON.parse(migrated.prepare('SELECT scopes FROM api_tokens').get().scopes),[...CAPABILITIES])
  assert.equal(migrated.prepare('SELECT key_hash FROM api_tokens').get().key_hash,'existing-secret-hash')
  closeDatabase();const reopened=getDatabase();assert.equal(reopened.prepare('SELECT count(*) AS n FROM users').get().n,2);assert.equal(auth.needsSetup(),false)
}))
test('first-owner bootstrap is atomic, subsequent signup stays closed, and email is optional',()=>sandbox('setup',async()=>{
  const results=await Promise.allSettled([auth.register('owner-one','Owner-password-123'),auth.register('owner-two','Owner-password-456')])
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1)
  assert.equal(results.find(value=>value.status==='rejected').reason.status,403)
  const owner=results.find(value=>value.status==='fulfilled').value.user
  assert.equal(owner.is_admin,true);assert.equal(owner.email,'')
  assert.equal(getDatabase().prepare('SELECT count(*) AS n FROM users').get().n,1)
  await assert.rejects(auth.register('third-user','Other-password'),error=>error.status===403)
  await assert.rejects(auth.deleteUser(owner.id,owner.username==='owner-one'?'Owner-password-123':'Owner-password-456'),error=>error.status===409)
  getDatabase().prepare('DELETE FROM users').run()
  assert.equal(auth.needsSetup(),false)
  await assert.rejects(auth.register('takeover','Other-password'),error=>error.status===403)
}))
test('only real administrator roles create users; metadata cannot elevate access; OS identity has no password bypass',()=>sandbox('admin',async()=>{
  const owner=await auth.register('owner','Owner-password-123')
  const member=await auth.createManagedUser(owner.user.id,{username:'member',password:'Member-password-123'})
  assert.equal(member.email,'');assert.equal(member.is_admin,false)
  await auth.updateUser(member.id,{data:{is_admin:true,identity_provider:'os'}})
  await assert.rejects(auth.createManagedUser(member.id,{username:'intruder',password:'Intruder-password'}),error=>error.status===403)
  assert.throws(()=>auth.listUsers(member.id),error=>error.status===403)
  await assert.rejects(auth.createManagedUser(owner.user.id,{username:'MEMBER',password:'Other-password'}),error=>error.status===409)
  const loggedIn=await auth.signIn('MEMBER','Member-password-123');assert.equal(loggedIn.user.id,member.id)
  getDatabase().prepare("UPDATE users SET identity_provider='os',external_subject='reserved-future-subject' WHERE id=?").run(member.id)
  await assert.rejects(auth.signIn('member','Member-password-123'),error=>error.status===401)
}))
test('capabilities are independent, writes imply only matching reads, and current PAT edits apply after verification',()=>sandbox('capabilities',async()=>{
  const owner=await auth.register('owner','Owner-password-123')
  const token=createToken(owner.user.id,{name:'Read recipes',scopes:['recipes:read'],rateLimitPerHour:5})
  const principal=await authenticateAccessToken(token.token)
  assert.equal(principal.userId,owner.user.id);assert.deepEqual(principal.permissions,['recipes:read']);assert.equal(principal.rateLimit.remaining,4)
  assert.equal(hasCapability(principal,'recipes:write'),false)
  assert.throws(()=>requireCapability(principal,'profile:read'),error=>error.status===403&&error.headers['X-RateLimit-Limit']==='5')
  const row=getDatabase().prepare('SELECT id FROM api_tokens').get()
  updateToken(owner.user.id,row.id,{scopes:['recipes:write']})
  const changed=await authenticateAccessToken(token.token)
  assert.equal(hasCapability(changed,'recipes:read'),true);assert.equal(hasCapability(changed,'catalog:read'),false)
  assert.equal(hasCapability({userId:owner.user.id,permissions:['profile:write']},'profile:read'),true)
  assert.deepEqual(normalizeTokenPermissions(['api']),[...CAPABILITIES]);assert.deepEqual(normalizeTokenPermissions(['mcp']),[...CAPABILITIES])
  assert.throws(()=>createToken(owner.user.id,{name:'Admin?',scopes:['admin']}),error=>error.status===400)
  assert.throws(()=>createToken(owner.user.id,{name:'Transport?',scopes:['api']}),error=>error.status===400)
}))
test('quota responses contain per-token headers, not another concurrent principal’s quota',()=>sandbox('quota',async()=>{
  const owner=await auth.register('owner','Owner-password-123')
  const one=createToken(owner.user.id,{name:'One',scopes:['catalog:read'],rateLimitPerHour:1})
  const two=createToken(owner.user.id,{name:'Two',scopes:['recipes:read'],rateLimitPerHour:10})
  const [first,second]=await Promise.all([authenticateAccessToken(one.token),authenticateAccessToken(two.token)])
  assert.equal(first.rateLimit.remaining,0);assert.equal(second.rateLimit.remaining,9)
  await assert.rejects(authenticateAccessToken(one.token),error=>error.status===429&&error.headers['X-RateLimit-Limit']==='1'&&error.headers['X-RateLimit-Remaining']==='0'&&Number(error.headers['Retry-After'])>0)
}))
