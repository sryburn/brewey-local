import { jsonBody } from '@/lib/request-body'
import { authenticateAccessToken } from '@/lib/server/tokens';
import { CAPABILITIES, type AccessPrincipal } from '@/types/access';
import { accessHeaders, requireCapability } from '@/lib/server/access';
import { requireSession, requireSameOrigin, errorResponse, HttpError } from '@/lib/server-session';
import { listBrewingTools, callBrewingTool, brewingToolCapabilities } from '@/lib/server/brewing-service';
export const runtime = 'nodejs';
export async function GET() { return Response.json({ name: 'Brewey', version: '1.0.0', transport: 'streamable-http', endpoint: '/api/mcp' }); }
export async function DELETE() { return new Response(null, { status: 204 }); }
export async function POST(request: Request) {
    let principal: AccessPrincipal | undefined;
    try {
        const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-api-key');
        if (token)
            principal = await authenticateAccessToken(token);
        else {
            requireSameOrigin(request);
            principal = { userId: (await requireSession()).user.id, permissions: [...CAPABILITIES] };
        }
        const message = await jsonBody(request, 2 * 1024 * 1024);
        if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
            throw new HttpError(400, 'Invalid JSON-RPC request.');
        if (message.id === undefined)
            return new Response(null, { status: 202, headers: accessHeaders(principal) });
        let result: unknown;
        switch (message.method) {
            case 'initialize':
                result = { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'brewey', version: '1.0.0' } };
                break;
            case 'ping':
                result = {};
                break;
            case 'tools/list':
                result = { tools: listBrewingTools(principal.userId, principal.permissions) };
                break;
            case 'tools/call':
                const params = message.params as { name?: unknown; arguments?: Record<string, unknown> } | undefined;
                if (typeof params?.name !== 'string') throw new HttpError(400, 'A tool name is required.');
                for (const capability of brewingToolCapabilities(params.name)) requireCapability(principal, capability);
                result = await callBrewingTool(principal.userId, params.name, params.arguments || {}, principal.permissions);
                break;
            default: return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }, { headers: { 'Cache-Control': 'no-store', ...accessHeaders(principal) } });
        }
        return Response.json({ jsonrpc: '2.0', id: message.id, result }, { headers: { 'Cache-Control': 'no-store', ...accessHeaders(principal) } });
    }
    catch (error) {
        const response = errorResponse(error);
        if (principal) for (const [name, value] of Object.entries(accessHeaders(principal))) response.headers.set(name, value);
        return response;
    }
}
