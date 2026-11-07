import { useState, useRef, useEffect } from 'react'
import { debug } from '@/lib/debug'
import type { FileAttachment } from '@/types/attachments'
import { processRecipeFile, isNativeBreweyFormat } from '@/lib/utils/file-processing'

export interface UseFileUploadReturn {
  uploadedFile: FileAttachment | null
  fileError: string | null
  isProcessingFile: boolean
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  removeUploadedFile: () => void
  clearFileError: () => void
}

export interface UseFileUploadOptions {
  onNativeFileDetected?: (file: FileAttachment) => void
}

export function useFileUpload(options?: UseFileUploadOptions): UseFileUploadReturn {
  const [uploadedFile, setUploadedFile] = useState<FileAttachment | null>(null)
  const [isProcessingFile, setIsProcessingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const readGenerationRef = useRef(0)
  const mountedRef = useRef(false)

  // File reads cannot be aborted reliably; invalidate their results on teardown.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      readGenerationRef.current += 1
      if (fileErrorTimeoutRef.current) {
        clearTimeout(fileErrorTimeoutRef.current)
        fileErrorTimeoutRef.current = null
      }
    }
  }, [])

  const clearFileError = () => {
    try {
      // Clear timeout when manually dismissing error
      if (fileErrorTimeoutRef.current) {
        clearTimeout(fileErrorTimeoutRef.current)
        fileErrorTimeoutRef.current = null
      }
      setFileError(null)
    } catch (error) {
      debug.log('📎 Error dismiss error (handled):', error instanceof Error ? error.message : 'Unknown error')
      // Force clear error state
      setFileError(null)
    }
  }

  const removeUploadedFile = () => {
    readGenerationRef.current += 1
    try {
      // Clear any pending error timeout
      if (fileErrorTimeoutRef.current) {
        clearTimeout(fileErrorTimeoutRef.current)
        fileErrorTimeoutRef.current = null
      }
      setUploadedFile(null)
      setFileError(null)
      setIsProcessingFile(false)
    } catch (error) {
      debug.log('📎 File remove error (handled):', error instanceof Error ? error.message : 'Unknown error')
      // Still attempt to clear file state even if error occurs
      setUploadedFile(null)
      setFileError(null)
      setIsProcessingFile(false)
    }
  }

  const setErrorWithTimeout = (errorMessage: string) => {
    setFileError(errorMessage)
    
    // Clear any existing timeout
    if (fileErrorTimeoutRef.current) {
      clearTimeout(fileErrorTimeoutRef.current)
    }
    
    // Auto-clear error after 10 seconds
    fileErrorTimeoutRef.current = setTimeout(() => {
      try {
        setFileError(null)
        fileErrorTimeoutRef.current = null
      } catch (error) {
        debug.log('📎 Auto-clear error timeout (handled):', error instanceof Error ? error.message : 'Unknown error')
      }
    }, 10000)
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const generation = ++readGenerationRef.current
    const isCurrentRead = () => mountedRef.current && readGenerationRef.current === generation
    const input = event.target
    if (fileErrorTimeoutRef.current) {
      clearTimeout(fileErrorTimeoutRef.current)
      fileErrorTimeoutRef.current = null
    }

    // Clear any previous errors
    setFileError(null)
    setIsProcessingFile(true)
    
    try {
      const fileAttachment = await processRecipeFile(file)
      if (!isCurrentRead()) return
      
      // Check if this is a native .brewey file
      if (isNativeBreweyFormat(fileAttachment.content) && options?.onNativeFileDetected) {
        debug.log('🏠 Native .brewey file detected, triggering immediate import')
        options.onNativeFileDetected(fileAttachment)
        // Don't set as uploadedFile for native files - they're processed immediately
      } else {
        // Regular file upload flow for non-native files
        setUploadedFile(fileAttachment)
        debug.log('📎 File processed:', { name: file.name, size: file.size, type: file.type })
      }
    } catch (error) {
      if (!isCurrentRead()) return
      // Log error for debugging but don't re-throw to console
      debug.log('📎 File processing error (handled):', error instanceof Error ? error.message : 'Unknown error')
      
      let errorMessage = 'Failed to process file'
      
      if (error instanceof Error) {
        // Provide more user-friendly error messages
        if (error.message.includes('too large')) {
          errorMessage = `File is too large. Maximum size allowed is 100KB (${Math.round(file.size / 1024)}KB uploaded).`
        } else if (error.message.includes('Unsupported file type')) {
          errorMessage = `Unsupported file type. Please upload JSON, XML, TXT, BSMX, YAML, YML, or BREWEY files.`
        } else if (error.message.includes('empty')) {
          errorMessage = 'The selected file is empty. Please choose a file with recipe content.'
        } else if (error.message.includes('corrupted') || error.message.includes('Failed to read')) {
          errorMessage = 'Unable to read the file. Please ensure the file is not corrupted and try again.'
        } else {
          errorMessage = error.message
        }
      }
      
      setErrorWithTimeout(errorMessage)
      
    } finally {
      if (isCurrentRead()) {
        setIsProcessingFile(false)
        // An older read must not reset a newer selection's input.
        if (input) input.value = ''
      }
    }
  }

  return {
    uploadedFile,
    fileError,
    isProcessingFile,
    handleFileUpload,
    removeUploadedFile,
    clearFileError
  }
}
