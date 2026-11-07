import { needsSetup } from '@/lib/server/auth'
export const runtime = 'nodejs'
export async function GET() { return Response.json({ needsSetup: needsSetup(), registrationDisabled: process.env.DISABLE_SIGNUP === 'true' }, { headers: { 'Cache-Control': 'no-store' } }) }
