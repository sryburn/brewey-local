/** @jest-environment node */
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDatabase,closeDatabase } from '@/lib/server/database'
import { signIn,sessionUser } from '@/lib/server/auth'
import { createToken } from '@/lib/server/tokens'
import { POST as setupOwner } from '../signup/route'
import { GET as setupStatus } from '../setup/route'
import { GET as listUsers,POST as createUser } from '../../admin/users/route'
const mockCookies=new Map<string,string>()
const mockSet=jest.fn((name:string,value:string)=>{mockCookies.set(name,value)})
jest.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>mockCookies.has(name)?{value:mockCookies.get(name)}:undefined,set:(...args:unknown[])=>mockSet(...args as [string,string]),delete:(name:string)=>mockCookies.delete(name)})}))
const directory=mkdtempSync(join(tmpdir(),'brewey-account-api-')),previousPath=process.env.BREWEY_DATABASE_PATH,previousOrigin=process.env.APP_ORIGIN
let ownerId:string
const request=(path:string,body?:unknown,origin='https://brewey.test',headers:Record<string,string>={})=>new Request('https://brewey.test'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
beforeAll(()=>{closeDatabase();process.env.BREWEY_DATABASE_PATH=join(directory,'accounts.sqlite');process.env.APP_ORIGIN='https://brewey.test'})
afterAll(()=>{closeDatabase();rmSync(directory,{recursive:true,force:true});if(previousPath===undefined)delete process.env.BREWEY_DATABASE_PATH;else process.env.BREWEY_DATABASE_PATH=previousPath;if(previousOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previousOrigin})
test('public setup creates one owner without email, uses a secure HttpOnly cookie, then closes',async()=>{
 expect((await (await setupStatus()).json()).needsSetup).toBe(true)
 const reply=await setupOwner(request('/api/auth/signup',{username:'owner',password:'Owner-password-123',is_admin:false}))
 expect(reply.status).toBe(200);const body=await reply.json();ownerId=body.user.id
 expect(body.user).toMatchObject({username:'owner',email:'',is_admin:true,identity_provider:'local'})
 expect(body.user.password_hash).toBeUndefined()
 expect(mockSet).toHaveBeenCalledWith('brewey-session',expect.any(String),expect.objectContaining({httpOnly:true,secure:true,sameSite:'lax'}))
 expect(sessionUser(mockCookies.get('brewey-session'))?.id).toBe(ownerId)
 expect((await (await setupStatus()).json()).needsSetup).toBe(false)
 expect((await setupOwner(request('/api/auth/signup',{username:'uninvited',password:'Other-password'}))).status).toBe(403)
})
test('administrators create members without changing the current session; members and anonymous callers are denied',async()=>{
 const session=mockCookies.get('brewey-session')
 const reply=await createUser(request('/api/admin/users',{username:'member',password:'Member-password-123'}))
 expect(reply.status).toBe(201);const body=await reply.json();expect(body.user).toMatchObject({username:'member',email:'',is_admin:false});expect(mockCookies.get('brewey-session')).toBe(session)
 const member=await signIn('member','Member-password-123');mockCookies.set('brewey-session',member.session)
 expect((await listUsers()).status).toBe(403)
 expect((await createUser(request('/api/admin/users',{username:'intruder',password:'Other-password'}))).status).toBe(403)
 mockCookies.clear();expect((await listUsers()).status).toBe(401)
 expect((await createUser(request('/api/admin/users',{username:'bypass',password:'Other-password'},'https://brewey.test',{'x-user-id':ownerId,'x-local-user':ownerId}))).status).toBe(401)
 const pat=createToken(ownerId,{name:'No administrator rights',scopes:['recipes:write']})
 expect((await createUser(request('/api/admin/users',{username:'pat-user',password:'Other-password'},'https://brewey.test',{Authorization:'Bearer '+pat.token}))).status).toBe(401)
 expect(getDatabase().prepare('SELECT count(*) AS n FROM users').get()?.n).toBe(2)
})
test('cross-origin owner creation and administrator writes are rejected',async()=>{
 expect((await setupOwner(request('/api/auth/signup',{username:'blocked',password:'Other-password'},'https://untrusted.test'))).status).toBe(403)
 const owner=await signIn('owner','Owner-password-123');mockCookies.set('brewey-session',owner.session)
 expect((await createUser(request('/api/admin/users',{username:'blocked',password:'Other-password'},'https://untrusted.test'))).status).toBe(403)
})
