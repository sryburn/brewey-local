import { AuthError } from './auth-error.ts'
import { derive, hashPassword } from './password.ts'
export { AuthError } from './auth-error.ts'
export { hashPassword } from './password.ts'
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import { compare } from 'bcryptjs'
import { getDatabase, transaction } from './database.ts'
import { normalizeUsername } from './identity.ts'
import type { AppUser } from '../../types/user.ts'
const SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000
interface UserRow { id: string; username: string; email: string | null; password_hash: string; user_metadata: string; is_admin: number; identity_provider: 'local' | 'os'; created_at: string; updated_at: string }
export function publicUser(row: UserRow): AppUser {
  return { id: row.id, username: row.username, email: row.email || '', is_admin: !!row.is_admin, identity_provider: row.identity_provider, user_metadata: JSON.parse(row.user_metadata), app_metadata: { provider: row.identity_provider }, created_at: row.created_at, updated_at: row.updated_at }
}
export function secretHash(value: string) { return createHash('sha256').update(value).digest('hex') }
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 1024) return false
  if (/^\$2[aby]\$/.test(stored)) return compare(password, stored)
  const [kind, salt, encoded] = stored.split('$')
  if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(encoded || '')) return false
  const expected = Buffer.from(encoded, 'hex'), actual = await derive(password, salt, expected.length)
  return timingSafeEqual(expected, actual)
}
function optionalEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new AuthError(400, 'Enter a valid email address or leave it empty.')
  return value.trim().toLowerCase()
}
function findUser(identifier: unknown): UserRow | undefined {
  if (typeof identifier !== 'string' || identifier.length > 254) return undefined
  const key = identifier.trim().toLowerCase()
  return getDatabase().prepare("SELECT * FROM users WHERE identity_provider='local' AND (username=? OR email=?)").get(key, key) as UserRow | undefined
}
/** Server-derived rate-limit identity; aliases share a bucket and unknown names cannot fill a map. */
export function authenticationSubject(identifier: unknown): string {
  const row = findUser(identifier)
  return row ? `account:${row.id}` : 'unknown'
}
export function needsSetup(): boolean {
  const db = getDatabase()
  return db.prepare("SELECT value FROM installation_settings WHERE key='setup_complete'").get()?.value !== 'true' && !db.prepare('SELECT id FROM users LIMIT 1').get()
}
function insertAccount(username: unknown, passwordHash: string, email: unknown, isAdmin: boolean) {
  const name = normalizeUsername(username), address = optionalEmail(email), db = getDatabase()
  if (db.prepare('SELECT id FROM users WHERE username=?').get(name)) throw new AuthError(409, 'This username is already in use.')
  if (address && db.prepare('SELECT id FROM users WHERE email=?').get(address)) throw new AuthError(409, 'This email address is already in use.')
  const now = new Date().toISOString(), id = randomUUID()
  db.prepare('INSERT INTO users(id,username,email,password_hash,user_metadata,is_admin,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, name, address, passwordHash, '{}', isAdmin ? 1 : 0, now, now)
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as unknown as UserRow
}
function createSession(row: UserRow) {
  const db = getDatabase(), session = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  const inserted = db.prepare('INSERT INTO sessions(hash,user_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)').run(secretHash(session), row.id, Date.now() + SESSION_LIFETIME, row.id, row.password_hash)
  if (inserted.changes !== 1) throw new AuthError(401, 'Username or password is incorrect.')
  return { user: publicUser(row), session }
}
/** Public signup exists only for the first local owner; checks repeat atomically. */
export async function register(username: unknown, password: string, email?: unknown) {
  if (process.env.DISABLE_SIGNUP === 'true') throw new AuthError(403, 'Account setup is disabled by the operator.')
  if (!needsSetup()) throw new AuthError(403, 'Account registration is closed. Ask an administrator to create your account.')
  normalizeUsername(username); optionalEmail(email)
  const passwordHash = await hashPassword(password), db = getDatabase()
  const row = transaction(db, () => {
    const claimed = db.prepare("UPDATE installation_settings SET value='true' WHERE key='setup_complete' AND value='false' AND NOT EXISTS(SELECT 1 FROM users)").run()
    if (claimed.changes !== 1) throw new AuthError(403, 'Account registration is closed. Ask an administrator to create your account.')
    const account = insertAccount(username, passwordHash, email, true)
    return account
  })
  return createSession(row)
}
export async function signIn(identifier: unknown, password: string) {
  const db = getDatabase()
  let row = findUser(identifier)
  const dummy = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128)
  const matches = await verifyPassword(password, row?.password_hash || dummy)
  if (!row || !matches) throw new AuthError(401, 'Username or password is incorrect.')
  const verifiedHash = row.password_hash
  if (row.password_hash.startsWith('$2') && password.length >= 8) {
    const upgraded = await hashPassword(password)
    if (db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(upgraded, row.id, verifiedHash).changes !== 1) throw new AuthError(401, 'Username or password is incorrect.')
    row = { ...row, password_hash: upgraded }
  }
  const current = db.prepare("SELECT * FROM users WHERE id=? AND password_hash=? AND identity_provider='local'").get(row.id, row.password_hash) as UserRow | undefined
  if (!current) throw new AuthError(401, 'Username or password is incorrect.')
  return createSession(current)
}
export function sessionUser(session: string | undefined): AppUser | null {
  if (!session || session.length > 128) return null
  const row = getDatabase().prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>?').get(secretHash(session), Date.now()) as UserRow | undefined
  return row ? publicUser(row) : null
}
export function signOut(session: string | undefined) { if (session) getDatabase().prepare('DELETE FROM sessions WHERE hash=?').run(secretHash(session)) }
export function requireAdmin(userId: string) {
  if (!getDatabase().prepare('SELECT id FROM users WHERE id=? AND is_admin=1').get(userId)) throw new AuthError(403, 'Administrator access is required.')
}
export function listUsers(adminId: string) {
  requireAdmin(adminId)
  return getDatabase().prepare('SELECT id,username,email,is_admin,identity_provider,created_at FROM users ORDER BY created_at,id').all().map(row => ({ ...row, is_admin: !!row.is_admin }))
}
export async function createManagedUser(adminId: string, input: { username?: unknown; password?: unknown; email?: unknown; is_admin?: unknown }) {
  requireAdmin(adminId)
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.password !== 'string' || input.is_admin !== undefined && typeof input.is_admin !== 'boolean') throw new AuthError(400, 'Supply a username and password, and an optional administrator role.')
  normalizeUsername(input.username); optionalEmail(input.email)
  const passwordHash = await hashPassword(input.password)
  return transaction(getDatabase(), () => { requireAdmin(adminId); return publicUser(insertAccount(input.username, passwordHash, input.email, input.is_admin === true)) })
}
export async function updateUser(userId: string, input: { data?: unknown; password?: string; currentPassword?: string }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError(400, 'Invalid account update.')
  const db = getDatabase(), row = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow | undefined
  if (!row) throw new AuthError(401, 'Account no longer exists.')
  let passwordHash = row.password_hash
  if (input.password !== undefined) {
    if (row.identity_provider !== 'local') throw new AuthError(400, 'This account uses an external identity provider.')
    if (!await verifyPassword(input.currentPassword || '', row.password_hash)) throw new AuthError(401, 'Current password is incorrect.')
    passwordHash = await hashPassword(input.password)
  }
  if (input.data !== undefined && (!input.data || typeof input.data !== 'object' || Array.isArray(input.data) || JSON.stringify(input.data).length > 64000)) throw new AuthError(400, 'Invalid account preferences.')
  return transaction(db, () => {
    const current = db.prepare('SELECT * FROM users WHERE id=? AND password_hash=?').get(userId, row.password_hash) as UserRow | undefined
    if (!current) throw new AuthError(401, 'Account credentials changed. Sign in and try again.')
    const metadata = { ...JSON.parse(current.user_metadata), ...(input.data || {}) }, now = new Date().toISOString()
    if (db.prepare('UPDATE users SET password_hash=?,user_metadata=?,updated_at=? WHERE id=? AND password_hash=?').run(passwordHash, JSON.stringify(metadata), now, userId, row.password_hash).changes !== 1) throw new AuthError(401, 'Account credentials changed. Sign in and try again.')
    if (input.password !== undefined) db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
    return publicUser({ ...current, password_hash: passwordHash, user_metadata: JSON.stringify(metadata), updated_at: now })
  })
}
export async function deleteUser(userId: string, password: string) {
  const db = getDatabase(), row = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow | undefined
  if (!row || !await verifyPassword(password || '', row.password_hash)) throw new AuthError(401, 'Current password is incorrect.')
  transaction(db, () => {
    if (row.is_admin && Number(db.prepare('SELECT count(*) AS n FROM users WHERE is_admin=1').get()?.n) <= 1) throw new AuthError(409, 'Create another administrator before deleting this account.')
    if (db.prepare('DELETE FROM users WHERE id=? AND password_hash=?').run(userId, row.password_hash).changes !== 1) throw new AuthError(401, 'Account credentials changed. Sign in and try again.')
  })
}
/** Operator-only function: never exposed through an unauthenticated HTTP route. */
export async function recoverPassword(identifier: string, password: string) {
  const row = findUser(identifier)
  if (!row) throw new AuthError(404, 'Local account not found.')
  const passwordHash = await hashPassword(password)
  transaction(getDatabase(), () => {
    if (getDatabase().prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(passwordHash, new Date().toISOString(), row.id).changes !== 1) throw new AuthError(404, 'Local account no longer exists.')
    getDatabase().prepare('DELETE FROM sessions WHERE user_id=?').run(row.id)
  })
  return { id: row.id, username: row.username }
}
export const sessionCookie = (secure: boolean) => ({ httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_LIFETIME / 1000 })
