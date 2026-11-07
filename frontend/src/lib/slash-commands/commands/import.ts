/**
 * Import slash command - triggers file upload for importing beer recipes
 */

import type { SlashCommandHandler, SlashCommandResult } from '../types'

export const importCommand: SlashCommandHandler = {
  name: 'import',
  type: 'system',
  description: 'Import a beer recipe file (JSON, XML, TXT, BSMX, YAML, YML, BREWEY)',
  usage: '/import',

  execute: (): SlashCommandResult => {
    try {
      // Return a special action flag that ChatInput will handle
      // This triggers the file input click in the ChatInput component
      return {
        success: true,
        message: '', // No message needed - file dialog is self-evident
        shouldAddToChat: false,
        messageType: 'success',
        // Special flag for ChatInput to handle opening file dialog
        specialAction: 'import'
      }
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to open file import dialog: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToChat: true,
        messageType: 'error'
      }
    }
  }
}
