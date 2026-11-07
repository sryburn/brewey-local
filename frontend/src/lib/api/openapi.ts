type Schema = Record<string, unknown>
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` })
const text = { type: 'string', nullable: true, maxLength: 100000 }
const object = { type: 'object', additionalProperties: true }
const uuid = { type: 'string', minLength: 1, maxLength: 128 }
const date = { type: 'string', format: 'date-time' }
const json = (schema: Schema) => ({ 'application/json': { schema } })
const envelope = (data: Schema) => ({ type: 'object', required: ['data'], properties: { data } })
const rateHeaders = Object.fromEntries([
  ['X-RateLimit-Limit', 'Configured requests per hour.'],
  ['X-RateLimit-Remaining', 'Requests remaining after this request.'],
  ['X-RateLimit-Reset', 'Window reset time as Unix seconds.'],
].map(([name, description]) => [name, { description: description + ' Present for authenticated token requests.', schema: { type: 'integer' } }]))
const success = (schema: Schema, description = 'Successful response', paged = false) => ({ description, headers: rateHeaders, content: json(paged ? { ...envelope(schema), required: ['data', 'meta'], properties: { data: schema, meta: ref('PageMetadata') } } : envelope(schema)) })
const errors = Object.fromEntries(Object.entries({
  400: 'Invalid request or unavailable ingredient/style.',
  401: 'Missing, invalid, expired or revoked authentication.',
  403: 'Token lacks the required capability, or browser mutation origin is disallowed.',
  404: 'Recipe not found or not owned by the authenticated account.',
  413: 'JSON request body exceeds 2 MiB.',
  415: 'Request body must use application/json.',
  429: 'The personal access token has reached its hourly request limit.',
}).map(([status, description]) => [status, { description, headers: rateHeaders, content: json(ref('Error')) }]))
const idParameter = { name: 'id', in: 'path', required: true, description: 'ID of a recipe belonging to your account.', schema: uuid }
const body = (schema: Schema) => ({ required: true, content: json(schema), description: 'JSON object, maximum 2 MiB. Unsupported fields are rejected by the operation.' })
const recipeProperties = {
  name: { type: 'string', minLength: 1, maxLength: 200, example: 'Weekend pale ale' },
  description: text,
  batch_size_liters: { type: 'number', minimum: 0.001, maximum: 1000000, default: 20 },
  boil_time_minutes: { type: 'number', minimum: 0, maximum: 1440, default: 60 },
  efficiency_percent: { type: 'number', minimum: 0.001, maximum: 100, default: 75 },
  mash_thickness: { type: 'number', nullable: true, minimum: 0.01, maximum: 100, description: 'Litres of mash water per kilogram of grain.' },
  brewing_notes: text,
  tasting_notes: text,
  bjcp_style_id: { ...uuid, nullable: true, description: 'Existing catalogue style ID, or null.' },
}
const relation = (properties: Schema) => ({ type: 'object', properties: { id: uuid, recipe_id: uuid, created_at: date, ...properties } })
const array = (items: Schema) => ({ type: 'array', items })
const steps = { step_order: { type: 'integer', minimum: 1 }, name: { type: 'string' }, temperature_c: { type: 'number' }, description: text }
const importArray = (description: string) => ({ ...array(object), maxItems: 1000, description })


const strict = (properties: Schema, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) })
const queryParameter = (name: string, schema: Schema, description?: string) => ({ name, in: 'query', schema, ...(description ? { description } : {}) })
const paging = [
  queryParameter('limit', { type: 'integer', minimum: 1, maximum: 500, default: 50 }),
  queryParameter('offset', { type: 'integer', minimum: 0, maximum: 1000000, default: 0 }),
  queryParameter('direction', { type: 'string', enum: ['asc', 'desc'] }),
]
const recipeQuery = [
  ...['q', 'name', 'description', 'ingredient'].map(name => queryParameter(name, { type: 'string', maxLength: 500 })),
  ...['abv', 'ibu', 'ebc', 'batch_size'].flatMap(field => ['min', 'max'].map(bound => queryParameter(`${bound}_${field}`, { type: 'number' }, field === 'batch_size' ? 'Batch size in litres.' : undefined))),
  queryParameter('sort', { type: 'string', enum: ['name', 'updated_at', 'created_at'], default: 'updated_at' }), ...paging,
]
const catalogText: Record<string, string[]> = { grain: ['name', 'origin', 'grain_type', 'must_mash', 'notes'], hop: ['name', 'origin', 'hop_type', 'form', 'notes'], yeast: ['name', 'yeast_type', 'form', 'laboratory', 'product_id', 'notes'], misc: ['name', 'ingredient_type', 'notes'], style: ['name', 'number', 'category', 'category_number', 'style_guide'] }
const catalogNumbers: Record<string, string[]> = { grain: ['color_ebc', 'extract_potential'], hop: ['alpha_acid_percent', 'beta_acid_percent'], yeast: ['attenuation_percent', 'temperature_range_min', 'temperature_range_max'], misc: [], style: ['og_min', 'og_max', 'fg_min', 'fg_max', 'abv_min', 'abv_max', 'ibu_min', 'ibu_max', 'ebc_min', 'ebc_max'] }
const catalogQuery = [
  queryParameter('q', { type: 'string', maxLength: 500 }, 'Case-insensitive text search across catalogue data.'),
  ...[...new Set(Object.values(catalogText).flat())].map(name => queryParameter(name, { type: 'string', maxLength: 500 }, 'Accepted only for the kinds listed in this operation. must_mash accepts true or false.')),
  ...[...new Set(Object.values(catalogNumbers).flat())].flatMap(field => ['min', 'max'].map(bound => queryParameter(`${bound}_${field}`, { type: 'number' }, 'Bound on the stored catalogue field; accepted only for the matching kind.'))),
  queryParameter('sort', { type: 'string', enum: ['name'], default: 'name' }), ...paging,
]
const quantity = { type: 'number', minimum: 0.0000001 }
const timing = { type: 'number', minimum: 0, nullable: true }
const temperature = { type: 'number', minimum: -273.15, maximum: 200 }
const relationInputs: Record<string, Schema> = {
  Grain: { grain_id: uuid, amount_kg: quantity },
  Hop: { hop_id: uuid, amount_grams: quantity, time_minutes: timing, use_type: { type: 'string', enum: ['boil', 'dry_hop', 'first_wort', 'whirlpool', 'mash'], default: 'boil' }, alpha_acid_percent_override: { type: 'number', minimum: 0, maximum: 100, nullable: true }, temperature_c: { ...temperature, nullable: true }, dry_hop_start_day: timing, dry_hop_duration_days: timing },
  Yeast: { yeast_id: uuid, amount_units: quantity, unit_type: { type: 'string', enum: ['packets', 'grams', 'ml', 'cells'], default: 'packets' } },
  Misc: { misc_id: uuid, amount_units: quantity, unit_type: { type: 'string', enum: ['grams', 'ml', 'tsp', 'tbsp', 'oz', 'tablets', 'drops', 'pieces'], default: 'grams' }, use_type: { type: 'string', enum: ['mash', 'boil', 'primary', 'secondary', 'bottling', 'aging'], default: 'boil' }, time_minutes: timing, start_day: timing, duration_days: timing },
  Water: { name: recipeProperties.name, volume_liters: quantity, ...Object.fromEntries(['ca', 'mg', 'na', 'so4', 'cl', 'hco3'].flatMap(ion => ['', 'base_'].map(prefix => [`${prefix}${ion}_ppm`, { type: 'number', minimum: 0, maximum: 100000, nullable: true }]))) },
  MashStep: { ...steps, step_order: { type: 'integer', minimum: 1, maximum: 10000 }, name: recipeProperties.name, temperature_c: temperature, duration_minutes: { type: 'number', minimum: 0, maximum: 100000 } },
  FermentationStep: { ...steps, step_order: { type: 'integer', minimum: 1, maximum: 10000 }, name: recipeProperties.name, temperature_c: temperature, end_temperature_c: { ...temperature, nullable: true }, duration_days: { type: 'number', minimum: 0, maximum: 100000 } },
}
const relationRequired: Record<string, string[]> = { Grain: ['grain_id', 'amount_kg'], Hop: ['hop_id', 'amount_grams'], Yeast: ['yeast_id', 'amount_units'], Misc: ['misc_id', 'amount_units'], Water: ['name', 'volume_liters'], MashStep: ['name', 'temperature_c', 'duration_minutes'], FermentationStep: ['name', 'temperature_c', 'duration_days'] }
const relationSchemas = Object.fromEntries(Object.entries(relationInputs).flatMap(([name, properties]) => [
  [`${name}Input`, strict(properties, relationRequired[name])], [`${name}Patch`, strict(properties)],
  [`${name}Item`, relation({ ...properties, ...(name === 'Water' ? { water_calculations: { ...object, nullable: true } } : ['Grain', 'Hop', 'Yeast', 'Misc'].includes(name) ? { [({ Grain: 'grains', Hop: 'hops', Yeast: 'yeasts', Misc: 'misc_ingredients' } as Record<string, string>)[name]]: object } : {}) })],
]))
const choices = (names: string[], suffix: string) => ({ anyOf: names.map(name => ref(name + suffix)) })
const pathParameter = (name: string, values?: string[]) => ({ name, in: 'path', required: true, schema: values ? { type: 'string', enum: values } : uuid })
const nullData = { type: 'object', nullable: true, enum: [null] }
function itemPaths(segment: string, names: string[], kinds: string[], tag: string) {
  const parameters = [idParameter, pathParameter('kind', kinds)]
  return {
    [`/api/v1/recipes/{id}/${segment}/{kind}`]: {
      parameters,
      get: { tags: [tag], operationId: `list${tag}`, summary: `List ${segment} of one kind`, description: 'Requires recipes:read.', responses: { 200: success(array(choices(names, 'Item'))), ...errors } },
      post: { tags: [tag], operationId: `add${tag}`, summary: `Add an item to ${segment}`, description: 'Requires recipes:write. Use the schema matching kind. Boil/whirlpool hops require time_minutes; boil times cannot exceed the recipe boil time. Whirlpool defaults to 80°C. Process step_order is optional on create and appends when omitted.', requestBody: body(choices(names, 'Input')), responses: { 201: success(choices(names, 'Item'), 'Item added'), ...errors } },
    },
    [`/api/v1/recipes/{id}/${segment}/{kind}/{itemId}`]: {
      parameters: [...parameters, pathParameter('itemId')],
      get: { tags: [tag], operationId: `get${tag}Item`, summary: `Read ${segment === 'ingredients' ? 'an ingredient' : 'a process step'}`, description: 'Requires recipes:read. Item must belong to this recipe and kind.', responses: { 200: success(choices(names, 'Item')), ...errors } },
      patch: { tags: [tag], operationId: `update${tag}Item`, summary: `Edit ${segment === 'ingredients' ? 'an ingredient' : 'a process step'}`, description: 'Requires recipes:write. Only supplied fields change. Changing step_order reorders the process.', requestBody: body(choices(names, 'Patch')), responses: { 200: success(choices(names, 'Item')), ...errors } },
      delete: { tags: [tag], operationId: `delete${tag}Item`, summary: `Remove ${segment === 'ingredients' ? 'an ingredient' : 'a process step'}`, description: 'Requires recipes:write. Remaining process steps are renumbered.', responses: { 200: success(nullData), ...errors } },
    },
  }
}

/** Public SQLite API contract. Keep this aligned with src/app/api and the brewing repository. */
export function generateOpenAPISpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Brewey API',
      version: '1.0.0',
      description: `Manage recipes, ingredient catalogues, additions, water and brewing processes through **/api/v1**.

