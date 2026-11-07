import { generateOpenAPISpec } from '@/lib/api/openapi'
import { referenceData } from '@/lib/api/reference-markdown'

export function GET() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brewey API Documentation</title>
  <link rel="stylesheet" href="/api-docs/reference.css">
</head>
<body>
  <main id="app"><p role="status">Loading API reference…</p></main>
  <script type="application/json" id="api-reference-data">${referenceData(generateOpenAPISpec())}</script>
  <noscript><p class="loading">Enable JavaScript to view the interactive reference, or <a href="/api/docs/openapi.json">read the OpenAPI specification</a>. <a href="/settings?tab=tokens">Manage API tokens</a>.</p></noscript>
  <script src="/api-docs/initialize.js" defer></script>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
