import { authenticate } from '@/lib/server/auth-route';
export const runtime = 'nodejs';
export async function POST(request: Request) { return authenticate(request, false); }
