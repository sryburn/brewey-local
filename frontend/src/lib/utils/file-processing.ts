import type { FileAttachment } from '@/types/attachments'

/**
 * Valid MIME types for recipe files
 */
const VALID_MIME_TYPES = [
  'application/json',
  'text/xml',
  'text/plain',
  'application/xml',
  'text/yaml',
  'application/x-yaml'
]

/**
 * Valid file extensions for recipe files
 */
const VALID_EXTENSIONS = ['.xml', '.json', '.txt', '.bsmx', '.yaml', '.yml', '.brewey']

/**
 * Maximum file size in bytes (100KB)
 */
const MAX_FILE_SIZE = 100 * 1024

/**
 * Validates file type by checking both MIME type and file extension
 */
function isValidFileType(file: File): boolean {
  return VALID_MIME_TYPES.includes(file.type) || 
         VALID_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))
}

/**
 * Reads and processes a recipe file, returning a FileAttachment object
 * 
 * @param file - The File object to process
 * @returns Promise<FileAttachment> - Processed file attachment
 * @throws Error - If file is invalid, too large, empty, or corrupted
 */
export async function processRecipeFile(file: File): Promise<FileAttachment> {
  try {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error('File too large (max 100KB)')
    }

    if (file.size === 0) {
      throw new Error('File is empty. Please select a file with content.')
    }

    // Validate file type
    if (!isValidFileType(file)) {
      throw new Error('Unsupported file type. Please upload JSON, XML, TXT, BSMX, YAML, YML, or BREWEY files.')
    }

    // Read file content
    let textContent: string
    try {
      textContent = await file.text()
    } catch {
      throw new Error('Failed to read file content. Please ensure the file is not corrupted.')
    }

    // Validate content is not empty
    if (!textContent.trim()) {
      throw new Error('File appears to be empty. Please select a file with recipe content.')
    }

    // Return processed file attachment
    return {
      id: globalThis.crypto?.randomUUID?.() || Math.random().toString(36),
      name: file.name,
      type: 'text',
      size: file.size,
      content: textContent,
      mimeType: file.type
    }
  } catch (error) {
    // Re-throw with preserved error message for proper error handling upstream
    throw error
  }
}

/**
 * Checks if a file extension is supported
 * 
 * @param filename - The filename to check
 * @returns boolean - True if the extension is supported
 */
export function isSupportedFileExtension(filename: string): boolean {
  return VALID_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext))
}

/**
 * Gets a human-readable list of supported file types
 * 
 * @returns string - Comma-separated list of supported extensions
 */
export function getSupportedFileTypes(): string {
  return VALID_EXTENSIONS.join(', ').toUpperCase()
}

/**
 * Formats file size in human-readable format
 * 
 * @param bytes - File size in bytes
 * @returns string - Formatted file size (e.g., "25KB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0B'
  if (bytes < 1024) return `${bytes}B`
  return `${Math.round(bytes / 1024)}KB`
}

/**
 * Detects if a file content is in native Brewey format
 * 
 * @param content - File content as string
 * @returns boolean - True if content is native Brewey format
 */
export function isNativeBreweyFormat(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    return (
      parsed.format === 'brewey-native' && 
      parsed.version && 
      parsed.recipe && 
      typeof parsed.recipe === 'object'
    )
  } catch {
    return false
  }
}

/**
 * Validates native Brewey format structure
 * 
 * @param content - File content as string
 * @returns { valid: boolean, errors: string[] } - Validation result
 */
export function validateNativeBreweyFormat(content: string): { valid: boolean, errors: string[] } {
  const errors: string[] = []
  
  try {
    const parsed = JSON.parse(content)
    
    // Check required top-level fields
    if (!parsed.format || parsed.format !== 'brewey-native') {
      errors.push('Missing or invalid format field')
    }
    
    if (!parsed.version) {
      errors.push('Missing version field')
    }
    
    if (!parsed.recipe || typeof parsed.recipe !== 'object') {
      errors.push('Missing or invalid recipe object')
    } else {
      // Check required recipe fields
      if (!parsed.recipe.name) {
        errors.push('Recipe must have a name')
      }
      
      if (typeof parsed.recipe.batch_size_liters !== 'number') {
        errors.push('Recipe must have valid batch_size_liters')
      }
    }
    
    // Check that arrays exist (can be empty)
    const requiredArrays = ['grains', 'hops', 'yeasts', 'misc_ingredients', 'water', 'mash_steps', 'fermentation_steps']
    requiredArrays.forEach(arrayName => {
      if (!Array.isArray(parsed[arrayName])) {
        errors.push(`Missing or invalid ${arrayName} array`)
      }
    })
    
    return { valid: errors.length === 0, errors }
    
  } catch {
    errors.push('Invalid JSON format')
    return { valid: false, errors }
  }
}
