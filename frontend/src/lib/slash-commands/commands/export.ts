/**
 * Export slash command - exports the current recipe as a native Brewey format file
 */

import type { SlashCommandHandler, SlashCommandResult } from '../types'
import { debug } from '@/lib/debug'
import { useRecipeStore } from '@/lib/stores/recipe-store'

export const exportCommand: SlashCommandHandler = {
  name: 'export',
  type: 'system',
  description: 'Export current recipe as native Brewey format (.brewey file)',
  usage: '/export',

  execute: async (): Promise<SlashCommandResult> => {
    try {
      debug.log('🔧 Executing export command')
      
      // Get current recipe from store
      const recipeStore = useRecipeStore.getState()
      const { selectedRecipeId, recipeMetadata } = recipeStore
      
      if (!selectedRecipeId || !recipeMetadata) {
        return {
          success: false,
          message: '❌ **No recipe selected**: Please select a recipe to export.',
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      // Generate and download the export file
      const result = await generateRecipeExport(recipeMetadata.name)
      
      if (!result.success) {
        return {
          success: false,
          message: `❌ **Export failed**: ${result.error}`,
          shouldAddToChat: true,
          messageType: 'error'
        }
      }

      return {
        success: true,
        message: `✅ **Recipe exported**: ${recipeMetadata.name}.brewey downloaded successfully`,
        shouldAddToChat: true,
        messageType: 'success'
      }
      
    } catch (error) {
      debug.error('❌ Export command failed:', error)
      return {
        success: false,
        message: `❌ **Export failed**: ${error instanceof Error ? error.message : 'Unknown error'}`,
        shouldAddToChat: true,
        messageType: 'error'
      }
    }
  }
}

interface ExportResult {
  success: boolean
  error?: string
}

/**
 * Generates and downloads a recipe export file
 */
async function generateRecipeExport(recipeName: string): Promise<ExportResult> {
  try {
    debug.log('📦 Generating recipe export for:', { recipeName })
    
    const selectedId = useRecipeStore.getState().selectedRecipeId
    if (!selectedId) return { success: false, error: 'No recipe selected' }
    const response = await fetch(`/api/v1/recipes/${encodeURIComponent(selectedId)}/export`, { credentials: 'same-origin', cache: 'no-store' })
    const exportData = await response.json()
    if (!response.ok) return { success: false, error: exportData.error || 'Failed to fetch recipe data' }

    // Generate the export JSON
    const exportJson = JSON.stringify(exportData, null, 2)
    
    // Create and download the file
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    
    // Create download link and click it
    const downloadLink = document.createElement('a')
    downloadLink.href = url
    downloadLink.download = `${sanitizeFileName(recipeName)}.brewey`
    downloadLink.style.display = 'none'
    
    document.body.appendChild(downloadLink)
    downloadLink.click()
    document.body.removeChild(downloadLink)
    
    // Clean up the URL
    URL.revokeObjectURL(url)
    
    debug.log('✅ Recipe export completed successfully')
    return { success: true }
    
  } catch (error) {
    debug.error('❌ Failed to generate recipe export:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Sanitizes a filename for safe file system usage
 */
function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 100) // Limit length
}
