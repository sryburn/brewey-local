/**
 * Clear chat slash command - archives the current conversation and starts another
 */

import type { SlashCommandHandler, SlashCommandResult } from '../types'

export const clearCommand: SlashCommandHandler = {
  name: 'clear',
  type: 'system',
  description: 'Start a new chat; keep the previous chat in history',
  usage: '/clear',

  execute: (): SlashCommandResult => {
    try {
      // Return a special action flag that ChatInput will handle
      // This triggers clearHistory() in the ChatInput component
      return {
        success: true,
        message: '', // No message needed - clearing is self-evident
        shouldAddToChat: false,
        messageType: 'success',
        // Special flag for ChatInput to handle the clearing
        specialAction: 'clear'
      }
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to clear chat: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToChat: true,
        messageType: 'error'
      }
    }
  }
}
