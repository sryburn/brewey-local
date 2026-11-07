import assert from 'node:assert/strict'
import { test,after } from 'node:test'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hash } from 'bcryptjs'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
const dir=await mkdtemp(join(tmpdir(),'brewey-auth-test-'))
process.env.BREWEY_DATABASE_PATH=join(dir,'test.sqlite')
const auth=await import('../auth.ts')
const {requireCapability}=await import('../access.ts')
let ownerId
async function managed(email,password){const username=email.split('@')[0];await auth.createManagedUser(ownerId,{username,email,password});return auth.signIn(username,password)}
async function authorized(value,capability){const principal=await tokens.authenticateAccessToken(value);requireCapability(principal,capability);return principal.userId}
const tokens=await import('../tokens.ts')
const {getDatabase,closeDatabase}=await import('../database.ts')
after(async()=>{closeDatabase();await rm(dir,{recursive:true,force:true})})
test('local password login, cookie secrets, expiry and revocation remain private',async()=>{
 const signup=await auth.register('first-owner','Test-password-123','first@example.invalid')
 ownerId=signup.user.id
 assert.equal(signup.user.email,'first@example.invalid')
 assert.equal('password_hash' in signup.user,false)
 assert.equal(auth.sessionUser(signup.session).id,signup.user.id)
 assert.equal(auth.sessionUser('invalid'),null)
 assert.equal(getDatabase().prepare('SELECT hash FROM sessions WHERE user_id=?').get(signup.user.id).hash,auth.secretHash(signup.session))
 await assert.rejects(auth.signIn('first@example.invalid','wrong-password'),error=>error.status===401)
 auth.signOut(signup.session);assert.equal(auth.sessionUser(signup.session),null)
 const login=await auth.signIn('FIRST@example.invalid','Test-password-123')
 getDatabase().prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(login.user.id)
 assert.equal(auth.sessionUser(login.session),null)
})
test('existing bcrypt passwords work and upgrade without changing user identity',async()=>{
 const now=new Date().toISOString()
 getDatabase().prepare('INSERT INTO users(id,username,email,password_hash,user_metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('legacy-user','legacy-user','legacy@example.invalid',await hash('legacy-pass-123',4),'{"codexVerbosity":"high"}',now,now)
 const login=await auth.signIn('legacy@example.invalid','legacy-pass-123')
 assert.equal(login.user.id,'legacy-user');assert.equal(login.user.user_metadata.codexVerbosity,'high')
 assert.match(getDatabase().prepare('SELECT password_hash FROM users WHERE id=?').get('legacy-user').password_hash,/^scrypt\$/)
})
test('metadata is user scoped; password changes and deletion require current password',async()=>{
 const account=await managed('second@example.invalid','Test-password-456')
 const updated=await auth.updateUser(account.user.id,{data:{codexReasoningEffort:'high'}})
 assert.equal(updated.user_metadata.codexReasoningEffort,'high')
 assert.equal(auth.sessionUser(account.session).user_metadata.codexReasoningEffort,'high')
 await assert.rejects(auth.updateUser(account.user.id,{password:'New-password-456',currentPassword:'wrong'}),error=>error.status===401)
 await assert.rejects(auth.deleteUser(account.user.id,'wrong'),error=>error.status===401)
 await auth.updateUser(account.user.id,{password:'New-password-456',currentPassword:'Test-password-456'})
 assert.equal(auth.sessionUser(account.session),null)
 await assert.rejects(auth.signIn('second@example.invalid','Test-password-456'),error=>error.status===401)
 const fresh=await auth.signIn('second@example.invalid','New-password-456')
 await auth.deleteUser(account.user.id,'New-password-456')
 assert.equal(auth.sessionUser(fresh.session),null)
})
test('personal tokens enforce ownership, scopes, expiry, limits and revocation',async()=>{
 const one=await auth.signIn('first@example.invalid','Test-password-123')
 const two=await auth.signIn('legacy@example.invalid','legacy-pass-123')
 const issued=tokens.createToken(one.user.id,{name:'Read test',scopes:['recipes:read'],rateLimitPerHour:2})
 const listing=tokens.listTokens(one.user.id)
 assert.equal(listing.length,1);assert.equal('key_hash' in listing[0],false)
 assert.equal(tokens.listTokens(two.user.id).length,0)
 assert.throws(()=>tokens.revokeToken(two.user.id,listing[0].id),error=>error.status===404)
 await assert.rejects(authorized(issued.token,'recipes:write'),error=>error.status===403)
 assert.equal(await authorized(issued.token,'recipes:read'),one.user.id)
 await assert.rejects(authorized(issued.token,'recipes:read'),error=>error.status===429)
 tokens.revokeToken(one.user.id,listing[0].id)
 await assert.rejects(authorized(issued.token,'recipes:read'),error=>error.status===401)
 const expiring=tokens.createToken(one.user.id,{name:'expires',scopes:['catalog:read']})
 const row=tokens.listTokens(one.user.id).find(row=>row.name==='expires')
 getDatabase().prepare('UPDATE api_tokens SET expires_at=? WHERE id=?').run('2000-01-01',row.id)
 await assert.rejects(authorized(expiring.token,'recipes:write'),error=>error.status===401)
})

test('password resets invalidate in-flight login verification and password-confirmed deletion',async()=>{
 const account=await managed('race-login@example.invalid','Old-password-123'),replacement=await auth.hashPassword('New-password-123'),db=getDatabase()
 const login=auth.signIn(account.user.email,'Old-password-123')
 db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(replacement,account.user.id)
 db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.user.id)
 await assert.rejects(login,error=>error.status===401);assert.equal(db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(account.user.id).n,0)
 const secondReplacement=await auth.hashPassword('Another-password-123')
 const deletion=auth.deleteUser(account.user.id,'New-password-123')
 db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(secondReplacement,account.user.id)
 await assert.rejects(deletion,error=>error.status===401);assert.ok(db.prepare('SELECT id FROM users WHERE id=?').get(account.user.id))
})
test('concurrent password change cannot overwrite a newer password, while metadata updates are preserved',async()=>{
 const account=await managed('race-update@example.invalid','Old-password-456'),db=getDatabase(),replacement=await auth.hashPassword('Newest-password-456')
 const change=auth.updateUser(account.user.id,{password:'Next-password-456',currentPassword:'Old-password-456'})
 db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(replacement,account.user.id)
 await assert.rejects(change,error=>error.status===401);assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get(account.user.id).password_hash,replacement)
 const safeChange=auth.updateUser(account.user.id,{password:'Final-password-456',currentPassword:'Newest-password-456',data:{codexVerbosity:'high'}})
 await auth.updateUser(account.user.id,{data:{full_name:'Preserved'}})
 const updated=await safeChange;assert.equal(updated.user_metadata.full_name,'Preserved');assert.equal(updated.user_metadata.codexVerbosity,'high')
 await assert.rejects(auth.updateUser(account.user.id,null),error=>error.status===400)
})

