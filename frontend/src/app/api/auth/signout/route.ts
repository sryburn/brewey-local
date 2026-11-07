import { cookies } from 'next/headers';
import { signOut } from '@/lib/server/auth';
import { requireSameOrigin, errorResponse } from '@/lib/server-session';
export const runtime = 'nodejs';
export async function POST(request: Request) {
    try {
        requireSameOrigin(request);
        const store = await cookies();
        signOut(store.get('brewey-session')?.value);
        store.delete('brewey-session');
        return Response.json({ success: true });
    }
    catch (error) {
        return errorResponse(error);
    }
}
