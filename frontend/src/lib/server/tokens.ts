import { randomBytes, randomUUID, timingSafeEqual, pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import { getDatabase } from './database.ts';
import { CAPABILITIES, type Capability, type AccessPrincipal } from '../../types/access.ts';
import { accessHeaders } from './access.ts';
import { AuthError, secretHash } from './auth.ts';
const deriveLegacy = promisify(pbkdf2);
export const API_TOKEN_SCHEMA = `CREATE TABLE IF NOT EXISTS api_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,key_prefix TEXT NOT NULL UNIQUE,key_hash TEXT NOT NULL,name TEXT NOT NULL,scopes TEXT NOT NULL,last_used_at TEXT,last_used_ip TEXT,usage_count INTEGER NOT NULL DEFAULT 0,rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,expires_at TEXT,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,window_start INTEGER NOT NULL DEFAULT 0,window_count INTEGER NOT NULL DEFAULT 0)`;
function db() {
    const database = getDatabase();
    database.exec(API_TOKEN_SCHEMA);
    return database;
}
type TokenRow = {
    name: string;
    key_prefix: string;
    usage_count: number;
    created_at: string;
    last_used_at: string | null;
    last_used_ip: string | null;
    id: string;
    user_id: string;
    key_hash: string;
    scopes: string;
    revoked: number;
    expires_at: string | null;
    rate_limit_per_hour: number;
    window_start: number;
    window_count: number;
    [key: string]: unknown;
};
function isExpired(row: TokenRow, now = Date.now()) { return !!row.expires_at && (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now); }
function exposed(row: TokenRow) {
    const { key_hash: _hash, user_id: _owner, ...fields } = row;
    void _hash;
    void _owner;
    return { ...fields, scopes: normalizeTokenPermissions(row.scopes), revoked: !!row.revoked };
}
function validate(input: Record<string, unknown>, partial = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AuthError(400, 'Invalid token settings.');
    const result: Record<string, string | number | null> = {};
    if (!partial || input.name !== undefined) {
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100)
            throw new AuthError(400, 'Token name must be 1–100 characters.');
        result.name = input.name.trim();
    }
    if (!partial || input.scopes !== undefined) {
        if (!Array.isArray(input.scopes) || !input.scopes.length || !input.scopes.every(scope => CAPABILITIES.includes(scope as Capability)))
            throw new AuthError(400, 'Choose one or more supported capabilities.');
        result.scopes = JSON.stringify([...new Set(input.scopes)]);
    }
    const rate = input.rate_limit_per_hour ?? input.rateLimitPerHour;
    if (rate !== undefined || !partial) {
        if (rate !== undefined && (!Number.isInteger(rate) || Number(rate) < 1 || Number(rate) > 10000))
            throw new AuthError(400, 'Rate limit must be 1–10,000 requests per hour.');
        result.rate_limit_per_hour = Number(rate ?? 1000);
    }
    const expiry = input.expires_at ?? input.expiresAt;
    if (expiry !== undefined || !partial || input.expires_at === null || input.expiresAt === null) {
        if (expiry != null && (typeof expiry !== 'string' || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()))
            throw new AuthError(400, 'Expiry must be a future date.');
        result.expires_at = expiry ? new Date(String(expiry)).toISOString() : null;
    }
    return result;
}
export function listTokens(userId: string) { return (db().prepare('SELECT * FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').all(userId) as TokenRow[]).map(exposed); }
export function createToken(userId: string, input: Record<string, unknown>) {
    const fields = validate(input);
    const prefix = 'brewey_pat_' + randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('hex');
    db().prepare('INSERT INTO api_tokens(id,user_id,key_prefix,key_hash,name,scopes,rate_limit_per_hour,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), userId, prefix, 'sha256$' + secretHash(secret), fields.name, fields.scopes, fields.rate_limit_per_hour, fields.expires_at, new Date().toISOString());
    return { success: true, token: prefix + '_' + secret, name: fields.name, scopes: JSON.parse(String(fields.scopes)), rateLimitPerHour: fields.rate_limit_per_hour, expiresAt: fields.expires_at };
}
function owned(userId: string, id: string) {
    const row = db().prepare('SELECT * FROM api_tokens WHERE id=? AND user_id=?').get(id, userId) as TokenRow | undefined;
    if (!row)
        throw new AuthError(404, 'Token not found.');
    return row;
}
export function revokeToken(userId: string, id: string) { owned(userId, id); db().prepare('UPDATE api_tokens SET revoked=1 WHERE id=? AND user_id=?').run(id, userId); }
export function updateToken(userId: string, id: string, input: Record<string, unknown>) {
    owned(userId, id);
    const fields = validate(input, true);
    const keys = Object.keys(fields);
    if (!keys.length)
        throw new AuthError(400, 'No token changes supplied.');
    db().prepare('UPDATE api_tokens SET ' + keys.map(key => key + '=?').join(',') + ' WHERE id=? AND user_id=?').run(...keys.map(key => fields[key]), id, userId);
    return exposed(owned(userId, id));
}
export function tokenUsage(userId: string, id: string) {
    const row = owned(userId, id);
    const used = Date.now() - row.window_start < 3600000 ? row.window_count : 0;
    return { token: exposed(row), rateLimit: { limit: row.rate_limit_per_hour, used, remaining: Math.max(0, row.rate_limit_per_hour - used), resetTime: new Date(row.window_start + 3600000).toISOString() } };
}
/** Legacy transport scopes granted full brewing access; preserve that exact access. */
export function normalizeTokenPermissions(value: unknown): Capability[] {
    let parsed = value;
    if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { return []; } }
    if (!Array.isArray(parsed)) return [];
    if (parsed.includes('api') || parsed.includes('mcp')) return [...CAPABILITIES];
    return CAPABILITIES.filter(capability => parsed.includes(capability));
}
export async function authenticateAccessToken(value: string): Promise<AccessPrincipal> {
    if (typeof value !== 'string' || value.length > 512) throw new AuthError(401, 'Invalid access token.');
    const match = value.match(/^(brewey_pat_[a-zA-Z0-9]{8,})_([a-zA-Z0-9]{32,})$/);
    if (!match) throw new AuthError(401, 'Invalid access token.');
    let row = db().prepare('SELECT * FROM api_tokens WHERE key_prefix=? AND revoked=0').get(match[1]) as TokenRow | undefined;
    if (!row || isExpired(row)) throw new AuthError(401, 'Invalid or expired access token.');
    let valid = false;
    if (row.key_hash.startsWith('sha256$')) {
        const stored = Buffer.from(row.key_hash.slice(7), 'hex'), actual = Buffer.from(secretHash(match[2]), 'hex');
        valid = stored.length === actual.length && timingSafeEqual(stored, actual);
    } else {
        const bytes = Buffer.from(row.key_hash, 'hex');
        if (bytes.length === 64) valid = timingSafeEqual(bytes.subarray(32), await deriveLegacy(match[2], bytes.subarray(0, 32), 100000, 32, 'sha256'));
    }
    if (!valid) throw new AuthError(401, 'Invalid access token.');
    row = db().prepare('SELECT * FROM api_tokens WHERE id=? AND revoked=0 AND key_hash=?').get(row.id, row.key_hash) as TokenRow | undefined;
    if (!row || isExpired(row)) throw new AuthError(401, 'Invalid or expired access token.');
    const now = Date.now();
    const changed = db().prepare(`UPDATE api_tokens SET
        window_start=CASE WHEN window_start<=? THEN ? ELSE window_start END,
        window_count=CASE WHEN window_start<=? THEN 1 ELSE window_count+1 END,
        usage_count=usage_count+1,last_used_at=?
        WHERE id=? AND revoked=0 AND key_hash=? AND (expires_at IS NULL OR julianday(expires_at)>julianday(?))
        AND (window_start<=? OR window_count<rate_limit_per_hour)`)
        .run(now-3600000,now,now-3600000,new Date(now).toISOString(),row.id,row.key_hash,new Date(now).toISOString(),now-3600000);
    if (changed.changes !== 1) {
        const current = db().prepare('SELECT * FROM api_tokens WHERE id=? AND revoked=0 AND key_hash=?').get(row.id,row.key_hash) as TokenRow | undefined;
        if (!current || isExpired(current,now)) throw new AuthError(401,'Invalid or expired access token.');
        const rateLimit = {limit:current.rate_limit_per_hour,remaining:0,reset:Math.ceil((current.window_start+3600000)/1000)};
        throw new AuthError(429,'Token rate limit reached.',{...accessHeaders({rateLimit}),'Retry-After':String(Math.max(1,Math.ceil((current.window_start+3600000-now)/1000)))});
    }
    const current = db().prepare('SELECT * FROM api_tokens WHERE id=? AND revoked=0 AND key_hash=?').get(row.id,row.key_hash) as TokenRow | undefined;
    if (!current) throw new AuthError(401,'Invalid access token.');
    return { userId:current.user_id,permissions:normalizeTokenPermissions(current.scopes),rateLimit:{limit:current.rate_limit_per_hour,remaining:Math.max(0,current.rate_limit_per_hour-current.window_count),reset:Math.ceil((current.window_start+3600000)/1000)} };
}
