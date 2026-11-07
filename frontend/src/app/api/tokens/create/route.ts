import { jsonBody } from '@/lib/request-body'
import { requireSession, requireSameOrigin, errorResponse } from '@/lib/server-session';
import { createToken } from '@/lib/server/tokens';
export const runtime = 'nodejs';
export async function POST(request: Request) { try {
    requireSameOrigin(request);
    const { user } = await requireSession();
    return Response.json(createToken(user.id, await jsonBody(request)), { headers: { 'Cache-Control': 'no-store' } });
}
catch (error) {
    return errorResponse(error);
} }
