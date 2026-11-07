/**
 * Utility functions for slash command processing
 */

import type { ParsedSlashCommand, SlashCommandHandler } from './types'

/**
 * Check if a message is a slash command
 */
export function isSlashCommand(message: string): boolean {
  return message.trim().startsWith('/')
}

/**
 * Parse a slash command into command name and arguments
 */
export function parseSlashCommand(message: string): ParsedSlashCommand {
  const trimmed = message.trim().substring(1) // Remove leading '/'
  const parts = trimmed.split(/\s+/).filter(part => part.length > 0) // Remove empty parts
  
  return {
    command: parts[0]?.toLowerCase() || '',
    args: parts.slice(1)
  }
}

/**
 * Generate help text for available commands
 */
export function getAvailableCommandsHelp(commands: Record<string, SlashCommandHandler>): string {
  const commandList = Object.values(commands)
    .map((cmd) => `- \`${cmd.usage}\` - ${cmd.description}`)
    .join('\n')
    
  return `**Available commands:**\n\n${commandList}`
}

/** Match command names, preserving the registry's deliberate ordering. */
export function matchSlashCommands(input: string, commands: Record<string, SlashCommandHandler>): SlashCommandHandler[] {
  if (!/^\/[^\s]*$/.test(input.trimStart())) return []
  const prefix = input.trimStart().slice(1).toLowerCase()
  return Object.values(commands).filter(command => command.name.startsWith(prefix))
}
