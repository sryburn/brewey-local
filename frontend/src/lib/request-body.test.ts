/** @jest-environment node */
import { jsonBody } from './request-body'
import { errorResponse, HttpError } from './server-session'

jest.mock('next/headers', () => ({ cookies: jest.fn() }))

test('rejects a chunked oversized body before consuming the remaining stream', async () => {
  let cancelled = false
  let reads = 0
  const body = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(8)) },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  const request = new Request('http://localhost/api/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
  } as RequestInit)
  await expect(jsonBody(request, 12)).rejects.toMatchObject({ status: 413 })
  expect(cancelled).toBe(true)
  expect(reads).toBe(2)
})

test('counts UTF-8 bytes and validates media type, malformed JSON and object shape', async () => {
  const request = (body: string, type = 'application/json') => new Request('http://localhost', {
    method: 'POST', headers: { 'Content-Type': type }, body,
  })
  await expect(jsonBody(request('{"a":"🍺"}'), 11)).rejects.toMatchObject({ status: 413 })
  await expect(jsonBody(request('{}', 'text/plain'))).rejects.toMatchObject({ status: 415 })
  await expect(jsonBody(request('{'))).rejects.toMatchObject({ status: 400 })
  await expect(jsonBody(request('[]'))).rejects.toMatchObject({ status: 400 })
  await expect(jsonBody(request('{"a":1}', 'application/json; charset=utf-8'))).resolves.toEqual({ a: 1 })
})

test('does not expose unexpected server error details', async () => {
  const response = errorResponse(new Error('database /private/location failed: secret'))
  expect(response.status).toBe(500)
  expect(await response.text()).not.toMatch(/private|secret/)
  const validation = errorResponse(new HttpError(400, 'Choose a recipe.'))
  expect(await validation.json()).toEqual({ error: 'Choose a recipe.' })
})
