/* Local OpenAPI reference. Tokens stay in memory; requests never use sessions. */
window.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app')
  function element(tag, text, parent = app, className) {
    const node = document.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    parent.append(node)
    return node
  }
  function link(text, href, parent) {
    const node = element('a', text, parent); node.href = href; return node
  }
  function disclosure(title, parent, className) {
    const node = element('details', undefined, parent, className)
    element('summary', title, node)
    return node
  }
  function json(title, value, parent) {
    const node = disclosure(title, parent, 'raw-definition')
    element('code', JSON.stringify(value, null, 2), element('pre', undefined, node))
  }
  try {
    const { spec, descriptions } = JSON.parse(document.getElementById('api-reference-data').textContent)
    app.replaceChildren()
    const schemas = spec.components?.schemas || {}
    const schemaId = name => `schema-${encodeURIComponent(name)}`
    function markdown(value, parent) {
      if (!value) return
      const node = element('div', undefined, parent, 'prose')
      // Only server-sanitized Markdown enters innerHTML; everything else is text.
      if (Object.hasOwn(descriptions, value)) node.innerHTML = descriptions[value]
      else node.textContent = value
      // Documentation never needs to load third-party images.
      for (const image of node.querySelectorAll('img')) image.replaceWith(document.createTextNode(image.alt))
    }
    function resolved(schema = {}) {
      return schema.$ref?.startsWith('#/components/schemas/') ? schemas[schema.$ref.split('/').pop()] || schema : schema
    }
    function type(schema = {}, parent) {
      if (schema.$ref?.startsWith('#/components/schemas/')) {
        const name = schema.$ref.split('/').pop()
        if (Object.hasOwn(schemas, name)) link(name, `#${schemaId(name)}`, parent)
        else element('code', name, parent)
      } else if (schema.type === 'array') {
        element('span', 'array of ', parent); type(schema.items, parent)
      } else if (schema.anyOf || schema.oneOf || schema.allOf) {
        element('span', schema.allOf ? 'all of ' : 'one of ', parent)
        const items = schema.anyOf || schema.oneOf || schema.allOf
        items.forEach((item, index) => { if (index) element('span', ', ', parent); type(item, parent) })
      } else element('code', schema.type || (schema.properties ? 'object' : 'any'), parent)
      if (schema.nullable) element('span', ' · nullable', parent, 'muted')
      if (schema.format) element('span', ` · ${schema.format}`, parent, 'muted')
    }
    function constraints(schema = {}, parent) {
      const values = []
      for (const [key, label] of Object.entries({ minimum: 'Minimum', maximum: 'Maximum', minLength: 'Min. length', maxLength: 'Max. length', minItems: 'Min. items', maxItems: 'Max. items', pattern: 'Pattern', default: 'Default' })) {
        if (schema[key] !== undefined) values.push(`${label}: ${JSON.stringify(schema[key])}`)
      }
      if (schema.enum) values.push(`Allowed: ${schema.enum.map(value => JSON.stringify(value)).join(', ')}`)
      if (schema.readOnly) values.push('Read only')
      if (values.length) element('p', values.join(' · '), parent, 'constraints')
    }
    function table(headings, parent) {
      const container = element('div', undefined, parent, 'table-scroll')
      const node = element('table', undefined, container)
      const head = element('tr', undefined, element('thead', undefined, node))
      for (const text of headings) element('th', text, head).scope = 'col'
      return element('tbody', undefined, node)
    }
    function schemaView(schema = {}, parent, depth = 0) {
      type(schema, element('p', undefined, parent, 'schema-type'))
      markdown(schema.description, parent); constraints(schema, parent)
      if (schema.properties) {
        const body = table(['Field', 'Type', 'Description'], parent)
        for (const [name, property] of Object.entries(schema.properties)) {
          const row = element('tr', undefined, body)
          const field = element('th', undefined, row); field.scope = 'row'
          element('code', name, field)
          if (schema.required?.includes(name)) element('span', 'required', field, 'required')
          type(property, element('td', undefined, row))
          const description = element('td', undefined, row)
          markdown(property.description, description); constraints(property, description)
          if (depth < 2 && (property.properties || property.allOf || property.items?.properties)) schemaView(property.items || property, disclosure('Nested fields', description), depth + 1)
          if (property.example !== undefined) json('Example', property.example, description)
        }
      }
      if (depth < 2 && schema.allOf) for (const part of schema.allOf) schemaView(part, parent, depth + 1)
      if (schema.type === 'array' && schema.items?.properties && depth < 2) schemaView(schema.items, parent, depth + 1)
      if (schema.additionalProperties === false) element('p', 'Additional fields are not allowed.', parent, 'muted')
      if (schema.example !== undefined) json('Example', schema.example, parent)
    }
    function contentView(content, parent) {
      for (const [mediaType, media] of Object.entries(content || {})) {
        element('code', mediaType, element('p', undefined, parent, 'media-type'))
        schemaView(media.schema, parent)
        if (media.example !== undefined) json('Example', media.example, parent)
      }
    }

    const header = element('header', undefined, app, 'page-header')
    element('p', 'Developer reference', header, 'eyebrow')
    element('h1', spec.info.title || 'Brewey API', header)
    const nav = element('nav', undefined, header); nav.setAttribute('aria-label', 'API reference navigation')
    link('Back to Brewey', '/', nav); link('Manage API tokens', '/settings?tab=tokens', nav)
    link('OpenAPI JSON', '/api/docs/openapi.json', nav); link('Endpoints', '#endpoints', nav); link('Schemas', '#schemas', nav)
    const intro = disclosure('Using the API', app, 'introduction'); intro.open = true
    markdown(spec.info.description, intro)

    const auth = element('section', undefined, app, 'authentication'); auth.setAttribute('aria-labelledby', 'authentication-title')
    element('h2', 'Try a request', auth).id = 'authentication-title'
    const tokenLabel = element('label', 'Personal access token', auth); tokenLabel.htmlFor = 'api-token'
    const tokenRow = element('div', undefined, auth, 'token-row')
    const token = element('input', undefined, tokenRow); token.id = 'api-token'; token.type = 'password'; token.autocomplete = 'off'; token.spellcheck = false
    const clear = element('button', 'Clear token', tokenRow); clear.type = 'button'; clear.onclick = () => { token.value = ''; token.focus() }
    const tokenHelp = element('p', 'Requests use only the token entered here, never your browser session. Tokens are not saved. Sending a write request changes data in this installation.', auth, 'muted'); tokenHelp.id = 'token-help'; token.setAttribute('aria-describedby', tokenHelp.id)

    const endpoints = element('section', undefined, app); endpoints.id = 'endpoints'; endpoints.setAttribute('aria-labelledby', 'endpoints-title')
    element('h2', 'Endpoints', endpoints).id = 'endpoints-title'
    const searchLabel = element('label', 'Find an endpoint', endpoints); searchLabel.htmlFor = 'endpoint-search'
    const search = element('input', undefined, endpoints); search.id = 'endpoint-search'; search.type = 'search'; search.placeholder = 'Search by method, path, group or description'
    const count = element('p', '', endpoints, 'muted'); count.setAttribute('role', 'status')
    const empty = element('p', 'No endpoints match your search.', endpoints, 'empty-state'); empty.hidden = true
    const sections = [], groups = new Map()
    function group(name) {
      if (!groups.has(name)) {
        const container = element('section', undefined, endpoints, 'endpoint-group')
        element('h3', name, container)
        markdown(spec.tags?.find(tag => tag.name === name)?.description, container)
        groups.set(name, { container, entries: [] })
      }
      return groups.get(name)
    }
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue
        const owner = group(operation.tags?.[0] || 'Other')
        const section = element('details', undefined, owner.container, 'endpoint'); owner.entries.push(section)
        section.dataset.method = method; section.dataset.path = path
        const summary = element('summary', undefined, section)
        element('span', method.toUpperCase(), summary, `method method-${method}`)
        const heading = element('span', undefined, summary, 'endpoint-heading')
        element('code', path, heading, 'endpoint-path'); element('span', operation.summary || '', heading, 'endpoint-title')
        const panel = element('div', undefined, section, 'endpoint-body')
        markdown(operation.description, panel)
        const security = operation.security ?? spec.security ?? []
        element('p', security.length ? 'Authentication: personal access token with the capabilities described above.' : 'Authentication: no token required.', panel, 'auth-note')
        const parameters = [...(operations.parameters || []), ...(operation.parameters || [])]
        if (parameters.length) {
          element('h4', 'Parameters', panel)
          const body = table(['Parameter', 'Type', 'Description'], panel)
          for (const parameter of parameters) {
            const row = element('tr', undefined, body)
            const name = element('th', undefined, row); name.scope = 'row'
            element('code', parameter.name, name); element('span', parameter.in, name, 'location')
            if (parameter.required) element('span', 'required', name, 'required')
            type(parameter.schema, element('td', undefined, row))
            const description = element('td', undefined, row); markdown(parameter.description, description); constraints(parameter.schema, description)
          }
        }
        if (operation.requestBody) {
          element('h4', `Request body${operation.requestBody.required ? ' (required)' : ''}`, panel)
          markdown(operation.requestBody.description, panel); contentView(operation.requestBody.content, panel)
        }
        element('h4', 'Responses', panel)
        for (const [status, response] of Object.entries(operation.responses || {})) {
          const detail = disclosure(status, panel, 'response')
          // Descriptions may be Markdown, so render them in the body, not summary text.
          markdown(response.description, detail); contentView(response.content, detail)
          if (response.headers) {
            const body = table(['Header', 'Type', 'Description'], disclosure('Response headers', detail))
            for (const [name, value] of Object.entries(response.headers)) {
              const row = element('tr', undefined, body); element('code', name, element('th', undefined, row)).parentElement.scope = 'row'
              type(value.schema, element('td', undefined, row)); markdown(value.description, element('td', undefined, row))
            }
          }
        }
        const tester = disclosure('Try this endpoint', panel, 'request-tester')
        const form = element('form', undefined, tester), inputs = []
        for (const parameter of parameters) {
          const schema = parameter.schema || {}
          const label = element('label', `${parameter.name} (${parameter.in}${parameter.required ? ', required' : ', optional'})`, form)
          const input = element(schema.enum || schema.type === 'boolean' ? 'select' : 'input', undefined, label)
          input.required = Boolean(parameter.required)
          if (input.tagName === 'SELECT') {
            element('option', 'Choose a value', input).value = ''
            for (const value of schema.enum || ['true', 'false']) element('option', String(value), input).value = String(value)
          } else {
            if (['integer', 'number'].includes(schema.type)) { input.type = 'number'; input.step = schema.type === 'integer' ? '1' : 'any'; if (schema.minimum !== undefined) input.min = schema.minimum; if (schema.maximum !== undefined) input.max = schema.maximum }
            if (schema.example != null || schema.default != null) input.placeholder = String(schema.example ?? schema.default)
          }
          inputs.push({ parameter, input })
        }
        let body
        if (operation.requestBody) {
          const label = element('label', 'JSON request body', form)
          body = element('textarea', undefined, label); body.rows = 8; body.required = Boolean(operation.requestBody.required); body.spellcheck = false
          const example = resolved(operation.requestBody.content?.['application/json']?.schema).example
          if (example) body.placeholder = JSON.stringify(example, null, 2)
        }
        const send = element('button', `Send ${method.toUpperCase()} request`, form); send.type = 'submit'
        const output = element('pre', '', form, 'request-result'); output.hidden = true; output.setAttribute('aria-live', 'polite'); output.setAttribute('aria-label', 'Request result')
        form.onsubmit = async event => {
          event.preventDefault(); send.disabled = true; output.hidden = false; output.textContent = 'Sending…'
          try {
            let target = path
            const query = new URLSearchParams()
            for (const { parameter, input } of inputs) {
              if (parameter.required && !input.value.trim()) throw new Error(`Enter ${parameter.name}.`)
              if (parameter.in === 'path') {
                if (['.', '..'].includes(input.value)) throw new Error(`Enter a valid ${parameter.name}.`)
                target = target.replace(`{${parameter.name}}`, encodeURIComponent(input.value))
              }
              if (parameter.in === 'query' && input.value) query.set(parameter.name, input.value)
            }
            if (!target.startsWith('/api/') || target.includes('{')) throw new Error('Invalid API path.')
            const url = new URL(target, window.location.origin)
            if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) throw new Error('Invalid API origin.')
            url.search = query.toString()
            const headers = { Accept: 'application/json' }
            if (token.value.trim()) headers.Authorization = `Bearer ${token.value.trim()}`
            let payload
            if (body?.required && !body.value.trim()) throw new Error('Enter a JSON request body.')
            if (body?.value.trim()) { payload = JSON.stringify(JSON.parse(body.value)); headers['Content-Type'] = 'application/json' }
            const result = await fetch(url.href, { method: method.toUpperCase(), headers, body: payload, credentials: 'omit', redirect: 'error', cache: 'no-store' })
            const text = await result.text()
            let formatted = text
            try { formatted = JSON.stringify(JSON.parse(text), null, 2) } catch { /* Plain-text responses remain readable. */ }
            output.textContent = `${result.status} ${result.statusText}\n${formatted}`
          } catch (error) { output.textContent = error.message || 'Request failed.' }
          finally { send.disabled = false }
        }
        json('OpenAPI definition', operation, panel)
        sections.push({ section, searchText: `${method} ${path} ${operation.tags || ''} ${operation.summary || ''} ${operation.description || ''} ${parameters.map(p => `${p.name} ${p.description || ''}`).join(' ')}`.toLowerCase() })
      }
    }
    function filter() {
      const query = search.value.trim().toLowerCase()
      for (const { section, searchText } of sections) section.hidden = !searchText.includes(query)
      const visible = sections.filter(({ section }) => !section.hidden).length
      count.textContent = `${visible} of ${sections.length} endpoints`
      empty.hidden = visible !== 0
      for (const { container, entries } of groups.values()) container.hidden = entries.every(section => section.hidden)
    }
    search.oninput = filter; filter()
    const schemaSection = element('section', undefined, app); schemaSection.id = 'schemas'; schemaSection.setAttribute('aria-labelledby', 'schemas-title')
    element('h2', 'Schemas', schemaSection).id = 'schemas-title'
    element('p', 'Field types, required values and examples. Follow a schema link to open its definition.', schemaSection, 'muted')
    for (const [name, schema] of Object.entries(schemas)) {
      const detail = disclosure(name, schemaSection, 'schema-definition'); detail.id = schemaId(name)
      schemaView(schema, detail); json('OpenAPI definition', schema, detail)
    }
    function revealSchema() {
      const target = document.getElementById(window.location.hash.slice(1))
      if (target?.classList.contains('schema-definition')) { target.open = true; target.scrollIntoView({ block: 'start' }) }
    }
    window.addEventListener('hashchange', revealSchema)
    app.addEventListener('click', event => {
      const anchor = event.target.closest('a[href^="#schema-"]')
      if (anchor) { const target = document.getElementById(anchor.hash.slice(1)); if (target) target.open = true }
    })
    revealSchema()
  } catch {
    app.replaceChildren()
    element('h1', 'API reference unavailable')
    element('p', 'Reload this page to try again, or open the specification directly.')
    link('OpenAPI specification', '/api/docs/openapi.json', app)
  }
})