## Authentication and capabilities
Create a personal access token in Settings → API Tokens. Enter it alone in the Personal access token field; the client adds \`Authorization: Bearer\`. The \`x-api-key\` header also works. Choose the domain capabilities your client needs:

- **recipes:read** — recipes, ingredients, process steps, calculations and exports.
- **recipes:write** — create, update, clone, import and delete recipes or items; includes recipes:read.
- **catalog:read** — search and read reference ingredients and styles.
- **profile:read** — brewing profile and preferences.
- **profile:write** — change profile and preferences; includes profile:read.

HTTP and MCP use the same capabilities. Ownership is determined by the authenticated account, never client-supplied user IDs. Interactive requests use your explicitly entered token, omit browser cookies and do not save credentials across reloads. Test requests change your real data. Browser sessions have all capabilities and require the exact installation Origin for mutations.

## Units and responses
HTTP uses metric stored fields regardless of profile: litres, kilograms, grams, °C, EBC and mineral ppm. JSON bodies must be objects with application/json and are limited to 2 MiB. Success uses \`{ "data": ... }\`; paged results add \`meta: { total, limit, offset }\`. Errors use \`{ "error": "message" }\`. Export returns native .brewey JSON directly for download and reimport.

## Lists and validation
Recipe and catalogue lists support limit (default 50, maximum 500), offset (maximum 1,000,000), explicit filters, sort and direction. Total counts matching records before pagination. Text matching is case-insensitive, and sort includes a stable ID tie-breaker. Unsupported fields, duplicate query parameters, invalid ranges and unknown mutation fields return HTTP 400. This API does not use PostgREST query syntax.

## Rate limits
Tokens default to 1,000 requests/hour, configurable from 1–10,000. HTTP and MCP share each token's window. Validated token responses include X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset (Unix seconds). Exhaustion returns HTTP 429; invalid, expired or revoked tokens return HTTP 401. View usage in Settings → API Tokens.

## MCP
Connect an MCP client to **/api/mcp** using the same token. Use tools/list for capability-filtered tools and their current schemas. MCP follows the profile's metric/imperial preference. HTTP, MCP, chat and the browser share the same authenticated brewing operations.`,
    },
    servers: [{ url: '/', description: 'This Brewey installation' }],
    security: [{ BearerAuth: [] }],
    tags: [
      { name: 'Recipes', description: 'Create, read, edit and import your recipes.' },
      { name: 'Catalogue', description: 'Read-only reference ingredients and styles.' },
      { name: 'Ingredients', description: 'Recipe ingredient and water additions.' },
      { name: 'Process', description: 'Ordered mash and fermentation steps.' },
      { name: 'Profile', description: 'Brewing profile and unit preferences.' },
      { name: 'MCP', description: 'JSON-RPC transport for the authenticated brewing tools.' },
    ],
    paths: {
      '/api/v1/recipes': {
        get: { tags: ['Recipes'], operationId: 'listRecipes', summary: 'Search and page your recipes with calculations', description: 'Requires recipes:read. Default sort updated_at descending; name defaults ascending.', parameters: recipeQuery, responses: { 200: success(array(ref('CalculatedRecipe')), 'Matching recipes', true), ...errors } },
        post: { tags: ['Recipes'], operationId: 'createRecipe', summary: 'Create a recipe', description: 'Requires recipes:write.', requestBody: body(ref('RecipeInput')), responses: { 201: success(ref('Recipe'), 'Recipe created'), ...errors } },
      },
      '/api/v1/recipes/{id}': {
        parameters: [idParameter],
        get: { tags: ['Recipes'], operationId: 'getRecipe', summary: 'Read a recipe with all ingredients and steps', description: 'Requires recipes:read.', responses: { 200: success(ref('FullRecipe')), ...errors } },
        patch: { tags: ['Recipes'], operationId: 'updateRecipe', summary: 'Edit recipe details', description: 'Requires recipes:write. Only supplied fields change.', requestBody: body(ref('RecipePatch')), responses: { 200: success(ref('Recipe')), ...errors } },
        delete: { tags: ['Recipes'], operationId: 'deleteRecipe', summary: 'Delete a recipe and its ingredients/process', description: 'Requires recipes:write.', responses: { 200: success(nullData), ...errors } },
      },
      '/api/v1/recipes/{id}/clone': {
        parameters: [idParameter],
        post: { tags: ['Recipes'], operationId: 'cloneRecipe', summary: 'Clone a complete recipe', description: 'Requires recipes:write. Creates fresh recipe and item IDs.', requestBody: body(strict({ name: recipeProperties.name }, ['name'])), responses: { 201: success(ref('Recipe'), 'Recipe cloned'), ...errors } },
      },
      '/api/v1/recipes/import': {
        post: { tags: ['Recipes'], operationId: 'importRecipe', summary: 'Import a native .brewey recipe', description: 'Requires recipes:write. Atomic import creates new IDs and resolves catalogue ingredients by ID or exact name. Unavailable matches reject the whole import.', requestBody: body(ref('NativeImport')), responses: { 201: success(ref('FullRecipe'), 'Recipe imported'), ...errors } },
      },
      '/api/v1/recipes/{id}/export': {
        parameters: [idParameter],
        get: { tags: ['Recipes'], operationId: 'exportRecipe', summary: 'Download a native .brewey recipe', description: 'Requires recipes:read. Native JSON is returned directly, without a data envelope.', responses: { 200: { description: 'Native recipe export', headers: { ...rateHeaders, 'Content-Disposition': { schema: { type: 'string' }, example: 'attachment; filename="recipe.brewey"' } }, content: json(ref('NativeImport')) }, ...errors } },
      },
      '/api/v1/recipes/{id}/calculations': {
        parameters: [idParameter],
        get: { tags: ['Recipes'], operationId: 'getCalculations', summary: 'Read brewing calculations and recipe details', description: 'Requires recipes:read.', responses: { 200: success(ref('CalculatedRecipe')), ...errors } },
      },
      '/api/v1/recipes/{id}/styles': {
        parameters: [idParameter],
        get: { tags: ['Recipes'], operationId: 'findStylesForRecipe', summary: 'Match BJCP styles to recipe calculations and keywords', description: 'Requires recipes:read and catalog:read. Uses shared vital-statistics and text matching. Keywords are comma-separated, trimmed and empty entries omitted.', parameters: [queryParameter('keywords', { type: 'string', maxLength: 500 }, 'Optional comma-separated style keywords.'), queryParameter('limit', { type: 'integer', minimum: 1, maximum: 500, default: 10 })], responses: { 200: success(ref('StyleMatches')), ...errors } },
      },
      '/api/v1/catalog/{kind}': {
        parameters: [pathParameter('kind', ['grain', 'hop', 'yeast', 'misc', 'style'])],
        get: { tags: ['Catalogue'], operationId: 'searchCatalog', summary: 'Search and page reference ingredients or styles', description: 'Requires catalog:read. Sort name ascending by default. Only kind-specific filters are accepted.\n\n' + Object.keys(catalogText).map(kind => '**' + kind + '**: text ' + catalogText[kind].join(', ') + '; numeric min_/max_ bounds on ' + (catalogNumbers[kind].join(', ') || 'none') + '.').join('\n\n'), parameters: catalogQuery, responses: { 200: success(array(object), 'Matching catalogue records', true), ...errors } },
      },
      '/api/v1/catalog/{kind}/{id}': {
        parameters: [pathParameter('kind', ['grain', 'hop', 'yeast', 'misc', 'style']), pathParameter('id')],
        get: { tags: ['Catalogue'], operationId: 'getCatalogItem', summary: 'Read one catalogue ingredient or style', description: 'Requires catalog:read.', responses: { 200: success(object), ...errors } },
      },
      ...itemPaths('ingredients', ['Grain', 'Hop', 'Yeast', 'Misc', 'Water'], ['grain', 'hop', 'yeast', 'misc', 'water'], 'Ingredients'),
      ...itemPaths('steps', ['MashStep', 'FermentationStep'], ['mash', 'fermentation'], 'Process'),
      '/api/v1/profile': {
        get: { tags: ['Profile'], operationId: 'getProfile', summary: 'Read your brewing profile', description: 'Requires profile:read.', responses: { 200: success(ref('Profile')), ...errors } },
        patch: { tags: ['Profile'], operationId: 'updateProfile', summary: 'Update brewing profile or preferences', description: 'Requires profile:write. Only supplied fields change; preferences replaces the whole object.', requestBody: body(ref('ProfileInput')), responses: { 200: success(ref('Profile')), ...errors } },
      },
      '/api/mcp': {
        get: { tags: ['MCP'], operationId: 'getMcpInfo', summary: 'Read public MCP endpoint information', security: [], responses: { 200: { description: 'Public transport metadata', content: json(object) } } },
        post: { tags: ['MCP'], operationId: 'callMcp', summary: 'Send an authenticated JSON-RPC MCP request', description: 'Uses the same domain capabilities as HTTP. Supports initialize, ping, tools/list and tools/call. Tools are capability-filtered. Tool errors use HTTP 200 with isError:true; transport/authentication errors use HTTP error statuses.', requestBody: { required: true, content: json(ref('McpRequest')) }, responses: { 200: { description: 'JSON-RPC response', headers: rateHeaders, content: json(ref('McpResponse')) }, 202: { description: 'Notification accepted; request has no id.' }, ...errors } },
        delete: { tags: ['MCP'], operationId: 'closeMcp', summary: 'Close the stateless MCP transport', security: [], responses: { 204: { description: 'No content.' } } },
      },
    },
    components: {
      securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', description: 'Personal access token created in Brewey Settings → API Tokens. Domain capabilities govern HTTP and MCP access.' } },
      schemas: {
        StyleMatches: { type: 'object', required: ['recipe', 'matching_styles', 'total_matches', 'returned_count'], properties: { recipe: object, matching_styles: array(object), total_matches: { type: 'integer' }, returned_count: { type: 'integer' } } },
        ...relationSchemas,
        PageMetadata: { type: 'object', required: ['total', 'limit', 'offset'], properties: { total: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 } } },
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string', example: 'Recipe not found or access denied.' } } },
        RecipeInput: { ...strict(recipeProperties, ['name']), example: { name: 'Weekend pale ale', batch_size_liters: 20, boil_time_minutes: 60, efficiency_percent: 75 } },
        RecipePatch: { ...strict(recipeProperties), example: { name: 'Updated pale ale', brewing_notes: 'Mash at 66°C for 60 minutes.' } },
        Recipe: { type: 'object', properties: { id: uuid, user_id: uuid, ...recipeProperties, created_at: date, updated_at: date } },
        CalculatedRecipe: { allOf: [ref('Recipe'), { type: 'object', properties: Object.fromEntries(['og', 'fg', 'abv', 'ibu', 'ebc'].map(key => [`calculated_${key}`, { type: 'number', nullable: true }])) }] },
        FullRecipe: { allOf: [ref('Recipe'), { type: 'object', properties: {
          recipe_grains: array(ref('GrainItem')), recipe_hops: array(ref('HopItem')), recipe_yeasts: array(ref('YeastItem')), recipe_misc: array(ref('MiscItem')), recipe_water: array(ref('WaterItem')),
          recipe_mash_steps: array(ref('MashStep')), recipe_fermentation_steps: array(ref('FermentationStep')), beer_styles: { ...object, nullable: true },
        } }] },
        MashStep: { ...relation({ ...steps, duration_minutes: { type: 'number' } }), required: ['step_order', 'name', 'temperature_c', 'duration_minutes'] },
        FermentationStep: { ...relation({ ...steps, end_temperature_c: { type: 'number', nullable: true }, duration_days: { type: 'number' } }), required: ['step_order', 'name', 'temperature_c', 'duration_days'] },
        ProfileInput: { type: 'object', additionalProperties: false, properties: { profile: { type: 'string', maxLength: 10000 }, unit_system: { type: 'string', enum: ['metric', 'imperial'] }, preferences: object } },
        Profile: { type: 'object', required: ['id', 'profile', 'unit_system', 'preferences', 'updated_at'], properties: { id: uuid, profile: { type: 'string' }, unit_system: { type: 'string', enum: ['metric', 'imperial'] }, preferences: object, updated_at: { ...date, nullable: true } } },
        NativeRecipeInput: { ...strict({ ...recipeProperties, bjcp_style_number: { type: 'string', description: 'Portable BJCP number used when the original style ID is unavailable.' } }, ['name']) },
        NativeImport: { type: 'object', required: ['format', 'recipe'], properties: {
          exported_at: date, format: { type: 'string', enum: ['brewey-native'] }, version: { type: 'string', enum: ['1.0.0'] }, recipe: ref('NativeRecipeInput'),
          grains: importArray('Rows with grain_id or grains.name, and amount_kg.'),
          hops: importArray('Rows with hop_id or hops.name, amount_grams, time_minutes and use_type.'),
          yeasts: importArray('Rows with yeast_id or yeasts.name, amount_units and unit_type.'),
          misc_ingredients: importArray('Rows with misc_id or misc_ingredients.name, amount_units, unit_type and use_type.'),
          water: importArray('Rows with name, volume_liters and optional mineral ppm values.'),
          mash_steps: importArray('Rows with step_order, name, temperature_c and duration_minutes.'),
          fermentation_steps: importArray('Rows with step_order, name, temperature_c and duration_days.'),
        }, example: { format: 'brewey-native', version: '1.0.0', recipe: { name: 'Imported pale ale', batch_size_liters: 20 }, grains: [], hops: [] } },
        McpRequest: { type: 'object', required: ['jsonrpc', 'method'], properties: { jsonrpc: { type: 'string', enum: ['2.0'] }, id: { oneOf: [{ type: 'integer' }, { type: 'string' }] }, method: { type: 'string', example: 'tools/list' }, params: object }, example: { jsonrpc: '2.0', id: 1, method: 'tools/list' } },
        McpResponse: { type: 'object', properties: { jsonrpc: { type: 'string', enum: ['2.0'] }, id: { oneOf: [{ type: 'integer' }, { type: 'string' }] }, result: object, error: { type: 'object', properties: { code: { type: 'integer' }, message: { type: 'string' } } } } },
      },
    },
  }
}
