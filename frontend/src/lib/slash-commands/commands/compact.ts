import type { SlashCommandHandler } from '../types'

export const compactCommand: SlashCommandHandler = {
  name: 'compact', type: 'system', usage: '/compact',
  description: 'Compact active agent context while retaining the full saved transcript',
  execute: () => ({ success: true, message: '', shouldAddToChat: false, specialAction: 'compact' }),
}
