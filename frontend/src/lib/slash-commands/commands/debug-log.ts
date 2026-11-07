/**
 * Debug log slash command - opens the debug log as a standalone HTML page
 */

import { debugLogger } from '@/lib/debug-logger'
import type { SlashCommandHandler, SlashCommandResult } from '../types'

export const debugLogCommand: SlashCommandHandler = {
  name: 'debug',
  type: 'system',
  description: 'Open the debug log as a self-contained HTML page in a new tab',
  usage: '/debug',
  
  execute: (): SlashCommandResult => {
    try {
      if (!debugLogger.hasLogs()) {
        return {
          success: false,
          message: '⚠️ **No debug logs available**\n\nThere are currently no debug logs to display. Debug logs are created during chat interactions.',
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      debugLogger.openHtmlLog()

      return {
        success: true,
        message: '🧭 **Opened debug log HTML**\n\nA new tab was opened with your debug log. You can save it as an HTML file from your browser.',
        shouldAddToChat: true,
        messageType: 'success'
      }
    } catch (error) {
      return {
        success: false,
        message: `❌ Failed to open debug log HTML: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToChat: true,
        messageType: 'error'
      }
    }
  }
}


