export class IdentityError extends Error { readonly status = 400 }
export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(value.trim())) throw new IdentityError('Use a username of 3–64 letters, digits, dots, hyphens or underscores, starting with a letter or digit.')
  return value.trim().toLowerCase()
}
/** Deterministic migration helper; reserve returned names in the supplied set. */
export function legacyUsername(email: string | null | undefined, id: string, used = new Set<string>()): string {
  let base = (email?.split('@')[0] || `user-${id}`).toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 56)
  if (base.length < 3) base = `user-${base || id.slice(0, 8)}`
  let username = base, suffix = 2
  while (used.has(username.toLowerCase())) username = `${base}-${suffix++}`
  used.add(username.toLowerCase())
  return username
}
