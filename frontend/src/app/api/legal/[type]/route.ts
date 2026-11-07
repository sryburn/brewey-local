import { installationDocument } from '@/lib/server/installation-documents'

export async function GET(_request: Request, context: { params: Promise<{ type: string }> }) {
  const { type } = await context.params
  if (type !== 'terms_of_use' && type !== 'privacy_policy') return Response.json({ error: 'Document not found' }, { status: 404 })
  return Response.json({ data: installationDocument(type) })
}
