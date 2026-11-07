import { memo, useState, useCallback, useRef, useEffect } from 'react'
import { NotebookPen } from 'lucide-react'
import dynamic from 'next/dynamic'

// Loading component for the editor
const EditorSkeleton = () => (
  <div className="animate-pulse">
    <div className="space-y-3">
      <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-3/4"></div>
      <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-1/2"></div>
      <div className="h-4 bg-gray-200 dark:bg-gray-600 rounded w-5/6"></div>
    </div>
  </div>
)

const MilkdownEditor = dynamic(() => import('./MilkdownEditor'), { 
  ssr: false,
  loading: () => <EditorSkeleton />
})

import type { RecipeMetadata } from '@/types/database'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import { updateRecipe } from '@/lib/api/recipes'
import { debug } from '@/lib/debug'

interface RecipeNotesProps {
  recipeMetadata: RecipeMetadata | null
  isMobileExpanded: boolean
  isMobile: boolean
  expandedBrewingNotes: boolean
  expandedTastingNotes: boolean
  toggleBrewingNotesExpansion: () => void
  toggleTastingNotesExpansion: () => void
  onNotesUpdate: (updatedMetadata: RecipeMetadata) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export const RecipeNotes = memo<RecipeNotesProps>(({ 
  recipeMetadata,
  isMobileExpanded,
  isMobile,
  expandedBrewingNotes,
  expandedTastingNotes,
  toggleBrewingNotesExpansion,
  toggleTastingNotesExpansion,
  onNotesUpdate,
  scrollContainerRef
}) => {
  // Local state for editing
  const [brewingNotesValue, setBrewingNotesValue] = useState(recipeMetadata?.brewing_notes || '')
  const [tastingNotesValue, setTastingNotesValue] = useState(recipeMetadata?.tasting_notes || '')
  const [savingBrewingNotes, setSavingBrewingNotes] = useState(false)
  const [savingTastingNotes, setSavingTastingNotes] = useState(false)
  const [brewingFocused, setBrewingFocused] = useState(false)
  const [tastingFocused, setTastingFocused] = useState(false)

  // Refs for debounce timeouts
  const brewingNotesTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const tastingNotesTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const SCROLL_MARGIN_PX = 200

  // Keep temporary handlers during keyboard animation per editor
  const brewingViewportCleanupRef = useRef<Array<() => void>>([])
  const tastingViewportCleanupRef = useRef<Array<() => void>>([])

  const ensureElementInView = useCallback((el: HTMLElement | null) => {
    const container = scrollContainerRef?.current
    if (!container || !el) return
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const margin = 12
    let delta = 0
    if (elRect.bottom + margin > containerRect.bottom) {
      delta = (elRect.bottom + margin) - containerRect.bottom
    } else if (elRect.top - margin < containerRect.top) {
      delta = (elRect.top - margin) - containerRect.top
    }
    if (delta !== 0) {
      container.scrollTop += delta
    }
  }, [scrollContainerRef])

  const attachViewportStabilizers = useCallback((editable: HTMLElement, cleanupRef: React.MutableRefObject<Array<() => void>>) => {
    // Burst ensures across keyboard animation window
    ensureElementInView(editable)
    setTimeout(() => ensureElementInView(editable), 60)
    setTimeout(() => ensureElementInView(editable), 140)
    setTimeout(() => ensureElementInView(editable), 260)
    setTimeout(() => ensureElementInView(editable), 420)
    // Follow visualViewport resize/scroll during animation
    if (typeof window !== 'undefined' && window.visualViewport) {
      const handler = () => ensureElementInView(editable)
      window.visualViewport.addEventListener('resize', handler)
      window.visualViewport.addEventListener('scroll', handler)
      cleanupRef.current.push(() => window.visualViewport?.removeEventListener('resize', handler))
      cleanupRef.current.push(() => window.visualViewport?.removeEventListener('scroll', handler))
      // Auto-clean after ~1s in case blur doesn't fire
      const autoTimer = window.setTimeout(() => {
        while (cleanupRef.current.length) {
          const fn = cleanupRef.current.pop()
          if (fn) { try { fn() } catch {} }
        }
      }, 1000)
      cleanupRef.current.push(() => window.clearTimeout(autoTimer))
    }
  }, [ensureElementInView])

  // Wrapper-based focus listeners removed; handled via Milkdown focus callbacks now

  // Update local state when recipe metadata changes
  useEffect(() => {
    if (recipeMetadata) {
      // Cancel any pending autosaves from prior recipe
      if (brewingNotesTimeoutRef.current) clearTimeout(brewingNotesTimeoutRef.current)
      if (tastingNotesTimeoutRef.current) clearTimeout(tastingNotesTimeoutRef.current)
      setBrewingNotesValue(recipeMetadata.brewing_notes || '')
      setTastingNotesValue(recipeMetadata.tasting_notes || '')
    }
  }, [recipeMetadata])

  // Remove textarea-specific auto-resize/scroll handling; Milkdown manages layout.

  // Autosave function
  const saveNotes = useCallback(async (field: 'brewing_notes' | 'tasting_notes', value: string) => {
    if (!recipeMetadata || useRecipeStore.getState().userId !== recipeMetadata.user_id || useRecipeStore.getState().selectedRecipeId !== recipeMetadata.id) return

    try {
      const setSaving = field === 'brewing_notes' ? setSavingBrewingNotes : setSavingTastingNotes
      setSaving(true)

      const { error } = await updateRecipe(recipeMetadata.id, { [field]: value || null })
      if (useRecipeStore.getState().userId !== recipeMetadata.user_id || useRecipeStore.getState().selectedRecipeId !== recipeMetadata.id) return

      if (error) {
        debug.error(`Failed to save ${field}:`, error)
        return
      }

      // Update the metadata in parent component
      const updatedMetadata = {
        ...recipeMetadata,
        [field]: value || null
      }
      onNotesUpdate(updatedMetadata)

      debug.log(`✅ Saved ${field} successfully`)
    } catch (error) {
      debug.error(`Error saving ${field}:`, error)
    } finally {
      const setSaving = field === 'brewing_notes' ? setSavingBrewingNotes : setSavingTastingNotes
      setSaving(false)
    }
  }, [recipeMetadata, onNotesUpdate])

  // Debounced save handlers with auto-resize
  const handleBrewingNotesChange = useCallback((value: string) => {
    setBrewingNotesValue(value)
    // Clear existing timeout
    if (brewingNotesTimeoutRef.current) {
      clearTimeout(brewingNotesTimeoutRef.current)
    }

    // Set new timeout for autosave (1 second debounce)
    brewingNotesTimeoutRef.current = setTimeout(() => {
      saveNotes('brewing_notes', value)
    }, 1000)
  }, [saveNotes])

  const handleTastingNotesChange = useCallback((value: string) => {
    setTastingNotesValue(value)
    // Clear existing timeout
    if (tastingNotesTimeoutRef.current) {
      clearTimeout(tastingNotesTimeoutRef.current)
    }

    // Set new timeout for autosave (1 second debounce)
    tastingNotesTimeoutRef.current = setTimeout(() => {
      saveNotes('tasting_notes', value)
    }, 1000)
  }, [saveNotes])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (brewingNotesTimeoutRef.current) {
        clearTimeout(brewingNotesTimeoutRef.current)
      }
      if (tastingNotesTimeoutRef.current) {
        clearTimeout(tastingNotesTimeoutRef.current)
      }
    }
  }, [])

  // Don't render if no recipe metadata
  if (!recipeMetadata) {
    return null
  }

  return (
    <div
      className={`mb-6 ${
        !isMobileExpanded ? 'max-md:hidden' : ''
      }`}
    >
      <h2 className="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <NotebookPen className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
        <span>Notes</span>
      </h2>
      {/* Brewing Notes */}
      <div className="mb-4">
        <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
          <div
            className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation()
              toggleBrewingNotesExpansion()
            }}
          >
            <div className="min-w-0">
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mr-4">
                Brewing
              </h3>
            </div>
            <div className="flex items-center">
              {savingBrewingNotes && (
                <div className="flex items-center space-x-1 mr-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Saving...</span>
                </div>
              )}
              <svg
                className={`w-4 h-4 transition-transform duration-200 text-gray-400 ${expandedBrewingNotes ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {expandedBrewingNotes && (
            <div className="px-3 pb-3 pt-1 animate-recipeFadeIn bg-white dark:bg-stone-700 relative">
              <MilkdownEditor
                key={`brewing-${recipeMetadata.id}`}
                value={brewingNotesValue}
                onChange={handleBrewingNotesChange}
                docVersion={recipeMetadata.id}
                onEditorFocus={(editable) => {
                  setBrewingFocused(true)
                  if (!isMobile || !isMobileExpanded) return
                  try { editable.style.scrollMarginBottom = `${SCROLL_MARGIN_PX}px` } catch {}
                  try { editable.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }) } catch {}
                  attachViewportStabilizers(editable, brewingViewportCleanupRef)
                }}
                onEditorBlur={(editable) => {
                  setBrewingFocused(false)
                  try { editable.style.scrollMarginBottom = '' } catch {}
                  // Cleanup any pending stabilizers
                  while (brewingViewportCleanupRef.current.length) {
                    const fn = brewingViewportCleanupRef.current.pop()
                    if (fn) { try { fn() } catch {} }
                  }
                }}
              />
              {brewingNotesValue.trim().length === 0 && !brewingFocused && (
                <div className="absolute left-2 top-2 md:top-10 text-sm text-gray-500 dark:text-gray-400 pointer-events-none select-none">
                  Click to add brewing notes...
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tasting Notes */}
      <div className="mb-4">
        <div className="rounded-lg overflow-hidden transition-all duration-300 ease-in-out bg-white dark:bg-gray-800">
          <div
            className="flex justify-between items-center p-3 cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={(e) => {
              e.stopPropagation()
              toggleTastingNotesExpansion()
            }}
          >
            <div className="min-w-0">
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mr-4">
                Tasting
              </h3>
            </div>
            <div className="flex items-center">
              {savingTastingNotes && (
                <div className="flex items-center space-x-1 mr-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-amber-600"></div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Saving...</span>
                </div>
              )}
              <svg
                className={`w-4 h-4 transition-transform duration-200 text-gray-400 ${expandedTastingNotes ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {expandedTastingNotes && (
            <div className="px-3 pb-3 pt-1 animate-recipeFadeIn bg-white dark:bg-stone-700 relative">
              <MilkdownEditor
                key={`tasting-${recipeMetadata.id}`}
                value={tastingNotesValue}
                onChange={handleTastingNotesChange}
                docVersion={recipeMetadata.id}
                onEditorFocus={(editable) => {
                  setTastingFocused(true)
                  if (!isMobile || !isMobileExpanded) return
                  try { editable.style.scrollMarginBottom = `${SCROLL_MARGIN_PX}px` } catch {}
                  try { editable.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }) } catch {}
                  attachViewportStabilizers(editable, tastingViewportCleanupRef)
                }}
                onEditorBlur={(editable) => {
                  setTastingFocused(false)
                  try { editable.style.scrollMarginBottom = '' } catch {}
                  while (tastingViewportCleanupRef.current.length) {
                    const fn = tastingViewportCleanupRef.current.pop()
                    if (fn) { try { fn() } catch {} }
                  }
                }}
              />
              {tastingNotesValue.trim().length === 0 && !tastingFocused && (
                <div className="absolute left-2 top-2 md:top-10 text-sm text-gray-500 dark:text-gray-400 pointer-events-none select-none">
                  Click to add tasting notes...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

RecipeNotes.displayName = 'RecipeNotes'