test('legacy token verification rechecks revocation, scopes and shared rate counters after async PBKDF2',async()=>{
 const owner=await auth.signIn('first@example.invalid','Test-password-123'),db=getDatabase()
 function legacy(name){
  const issued=tokens.createToken(owner.user.id,{name,scopes:['recipes:read'],rateLimitPerHour:1}),row=tokens.listTokens(owner.user.id).find(row=>row.name===name),secret=issued.token.split('_').at(-1),salt=randomBytes(32)
  const hash=Buffer.concat([salt,pbkdf2Sync(secret,salt,100000,32,'sha256')]).toString('hex')
  db.prepare('UPDATE api_tokens SET key_hash=? WHERE id=?').run(hash,row.id)
  return {...issued,id:row.id}
 }
 const revoked=legacy('Legacy revocation'),pending=authorized(revoked.token,'recipes:read')
 tokens.revokeToken(owner.user.id,revoked.id);await assert.rejects(pending,error=>error.status===401)
 const scoped=legacy('Legacy scope'),checking=authorized(scoped.token,'recipes:read')
 tokens.updateToken(owner.user.id,scoped.id,{scopes:['catalog:read']});await assert.rejects(checking,error=>error.status===403)
 const limited=legacy('Legacy concurrency')
 const results=await Promise.allSettled([authorized(limited.token,'recipes:read'),authorized(limited.token,'recipes:read')])
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,429)
 assert.equal(db.prepare('SELECT window_count FROM api_tokens WHERE id=?').get(limited.id).window_count,1)
})

test('malformed token settings fail as validation errors without creating tokens',async()=>{
 const owner=await auth.signIn('first@example.invalid','Test-password-123'),before=tokens.listTokens(owner.user.id).length
 for(const input of [null,[],{name:'Invalid expiry',scopes:['recipes:read'],expiresAt:false},{name:'Invalid expiry',scopes:['recipes:read'],expiresAt:0}])assert.throws(()=>tokens.createToken(owner.user.id,input),error=>error.status===400)
 assert.equal(tokens.listTokens(owner.user.id).length,before)
})
