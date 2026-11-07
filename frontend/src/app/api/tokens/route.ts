import { requireSession, errorResponse } from '@/lib/server-session';
import { listTokens } from '@/lib/server/tokens';
export const runtime = 'nodejs';
export async function GET() { try {
    const { user } = await requireSession();
    return Response.json({ tokens: listTokens(user.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
catch (error) {
    return errorResponse(error);
} }
