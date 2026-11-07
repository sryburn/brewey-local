import { cookies } from 'next/headers';
import { register, signIn, sessionCookie, authenticationSubject } from './auth';
import { jsonBody } from '../request-body';
import { requireSameOrigin, errorResponse, HttpError } from '../server-session';
const attempts = new Map<string, {
    count: number;
    until: number;
}>();
let active = 0;
export async function authenticate(request: Request, signup: boolean) {
    let claimed = false;
    try {
        requireSameOrigin(request);
        const body = await jsonBody(request, 4096);
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.password !== 'string')
            throw new HttpError(400, 'A password is required.');
        const key = signup ? 'setup' : authenticationSubject(body.username ?? body.email);
        const now = Date.now();
        if (attempts.size > 1000)
            for (const [key, value] of attempts)
                if (value.until < now)
                    attempts.delete(key);
        if (active >= 4) throw new HttpError(429, 'Sign-in is busy. Try again shortly.');
        const attempt = attempts.get(key);
        if (attempt && attempt.until > now && attempt.count >= 15)
            throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
        attempts.set(key, { count: attempt && attempt.until > now ? attempt.count + 1 : 1, until: attempt && attempt.until > now ? attempt.until : now + 900000 });
        active++; claimed = true;
        const result = await (signup ? register(body.username, body.password, body.email) : signIn(body.username ?? body.email, body.password));
        attempts.delete(key);
        (await cookies()).set('brewey-session', result.session, sessionCookie(new URL(process.env.APP_ORIGIN || request.url).protocol === 'https:'));
        return Response.json({ user: result.user }, { headers: { 'Cache-Control': 'no-store' } });
    }
    catch (error) {
        const response = errorResponse(error);
        if (response.status === 429) response.headers.set('Retry-After', active >= 4 ? '5' : '900');
        return response;
    }
    finally { if (claimed) active--; }
}
