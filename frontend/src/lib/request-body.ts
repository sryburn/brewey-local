import { HttpError } from './server-session'

/** Bound bytes while reading, including requests without Content-Length. */
export async function jsonBody(request: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    throw new HttpError(415, 'Use application/json for request bodies.')
  if (Number(request.headers.get('content-length')) > limit)
    throw new HttpError(413, 'Request body is too large.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Expected a JSON object.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new HttpError(413, 'Request body is too large.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
  catch { throw new HttpError(400, 'Invalid JSON request.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object.')
  return value as Record<string, unknown>
}
