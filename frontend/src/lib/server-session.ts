import { cookies } from 'next/headers';
import { sessionUser, AuthError } from './server/auth';
export class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export async function requireSession() {
    const user = sessionUser((await cookies()).get('brewey-session')?.value);
    if (!user)
        throw new HttpError(401, 'Sign in to your Brewey installation first.');
    return { user };
}
export function requireSameOrigin(request: Request) {
    const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
    if (request.headers.get('origin') !== expected)
        throw new HttpError(403, 'Request origin is not allowed.');
}
export function errorResponse(error: unknown) {
    const status = error instanceof HttpError || error instanceof AuthError ? error.status : error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 500;
    const message = status >= 400 && status < 500 && error instanceof Error ? error.message : 'Brewey could not complete this request.';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', ...(error instanceof AuthError ? error.headers : {}) } });
}
