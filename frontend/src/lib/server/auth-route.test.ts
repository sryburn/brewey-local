/** @jest-environment node */
import { authenticate } from './auth-route'
import { signIn } from './auth'
import { AuthError } from './auth-error'

jest.mock('next/headers', () => ({ cookies: async () => ({ set: jest.fn() }) }))
jest.mock('./auth', () => ({
  AuthError: jest.requireActual('./auth-error').AuthError,
  signIn: jest.fn(), register: jest.fn(), sessionCookie: jest.fn(),
  authenticationSubject: (identifier: string) => ['owner', 'owner@example.invalid'].includes(identifier) ? 'account:owner' : 'unknown',
}))
const request = (username: string) => new Request('http://localhost/api/auth/signin', {
  method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password: 'synthetic-password' }),
})

test('many distinct unknown names do not lock out a real account; its aliases share a limit', async () => {
  const previous = process.env.APP_ORIGIN
  process.env.APP_ORIGIN = 'http://localhost'
  try {
    jest.mocked(signIn).mockRejectedValue(new AuthError(401, 'Username or password is incorrect.'))
    for (let index = 0; index < 1005; index++) await authenticate(request(`unknown-${index}`), false)
    expect(signIn).toHaveBeenCalledTimes(15)
    jest.mocked(signIn).mockResolvedValue({ user: { id: 'owner' }, session: 'synthetic' } as Awaited<ReturnType<typeof signIn>>)
    expect((await authenticate(request('owner'), false)).status).toBe(200)
    jest.mocked(signIn).mockRejectedValue(new AuthError(401, 'Username or password is incorrect.'))
    for (let index = 0; index < 15; index++) expect((await authenticate(request(index % 2 ? 'owner' : 'owner@example.invalid'), false)).status).toBe(401)
    const limited = await authenticate(request('owner'), false)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('900')
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN
    else process.env.APP_ORIGIN = previous
  }
})
