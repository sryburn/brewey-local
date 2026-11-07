import { cookies } from 'next/headers'
import { uploadedBackup } from '@/lib/server/backup-upload'
import { requireFirstRunRestore, previewFirstRunBackup, restoreFirstRunBackup } from '@/lib/server/database-backup'
import { requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    requireFirstRunRestore()
    const mode = new URL(request.url).searchParams.get('mode')
    if (mode !== 'preview' && mode !== 'restore') throw new HttpError(400, 'Choose preview or restore.')
    const bytes = await uploadedBackup(request)
    if (mode === 'preview') return Response.json(await previewFirstRunBackup(bytes), { headers: { 'Cache-Control': 'no-store' } })
    const store = await cookies()
    await restoreFirstRunBackup(bytes)
    store.delete('brewey-session')
    setTimeout(() => process.exit(0), 1000).unref()
    return Response.json({ success: true, restartRequired: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
