import { uploadedBackup } from '@/lib/server/backup-upload'
import { readFile } from 'node:fs/promises'
import { cookies } from 'next/headers'
import { requireAdmin } from '@/lib/server/auth'
import { createDatabaseBackup, restoreDatabaseBackup } from '@/lib/server/database-backup'
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let snapshot: Awaited<ReturnType<typeof createDatabaseBackup>> | undefined
  try {
    const { user } = await requireSession()
    requireAdmin(user.id)
    snapshot = await createDatabaseBackup(user.id)
    const bytes = await readFile(snapshot.path)
    const filename = `brewey-${new Date().toISOString().replaceAll(':', '-')}.sqlite`
    return new Response(bytes, { headers: {
      'Content-Type': 'application/vnd.sqlite3',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) { return errorResponse(error) }
  finally {
    try { await snapshot?.cleanup() }
    catch { console.warn('Could not remove a temporary backup download file.') }
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const { user } = await requireSession()
    requireAdmin(user.id)
    const bytes = await uploadedBackup(request)
    const current = await requireSession()
    if (current.user.id !== user.id) throw new HttpError(401, 'Sign in again before restoring a backup.')
    const store = await cookies()
    await restoreDatabaseBackup(user.id, bytes)
    // A fresh process prevents in-flight requests from writing through stale handles.
    // Compose restarts automatically; standalone operators restart Brewey themselves.
    setTimeout(() => process.exit(0), 1000).unref()
    store.delete('brewey-session')
    return Response.json({ success: true, restartRequired: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
