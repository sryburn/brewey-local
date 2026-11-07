/**
 * Profile slash command - navigates to the profile page
 */

import type { SlashCommandHandler, SlashCommandResult } from '../types'

export const profileCommand: SlashCommandHandler = {
  name: 'profile',
  type: 'system',
  description: 'View and edit your profile',
  usage: '/profile',
  
  execute: (): SlashCommandResult => {
    return {
      success: true,
      message: '🔄 **Navigating to profile...**',
      shouldAddToChat: false,
      messageType: 'system',
      specialAction: 'profile'
    }
  }
}
