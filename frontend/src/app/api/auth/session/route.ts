import { cookies } from 'next/headers';
import { sessionUser } from '@/lib/server/auth';
export const runtime = 'nodejs';
export async function GET() {
    return Response.json({ user: sessionUser((await cookies()).get('brewey-session')?.value) }, { headers: { 'Cache-Control': 'no-store' } });
}
