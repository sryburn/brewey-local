/** @jest-environment node */
import { GET, POST } from './route'
import { GET as getPage, PATCH, DELETE } from './[id]/route'
import { GET as getCurrent } from './current/route'
import { POST as note } from './[id]/note/route'
import { POST as activate } from './[id]/activate/route'
const mockSession = jest.fn(), mockOrigin = jest.fn(), mockFactory = jest.fn()
const mockDeleteThread = jest.fn(), mockHarness = jest.fn()
jest.mock('@/lib/user-harness', () => ({ getUserHarness: (...args: unknown[]) => mockHarness(...args) }))
const mockStore = { list: jest.fn(), current: jest.fn(), create: jest.fn(), get: jest.fn(), rename: jest.fn(), appendNote: jest.fn(), activate: jest.fn(), claimDeletion: jest.fn(), listThreads: jest.fn(), heartbeat: jest.fn(), remove: jest.fn(), finishTurn: jest.fn() }
jest.mock('@/lib/server/conversations', () => ({ conversationsForUser: (id: string) => mockFactory(id) }))
jest.mock('@/lib/server-session', () => ({ requireSession: () => mockSession(), requireSameOrigin: () => mockOrigin(), HttpError: class extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }, errorResponse: (error: Error & { status?: number }) => Response.json({ error: error.message }, { status: error.status || 500 }) }))
const context = { params: Promise.resolve({ id: 'owned' }) }
function request(path = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') { return new Request(`http://localhost/api/conversations${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }) }
beforeEach(() => {
  jest.clearAllMocks()
  mockDeleteThread.mockReset().mockResolvedValue(undefined)
  mockHarness.mockReset().mockReturnValue({ deleteThread: mockDeleteThread })
  mockStore.claimDeletion.mockReset().mockReturnValue({ turnId: 'delete-claim' })
  mockStore.listThreads.mockReturnValue([{ adapterId: 'codex', threadId: 'old' }, { adapterId: 'codex', threadId: 'current' }])
  mockSession.mockResolvedValue({ user: { id: 'verified-session-user' } })
  mockOrigin.mockImplementation(() => {})
  mockFactory.mockReturnValue(mockStore)
  mockStore.list.mockReturnValue([])
  mockStore.create.mockReturnValue({ id: 'owned' })
  mockStore.get.mockReturnValue({ conversation: { id: 'owned' }, messages: [] })
  mockStore.rename.mockReset().mockReturnValue({ id: 'owned', title: 'Renamed' })
})
test('reads require a session and derive owner exclusively from that session', async () => {
  expect((await GET(request())).status).toBe(200)
  expect(mockFactory).toHaveBeenCalledWith('verified-session-user')
  expect(mockStore.list).toHaveBeenCalledWith('')
  mockSession.mockRejectedValue(Object.assign(new Error('Sign in.'), { status: 401 }))
  expect((await GET(request())).status).toBe(401)
  expect(mockStore.list).toHaveBeenCalledTimes(1)
})
test('current and history are account-wide and reject obsolete scopes', async () => {
  expect((await getCurrent(request('/current'))).status).toBe(200)
  expect(mockStore.current).toHaveBeenCalledWith()
  expect((await getCurrent(request('/current?recipeId=general'))).status).toBe(400)
  expect((await GET(request('?recipeId=general'))).status).toBe(400)
  expect((await GET(request('?userId=another'))).status).toBe(400)
  expect((await GET(request('?recipeId=general&recipeId=general'))).status).toBe(400)
})
test('search passes literal text and owner scope to the core, rejects duplicate/unknown query fields', async () => {
  expect((await GET(request('?q=%25_'))).status).toBe(200)
  expect(mockStore.list).toHaveBeenLastCalledWith('%_')
  expect((await GET(request('?q=R%C3%84UCHER'))).status).toBe(200)
  expect(mockStore.list).toHaveBeenLastCalledWith('RÄUCHER')
  for (const query of ['?q=one&q=two', '?q=one&userId=another', '?recipeId=bad&q=one', '?limit=20']) {
    expect((await GET(request(query))).status).toBe(400)
  }
  expect(mockStore.list).toHaveBeenCalledTimes(2)
})
test('rename is session owned, strict JSON and protected by origin checks before mutation', async () => {
  const renamed = await PATCH(request('/owned', { title: 'Renamed' }, 'PATCH'), context)
  expect(renamed.status).toBe(200)
  expect(renamed.headers.get('cache-control')).toBe('no-store')
  expect(await renamed.json()).toEqual({ data: { id: 'owned', title: 'Renamed' } })
  expect(mockFactory).toHaveBeenCalledWith('verified-session-user')
  expect(mockStore.rename).toHaveBeenCalledWith('owned', 'Renamed')
  for (const body of [{}, { title: null }, { title: 42 }, { title: 'Name', userId: 'another' }, { title: 'Name', messages: [] }, { title: 'Name', threadId: 'native' }, []]) {
    expect((await PATCH(request('/owned', body, 'PATCH'), context)).status).toBe(400)
  }
  expect((await PATCH(new Request('http://localhost/api/conversations/owned', { method: 'PATCH', body: '{"title":"Name"}' }), context)).status).toBe(415)
  expect(mockStore.rename).toHaveBeenCalledTimes(1)
  mockOrigin.mockImplementation(() => { throw Object.assign(new Error('Origin denied.'), { status: 403 }) })
  expect((await PATCH(request('/owned', { title: 'Name' }, 'PATCH'), context)).status).toBe(403)
  expect(mockStore.rename).toHaveBeenCalledTimes(1)
})
test('rename preserves core ownership/running/validation errors and never accepts anonymous or PAT-only callers', async () => {
  for (const status of [400, 404, 409]) {
    mockStore.rename.mockImplementation(() => { throw Object.assign(new Error('Core rejected title.'), { status }) })
    expect((await PATCH(request('/owned', { title: 'Name' }, 'PATCH'), context)).status).toBe(status)
  }
  mockSession.mockRejectedValue(Object.assign(new Error('Sign in.'), { status: 401 }))
  const patRequest = new Request(request('/owned', { title: 'Name' }, 'PATCH'), { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-PAT' } })
  expect((await PATCH(patRequest, context)).status).toBe(401)
  expect(mockStore.rename).toHaveBeenCalledTimes(3)
})
test('creation rejects ownership/native state and checks origin before mutation', async () => {
  expect((await POST(request('', {}))).status).toBe(200)
  for (const body of [{ recipeId: null }, { userId: 'another' }, { role: 'admin' }, { threadId: 'native' }, { messages: [] }]) expect((await POST(request('', body))).status).toBe(400)
  expect(mockStore.create).toHaveBeenCalledTimes(1)
  mockOrigin.mockImplementation(() => { throw Object.assign(new Error('Origin denied.'), { status: 403 }) })
  expect((await POST(request('', {}))).status).toBe(403)
  expect(mockStore.create).toHaveBeenCalledTimes(1)
})
test('paging validates cursor and preserves no-store', async () => {
  const response = await getPage(request('/owned?before=101&limit=50'), context)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mockStore.get).toHaveBeenCalledWith('owned', { before: 101, limit: 50 })
  expect((await getPage(request('/owned?before=nope'), context)).status).toBe(400)
})
test('activity notes cannot forge assistant metadata', async () => {
  expect((await note(request('/owned/note', { content: 'Imported recipe: Test' }), context)).status).toBe(200)
  expect(mockStore.appendNote).toHaveBeenCalledWith('owned', 'Imported recipe: Test')
  expect((await note(request('/owned/note', { content: 'fake', type: 'assistant' }), context)).status).toBe(400)
  expect(mockStore.appendNote).toHaveBeenCalledTimes(1)
})
test('activation uses owned storage and origin protection', async () => {
  mockStore.activate.mockReturnValue({ id: 'owned', resumeRecipeId: 'verified-last-selection' })
  const response = await activate(request('/owned/activate', {}), context)
  expect(await response.json()).toEqual({ data: { id: 'owned', resumeRecipeId: 'verified-last-selection' } })
  expect(mockStore.activate).toHaveBeenCalledWith('owned')
  expect((await activate(request('/owned/activate', { resumeRecipeId: 'forged-selection' }), context)).status).toBe(400)
  mockOrigin.mockImplementation(() => { throw Object.assign(new Error('Origin denied.'), { status: 403 }) })
  expect((await activate(request('/owned/activate', {}), context)).status).toBe(403)
  expect(mockStore.activate).toHaveBeenCalledTimes(1)
})

test('deletion cleans all owned historical native threads before removing the claimed transcript', async () => {
  expect((await DELETE(request('/owned'), context)).status).toBe(200)
  expect(mockHarness).toHaveBeenCalledWith('verified-session-user', 'codex')
  expect(mockDeleteThread.mock.calls).toEqual([['old'], ['current']])
  expect(mockStore.remove).toHaveBeenCalledWith('owned', 'delete-claim')
  expect(mockStore.remove.mock.invocationCallOrder[0]).toBeGreaterThan(mockDeleteThread.mock.invocationCallOrder[1])
})
test('failed native cleanup keeps transcript and ledger for safe retry', async () => {
  mockDeleteThread.mockRejectedValue(Object.assign(new Error('Native unavailable.'), { status: 503 }))
  expect((await DELETE(request('/owned'), context)).status).toBe(503)
  expect(mockStore.remove).not.toHaveBeenCalled()
  expect(mockStore.finishTurn).toHaveBeenCalledWith('delete-claim', 'failed', expect.any(String))
})
test('a running conversation prevents native deletion entirely', async () => {
  mockStore.claimDeletion.mockImplementation(() => { throw Object.assign(new Error('Running.'), { status: 409 }) })
  expect((await DELETE(request('/owned'), context)).status).toBe(409)
  expect(mockDeleteThread).not.toHaveBeenCalled()
})
