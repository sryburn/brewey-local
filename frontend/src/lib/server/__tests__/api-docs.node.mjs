import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceData } from '../../api/reference-markdown.ts';
import { generateOpenAPISpec } from '../../api/openapi.ts';

test('reference Markdown renders headings, emphasis, lists, links, code, tables and fenced examples', () => {
  const description = '## Heading\n\n**Bold** and *emphasis* with `code`.\n\n- [Tokens](/settings?tab=tokens)\n\n| Name | Type |\n| --- | --- |\n| value | string |\n\n```json\n{"ok":true}\n```';
  const { descriptions } = JSON.parse(referenceData({ description }));
  const html = descriptions[description];
  for (const fragment of ['<h2>Heading</h2>', '<strong>Bold</strong>', '<em>emphasis</em>', '<code>code</code>', '<ul>', 'href="/settings?tab=tokens"', '<table>', '<th>Name</th>', '<pre><code class="language-json">']) assert.ok(html.includes(fragment), fragment);
});

test('reference data cannot break out of its script element or render executable Markdown', () => {
  const description = '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29)\n\n**Safe**';
  const serialized = referenceData({ description, example: '</script><script>alert(1)</script>' });
  assert.equal(serialized.includes('<'), false);
  const html = JSON.parse(serialized).descriptions[description];
  assert.doesNotMatch(html, /<script|<img|onerror|href="javascript:/);
  assert.match(html, /<strong>Safe<\/strong>/);
});

test('every real OpenAPI description is rendered without changing the downloadable specification', () => {
  const spec = generateOpenAPISpec(), original = JSON.stringify(spec);
  const data = JSON.parse(referenceData(spec));
  assert.equal(JSON.stringify(data.spec), original);
  const intro = data.descriptions[spec.info.description];
  assert.match(intro, /<h2>Authentication and capabilities<\/h2>/);
  assert.match(intro, /<strong>recipes:read<\/strong>/);
  assert.match(intro, /<code>Authorization: Bearer<\/code>/);
  assert.doesNotMatch(intro, /## |\*\*/);
  let count = 0;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'description' && typeof child === 'string') { assert.ok(Object.hasOwn(data.descriptions, child)); count++; }
      else visit(child);
    }
  }
  visit(spec); assert.ok(count > 100);
});
