import { generateOpenAPISpec } from '@/lib/api/openapi'

export function GET() {
  return Response.json(generateOpenAPISpec(), { headers: { 'Cache-Control': 'no-cache' } })
}
