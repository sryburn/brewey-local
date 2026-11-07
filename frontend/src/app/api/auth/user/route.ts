import { jsonBody } from '@/lib/request-body'
import { cookies } from 'next/headers';
import { deleteUser, updateUser } from '@/lib/server/auth';
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session';
import { deleteUserHarness } from '@/lib/user-harness';
export const runtime = 'nodejs';
export async function PATCH(request: Request) {
    try {
        requireSameOrigin(request);
        const { user } = await requireSession();
        const body = await jsonBody(request);
        const updated = await updateUser(user.id, body);
        if (body.password !== undefined)
            (await cookies()).delete('brewey-session');
        return Response.json({ user: updated }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function DELETE(request: Request) {
    try {
        requireSameOrigin(request);
        const { user } = await requireSession();
        const { password } = await jsonBody(request);
        if (typeof password !== 'string') throw new HttpError(400, 'Current password is required.');
        await deleteUser(user.id, password);
        await deleteUserHarness(user.id);
        (await cookies()).delete('brewey-session');
        return Response.json({ success: true });
    }
    catch (error) {
        return errorResponse(error);
    }
}
