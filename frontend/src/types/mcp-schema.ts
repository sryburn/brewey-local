/**
 * Type definitions for MCP (Model Context Protocol) schema
 */

export interface MCPToolProperty {
  type?: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: {
    type: string;
  };
  anyOf?: Array<{
    type: string;
  }>;
}

export interface MCPToolInputSchema {
  type: string;
  properties: Record<string, MCPToolProperty>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: MCPToolInputSchema;
}

export interface MCPSchema {
  tools: MCPTool[];
  totalTools?: number;
  fetchedAt?: string;
  serverUrl?: string;
}

/**
 * Type guard to validate if an object is a valid MCP schema
 */
export function isValidMCPSchema(schema: unknown): schema is MCPSchema {
  if (!schema || typeof schema !== 'object') return false;
  
  const s = schema as Record<string, unknown>;
  if (!Array.isArray(s.tools)) return false;
  
  // Validate each tool has required properties
  for (const tool of s.tools as unknown[]) {
    if (!tool || typeof tool !== 'object') return false;
    const t = tool as Record<string, unknown>;
    if (!t.name || typeof t.name !== 'string') return false;
    if (!t.inputSchema || typeof t.inputSchema !== 'object') return false;
    const inputSchema = t.inputSchema as Record<string, unknown>;
    if (!inputSchema.properties || typeof inputSchema.properties !== 'object') return false;
  }
  
  return true;
}

/**
 * Check if a tool requires a recipe_id parameter
 */
export function toolRequiresRecipeId(tool: MCPTool): boolean {
  return 'recipe_id' in tool.inputSchema.properties;
}

/**
 * Check if recipe_id is required (not optional) for a tool
 */
export function isRecipeIdRequired(tool: MCPTool): boolean {
  return tool.inputSchema.required?.includes('recipe_id') ?? false;
}
