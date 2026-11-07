import { serve, body } from '../_shared'
export const runtime = 'nodejs'
export async function GET(request: Request) { return serve(request, false, 'profile:read', app => ({ data: app.getProfile() })) }
export async function PATCH(request: Request) { return serve(request, true, 'profile:write', async app => ({ data: app.updateProfile(await body(request)) })) }

