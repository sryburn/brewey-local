import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkHtml from 'remark-html'

// Use the same Markdown ecosystem as the app. Raw HTML is discarded and the
// resulting HTML is sanitized by remark-html; API descriptions never run code.
function textOnlyImages() {
  return (tree: unknown) => {
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return
      const node = value as Record<string, unknown>
      if (node.type === 'image' || node.type === 'imageReference') {
        node.type = 'text'; node.value = typeof node.alt === 'string' ? node.alt : ''
      }
      if (Array.isArray(node.children)) node.children.forEach(visit)
    }
    visit(tree)
  }
}
const processor = remark().use(remarkGfm).use(textOnlyImages).use(remarkHtml, { sanitize: true })

export function referenceData(spec: unknown): string {
  const descriptions: Record<string, string> = Object.create(null)
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'description' && typeof child === 'string' && !Object.hasOwn(descriptions, child)) {
        descriptions[child] = String(processor.processSync(child))
      } else visit(child)
    }
  }
  visit(spec)
  // JSON lives in an inert script element. Escaping '<' prevents a description
  // (or an example in the spec) from closing that element in the HTML parser.
  return JSON.stringify({ spec, descriptions }).replaceAll('<', '\\u003c')
}
