import { requireSession, errorResponse } from '@/lib/server-session';
import { tokenUsage } from '@/lib/server/tokens';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) { try {
    const { user } = await requireSession();
    return Response.json(tokenUsage(user.id, (await context.params).id), { headers: { 'Cache-Control': 'no-store' } });
}
catch (error) {
    return errorResponse(error);
} }
