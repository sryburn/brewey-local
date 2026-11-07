/**
 * Command registry - central place for all slash commands
 */

import type { SlashCommandHandler, SlashCommandResult } from '../types'
import { debugLogCommand } from './debug-log'
import { clearCommand } from './clear'
import { compactCommand } from './compact'
import { importCommand } from './import'
import { printCommand } from './print'
import { exportCommand } from './export'
import { profileCommand } from './profile'

const action = (name: string, description: string, specialAction: SlashCommandResult['specialAction']): SlashCommandHandler => ({
  name, type: 'system', usage: `/${name}`, description,
  execute: () => ({ success: true, message: '', specialAction }),
})

// Registry of all available commands
// Order matters - this determines the order shown in error messages
export const commandRegistry: Record<string, SlashCommandHandler> = {
  'new': { ...clearCommand, name: 'new', usage: '/new' },
  'resume': action('resume', 'Find and resume a saved chat', 'resume'),
  'rename': { ...action('rename', 'Rename this saved chat', 'rename'), usage: '/rename [title]' },
  'clear': { ...clearCommand, description: 'Alias for /new; keeps the previous chat in history' },
  'delete': action('delete', 'Delete this saved chat after confirmation', 'delete'),
  'status': action('status', 'Show saved chat and context status', 'status'),
  'reload': action('reload', 'Reload the saved chat after a connection error', 'reload'),
  'settings': action('settings', 'Configure your agent, model, thinking and verbosity', 'settings'),
  'stop': action('stop', 'Stop the response running on this device', 'stop'),
  'cancel-import': action('cancel-import', 'Remove the attached file and leave import mode', 'cancel-import'),
  'compact': compactCommand,
  'profile': profileCommand,
  'import': importCommand,
  'export': exportCommand,
  'print': printCommand,
  'debug': debugLogCommand
}

// Export individual commands for direct imports if needed
export { debugLogCommand, clearCommand, importCommand, printCommand, exportCommand, profileCommand }
