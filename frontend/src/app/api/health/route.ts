import { getDatabase } from '@/lib/server/database';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { try {
    getDatabase().prepare('SELECT 1').get();
    return Response.json({ status: 'ok', storage: 'sqlite' });
}
catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
} }
