/**
 * Type definitions for slash commands system
 */

export interface SlashCommandResult {
  success: boolean
  message: string
  shouldAddToChat?: boolean
  messageType?: 'system' | 'error' | 'success'
  
  // For LLM routing commands (future)
  naturalLanguageVersion?: string
  assistantResponse?: string
  
  // For context switching commands (future)  

  // For special system actions (clear, import, profile, etc.)
  specialAction?: 'clear' | 'compact' | 'import' | 'profile' | 'resume' | 'rename' | 'delete' | 'status' | 'reload' | 'settings' | 'stop' | 'cancel-import'
}

export interface SlashCommandHandler {
  name: string
  type: 'system' | 'llm-routing' | 'context-switching'
  description: string
  usage: string
  
  // For system commands (current implementation)
  execute?: (args: string[]) => Promise<SlashCommandResult> | SlashCommandResult
  
  // For LLM routing commands (future)
  template?: (args: string[]) => string
  model?: string
  includeInContext?: boolean
  
  // For context switching commands (future)
  systemPrompt?: string | ((user: unknown) => string)
  availableTools?: string[]
  contextLoader?: (user: unknown) => Promise<string>
}

export interface ParsedSlashCommand {
  command: string
  args: string[]
}
