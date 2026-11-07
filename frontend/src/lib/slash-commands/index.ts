/**
 * Main slash commands processor
 */

import { debug } from '@/lib/debug'
import type { SlashCommandResult, SlashCommandHandler } from './types'
import { parseSlashCommand, getAvailableCommandsHelp } from './utils'
import { commandRegistry } from './commands'

/**
 * Execute a slash command
 */
export async function executeSlashCommand(input: string, commands: Record<string, SlashCommandHandler> = commandRegistry): Promise<SlashCommandResult> {
  const { command, args } = parseSlashCommand(input)
  
  debug.log('🔧 Executing slash command:', { command, args })
  
  const handler = commands[command]
  if (!handler) {
    return {
      success: false,
      message: `❓ **Unknown command:** \`/${command}\`\n\n${getAvailableCommandsHelp(commands)}`,
      shouldAddToChat: true,
      messageType: 'error'
    }
  }
  
  try {
    // Handle different command types
    if (handler.type === 'system') {
      // Execute system command locally
      if (!handler.execute) {
        throw new Error(`System command ${command} missing execute function`)
      }
      
      const result = await Promise.resolve(handler.execute(args))
      debug.log('✅ System command completed:', { command, success: result.success })
      return result
      
    } else if (handler.type === 'llm-routing') {
      // Route to cheaper LLM (future implementation)
      throw new Error('LLM routing commands not yet implemented')
      
    } else if (handler.type === 'context-switching') {
      // Switch chat mode (future implementation) 
      throw new Error('Context switching commands not yet implemented')
      
    } else {
      throw new Error(`Unsupported command type: ${handler.type}`)
    }
    
  } catch (error) {
    debug.error('❌ Slash command failed:', { command, error })
    
    return {
      success: false,
      message: `❌ **Command failed:** ${error instanceof Error ? error.message : 'Unknown error'}`,
      shouldAddToChat: true,
      messageType: 'error'
    }
  }
}

// Re-export utilities and types for convenience
export { isSlashCommand, parseSlashCommand } from './utils'
export type { SlashCommandResult, SlashCommandHandler, ParsedSlashCommand } from './types'
