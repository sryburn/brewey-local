import { MAX_BACKUP_BYTES } from './database-backup'
import { HttpError } from '../server-session'

export async function uploadedBackup(request: Request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data;')) throw new HttpError(400, 'Choose a SQLite backup file.')
  // Bound the actual stream, including chunked uploads; Content-Length alone is untrusted.
  const limit = MAX_BACKUP_BYTES + 64 * 1024
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'Backup must be 100 MiB or smaller.')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Choose a SQLite backup file.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new HttpError(413, 'Backup must be 100 MiB or smaller.')
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let form: FormData
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData() }
  catch { throw new HttpError(400, 'Invalid backup upload.') }
  const file = form.get('file')
  if (!(file instanceof File) || form.getAll('file').length !== 1 || [...form.keys()].some(key => key !== 'file'))
    throw new HttpError(400, 'Choose one SQLite backup file.')
  if (file.size > MAX_BACKUP_BYTES) throw new HttpError(413, 'Backup must be 100 MiB or smaller.')
  if (!file.size) throw new HttpError(400, 'The backup file is empty.')
  return new Uint8Array(await file.arrayBuffer())
}
