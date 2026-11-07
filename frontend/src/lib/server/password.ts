import { randomBytes, scrypt } from 'node:crypto'
import { AuthError } from './auth-error.ts'
export const derive = (password: string, salt: string, length: number) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))
})
export async function hashPassword(password: string) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new AuthError(400, 'Use a password of 8–1,024 characters.')
  const salt = randomBytes(16).toString('hex'), hash = await derive(password, salt, 64)
  return `scrypt$${salt}$${hash.toString('hex')}`
}
