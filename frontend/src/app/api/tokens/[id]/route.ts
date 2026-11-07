import { jsonBody } from '@/lib/request-body'
import { requireSession, requireSameOrigin, errorResponse } from '@/lib/server-session';
import { revokeToken, updateToken } from '@/lib/server/tokens';
export const runtime = 'nodejs';
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export async function DELETE(request: Request, context: Context) { try {
    requireSameOrigin(request);
    const { user } = await requireSession();
    revokeToken(user.id, (await context.params).id);
    return Response.json({ success: true });
}
catch (error) {
    return errorResponse(error);
} }
export async function PATCH(request: Request, context: Context) { try {
    requireSameOrigin(request);
    const { user } = await requireSession();
    return Response.json({ token: updateToken(user.id, (await context.params).id, await jsonBody(request)) });
}
catch (error) {
    return errorResponse(error);
} }
