import { BrewingTools, type BrewingClient } from '../brewing-tools'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const tool: Tool = { name: 'update_recipe', inputSchema: { type: 'object', properties: { recipe_id: { type: 'string' } }, required: ['recipe_id'] } }
const success = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })

test('concurrent request contexts cannot change each other\'s recipe selection', async () => {
  const callTool = jest.fn(async (_name: string, args: Record<string, unknown>) => success({ success: true, recipe: { id: args.recipe_id } }))
  const client: BrewingClient = { callTool }
  const first = new BrewingTools(client, [tool], 'first')
  const second = new BrewingTools(client, [tool], 'second')
  await Promise.all([first.execute('select_recipe', { recipe_id: 'third' }), second.execute('update_recipe', {})])
  await first.execute('update_recipe', {})
  expect(callTool).toHaveBeenCalledWith('update_recipe', { recipe_id: 'second' })
  expect(callTool).toHaveBeenLastCalledWith('update_recipe', { recipe_id: 'third' })
})

test('inaccessible selection never changes the active recipe', async () => {
  const callTool = jest.fn(async (name: string) => name === 'get_recipe_by_id' ? success({ success: false, error: 'Not found' }) : success({ success: true }))
  const tools = new BrewingTools({ callTool }, [tool], 'owned')
  expect((await tools.execute('select_recipe', { recipe_id: 'unowned' })).success).toBe(false)
  await tools.execute('update_recipe', {})
  expect(callTool).toHaveBeenLastCalledWith('update_recipe', { recipe_id: 'owned' })
})

test('a successful create selects the new recipe for subsequent tool calls', async () => {
  const create: Tool = { name: 'create_recipe', inputSchema: { type: 'object' } }
  const callTool = jest.fn(async () => success({ success: true, recipe: { id: 'new' } }))
  const tools = new BrewingTools({ callTool }, [tool, create])
  await tools.execute('create_recipe', { name: 'Test' })
  await tools.execute('update_recipe', {})
  expect(callTool).toHaveBeenLastCalledWith('update_recipe', { recipe_id: 'new' })
})

test('missing selection, unknown tools and MCP isError fail without false success', async () => {
  const callTool = jest.fn(async () => ({ ...success({ error: 'Failed' }), isError: true }))
  const tools = new BrewingTools({ callTool }, [tool])
  expect((await tools.execute('update_recipe', {})).success).toBe(false)
  expect((await tools.execute('unknown', {})).success).toBe(false)
  expect(callTool).not.toHaveBeenCalled()
  expect((await tools.execute('update_recipe', { recipe_id: 'owned' })).success).toBe(false)
})
