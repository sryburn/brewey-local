'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, Milkdown, MilkdownProvider } from '@milkdown/react'
import { Editor, defaultValueCtx, rootCtx, editorViewOptionsCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { nord } from '@milkdown/theme-nord'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { history } from '@milkdown/plugin-history'
import '@milkdown/theme-nord/style.css'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import '../../../styles/milkdown.css'
import { replaceAll } from '@milkdown/utils'
import { editorViewCtx, schemaCtx } from '@milkdown/core'
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands'
import { wrapInList, liftListItem } from 'prosemirror-schema-list'
import type { MarkType, NodeType } from 'prosemirror-model'
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon, Heading1, Heading2, Heading3, Quote, Minus, Code2, List, ListOrdered } from 'lucide-react'

interface MilkdownEditorProps {
  value: string
  onChange: (next: string) => void
  className?: string
  // External document identity: force refresh editor when this changes
  docVersion?: string
  onEditorFocus?: (editableEl: HTMLElement) => void
  onEditorBlur?: (editableEl: HTMLElement) => void
  // Hide the link button (useful for profile editor where AI can't follow links)
  hideLinkButton?: boolean
}

function MilkdownEditorInner({ value, onChange, className, docVersion, onEditorFocus, onEditorBlur, hideLinkButton = false }: MilkdownEditorProps) {
  const editorValueRef = useRef<string>('')
  const isApplyingExternalRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastUpdateSourceRef = useRef<'editor' | 'external' | null>(null)
  const prevDocVersionRef = useRef<string | undefined>(undefined)
  const pendingExternalMarkdownRef = useRef<string | null>(null)
  const editorApi = useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, value ?? '')
          // Make links open with Ctrl/Cmd+Click
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            handleDOMEvents: {
              ...(prev?.handleDOMEvents || {}),
              mousedown: (view, event) => {
                const e = event as MouseEvent
                const target = e.target as HTMLElement | null
                const link = target?.closest('a') as HTMLAnchorElement | null
                if (link && (e.metaKey || e.ctrlKey)) {
                  const href = link.getAttribute('href')
                  if (href) window.open(href, '_blank', 'noopener')
                  return true
                }
                return false
              }
            }
          }))
        })
        .config(nord)
        .use(commonmark)
        .use(gfm)
        .use(listener)
        .use(history),
    []
  )

  type ToolbarState = {
    bold: boolean
    italic: boolean
    strike: boolean
    code: boolean
    link: boolean
    h1: boolean
    h2: boolean
    h3: boolean
    blockquote: boolean
    codeBlock: boolean
    bulletList: boolean
    orderedList: boolean
  }
  const [toolbarState, setToolbarState] = useState<ToolbarState>({ bold: false, italic: false, strike: false, code: false, link: false, h1: false, h2: false, h3: false, blockquote: false, codeBlock: false, bulletList: false, orderedList: false })

  const toolbarStateRef = useRef<ToolbarState>(toolbarState)
  const rafIdRef = useRef<number | null>(null)

  const setToolbarStateIfChanged = useCallback((next: ToolbarState) => {
    const prev = toolbarStateRef.current
    if (
      prev.bold === next.bold &&
      prev.italic === next.italic &&
      prev.strike === next.strike &&
      prev.code === next.code &&
      prev.link === next.link &&
      prev.h1 === next.h1 &&
      prev.h2 === next.h2 &&
      prev.h3 === next.h3 &&
      prev.blockquote === next.blockquote &&
      prev.codeBlock === next.codeBlock &&
      prev.bulletList === next.bulletList &&
      prev.orderedList === next.orderedList
    ) {
      return
    }
    toolbarStateRef.current = next
    setToolbarState(next)
  }, [])

  const computeToolbarState = useCallback(() => {
    const editor = editorApi.get()
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    const state = view.state
    const schema = editor.ctx.get(schemaCtx)
    const marks = schema.marks as Record<string, MarkType>
    const strong = marks['strong']
    const em = marks['em'] ?? marks['emphasis'] ?? marks['i'] ?? marks['italic']
    const strike = marks['strike_through'] ?? marks['strikethrough'] ?? marks['s'] ?? marks['strike']
    const code = marks['code'] ?? marks['code_inline'] ?? marks['inlineCode']
    const link = marks['link']

    const isMarkActive = (mark?: MarkType): boolean => {
      if (!mark) return false
      const { from, $from, to, empty } = state.selection
      if (empty) return !!mark.isInSet(state.storedMarks || $from.marks())
      return state.doc.rangeHasMark(from, to, mark)
    }

    const isHeadingLevel = (level: number): boolean => {
      const node = state.selection.$from.parent
      return node.type === schema.nodes.heading && node.attrs?.level === level
    }
    const isBlockquote = (): boolean => state.selection.$from.parent.type === schema.nodes.blockquote
    const isCodeBlock = (): boolean => state.selection.$from.parent.type === schema.nodes.code_block
    const inListType = (type: 'bullet' | 'ordered'): boolean => {
      const target = type === 'bullet' ? schema.nodes.bullet_list : schema.nodes.ordered_list
      const $from = state.selection.$from
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === target) return true
      }
      return false
    }

    setToolbarStateIfChanged({
      bold: isMarkActive(strong),
      italic: isMarkActive(em),
      strike: isMarkActive(strike),
      code: isMarkActive(code),
      link: isMarkActive(link),
      h1: isHeadingLevel(1),
      h2: isHeadingLevel(2),
      h3: isHeadingLevel(3),
      blockquote: isBlockquote(),
      codeBlock: isCodeBlock(),
      bulletList: inListType('bullet'),
      orderedList: inListType('ordered')
    })
  }, [editorApi, setToolbarStateIfChanged])

  const scheduleComputeToolbarState = useCallback(() => {
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      computeToolbarState()
    })
  }, [computeToolbarState])

  useEffect(() => {
    const editor = editorApi.get()
    if (!editor) return
    editor.action((ctx) => {
      const l = ctx.get(listenerCtx)
      l.markdownUpdated((_, markdown) => {
        // Ignore updates triggered by our own external replace to preserve selection
        if (isApplyingExternalRef.current) return
        editorValueRef.current = markdown
        lastUpdateSourceRef.current = 'editor'
        onChange(markdown)
        scheduleComputeToolbarState()
      })
      l.focus(() => {
        const editable = (containerRef.current?.querySelector('.ProseMirror') as HTMLElement | null)
        if (editable && onEditorFocus) onEditorFocus(editable)
        scheduleComputeToolbarState()
        // No JS helper; CSS ::after handles hover hint
      })
      l.blur(() => {
        const editable = (containerRef.current?.querySelector('.ProseMirror') as HTMLElement | null)
        if (editable && onEditorBlur) onEditorBlur(editable)
        scheduleComputeToolbarState()
        // No extra cleanup required for CSS-based hint
      })
    })
    scheduleComputeToolbarState()
  }, [editorApi, onChange, onEditorFocus, onEditorBlur, scheduleComputeToolbarState])

  // Handle backspace to lift out of blockquote at start of line
  useEffect(() => {
    const container = containerRef.current
    const editable = container?.querySelector('.ProseMirror') as HTMLElement | null
    if (!editable) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace') return
      const editor = editorApi.get()
      if (!editor) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { state, dispatch } = view
        const schema = ctx.get(schemaCtx)
        const sel = state.selection
        const $from = sel.$from
        const atLineStart = sel.empty && $from.parentOffset === 0
        if (!atLineStart) return
        // If inside a code block, convert to paragraph on backspace at start
        if ($from.parent.type === schema.nodes.code_block) {
          const paragraph = schema.nodes.paragraph
          if (paragraph) {
            const changed = setBlockType(paragraph)(state, dispatch)
            if (changed) {
              e.preventDefault()
              scheduleComputeToolbarState()
              return
            }
          }
        }
        // Detect if selection is inside a blockquote at any depth
        let inBlockquote = false
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === schema.nodes.blockquote) {
            inBlockquote = true
            break
          }
        }
        if (!inBlockquote) return
        const lifted = lift(state, dispatch)
        if (lifted) {
          e.preventDefault()
          scheduleComputeToolbarState()
        }
      })
    }
    editable.addEventListener('keydown', onKeyDown)
    return () => {
      editable.removeEventListener('keydown', onKeyDown)
    }
  }, [editorApi, scheduleComputeToolbarState])

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  // Apply external value updates safely:
  // - If editor is not focused, apply immediately
  // - If focused, buffer and apply on blur to avoid cursor flicker
  useEffect(() => {
    const editor = editorApi.get()
    if (!editor) return
    const incoming = value ?? ''
    if (incoming === editorValueRef.current) return
    const container = containerRef.current
    const isFocused = container && typeof document !== 'undefined' && container.contains(document.activeElement)
    if (isFocused) {
      const current = editorValueRef.current ?? ''
      const isEditorEmpty = current.trim().length === 0
      const isIncomingNonEmpty = incoming.trim().length > 0
      // If editor is focused but currently empty, apply external content immediately
      if (!(isEditorEmpty && isIncomingNonEmpty)) {
        pendingExternalMarkdownRef.current = incoming
        return
      }
    }
    // Not focused (or focused but empty): apply external update immediately
    editorValueRef.current = incoming
    isApplyingExternalRef.current = true
    lastUpdateSourceRef.current = 'external'
    editor.action(replaceAll(incoming))
    Promise.resolve().then(() => { isApplyingExternalRef.current = false })
  }, [value, editorApi])

  // On blur, if there is a pending external update, apply it now
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleFocusOut = () => {
      if (pendingExternalMarkdownRef.current == null) return
      const editor = editorApi.get()
      if (!editor) return
      const incoming = pendingExternalMarkdownRef.current
      pendingExternalMarkdownRef.current = null
      editorValueRef.current = incoming
      isApplyingExternalRef.current = true
      lastUpdateSourceRef.current = 'external'
      editor.action(replaceAll(incoming))
      Promise.resolve().then(() => { isApplyingExternalRef.current = false })
    }
    container.addEventListener('focusout', handleFocusOut)
    return () => {
      container.removeEventListener('focusout', handleFocusOut)
    }
  }, [editorApi])

  // Force-refresh when the external document identity changes (recipe switch).
  useEffect(() => {
    const editor = editorApi.get()
    if (!editor) return
    if (docVersion === prevDocVersionRef.current) return
    prevDocVersionRef.current = docVersion
    const incoming = value ?? ''
    // Replace with new doc; force apply even if focused
    editorValueRef.current = incoming
    isApplyingExternalRef.current = true
    lastUpdateSourceRef.current = 'external'
    editor.action(replaceAll(incoming))
    Promise.resolve().then(() => { isApplyingExternalRef.current = false })
    pendingExternalMarkdownRef.current = null
  }, [docVersion, value, editorApi])

  return (
    <div className={className} ref={containerRef}>
      {/* md+ only: max-md:hidden + md:flex avoids Tailwind v4 hidden+md:* stuck display:none */}
      <div className="max-md:hidden md:flex md:flex-wrap items-center gap-2 mb-2 pb-2 border-b border-gray-400 dark:border-gray-500 text-gray-700 dark:text-gray-200">
        {/* Bold */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.bold ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const mark = schema.marks.strong
              if (mark) toggleMark(mark)(state, dispatch)
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Bold"
        >
          <Bold className="w-4 h-4" />
        </button>

        {/* Italic */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.italic ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const marks = schema.marks as Record<string, MarkType>
              const italic = marks['em'] ?? marks['emphasis'] ?? marks['i'] ?? marks['italic']
              if (italic) toggleMark(italic)(state, dispatch)
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Italic"
        >
          <Italic className="w-4 h-4" />
        </button>

        {/* Strikethrough */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.strike ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const marks = schema.marks as Record<string, MarkType>
              const strike: MarkType | undefined = marks['strike_through'] ?? marks['strikethrough'] ?? marks['s'] ?? marks['strike']
              if (strike) toggleMark(strike)(state, dispatch)
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Strikethrough"
        >
          <Strikethrough className="w-4 h-4" />
        </button>

        {/* H1 */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.h1 ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const heading = schema.nodes.heading
              const paragraph = schema.nodes.paragraph
              if (!heading || !paragraph) return
              if (toolbarState.h1) {
                setBlockType(paragraph)(state, dispatch)
              } else {
                setBlockType(heading, { level: 1 })(state, dispatch)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Heading 1"
        >
          <Heading1 className="w-4 h-4" />
        </button>

        {/* H2 */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.h2 ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const heading = schema.nodes.heading
              const paragraph = schema.nodes.paragraph
              if (!heading || !paragraph) return
              if (toolbarState.h2) {
                setBlockType(paragraph)(state, dispatch)
              } else {
                setBlockType(heading, { level: 2 })(state, dispatch)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Heading 2"
        >
          <Heading2 className="w-4 h-4" />
        </button>

        {/* H3 */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.h3 ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const heading = schema.nodes.heading
              const paragraph = schema.nodes.paragraph
              if (!heading || !paragraph) return
              if (toolbarState.h3) {
                setBlockType(paragraph)(state, dispatch)
              } else {
                setBlockType(heading, { level: 3 })(state, dispatch)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Heading 3"
        >
          <Heading3 className="w-4 h-4" />
        </button>

        {/* Bulleted list */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.bulletList ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const bullet = schema.nodes.bullet_list
              const listItem = schema.nodes.list_item
              const paragraph = schema.nodes.paragraph
              if (!bullet || !listItem || !paragraph) return
              
              if (toolbarState.bulletList) {
                liftListItem(listItem)(state, dispatch)
              } else {
                // Handle multi-line text properly
                const { from, to } = state.selection
                const selectedText = state.doc.textBetween(from, to)
                
                if (selectedText.includes('\n')) {
                  // Multi-line selection - split into separate list items
                  const lines = selectedText.split('\n').filter(line => line.trim().length > 0)
                  
                  if (lines.length > 1) {
                    const tr = state.tr
                    tr.delete(from, to)
                    
                    // Create list with items for each line
                    const listItems = lines.map(line => 
                      listItem.create(null, paragraph.create(null, schema.text(line.trim())))
                    )
                    const list = bullet.create(null, listItems)
                    tr.insert(from, list)
                    
                    dispatch(tr)
                    view.focus()
                    scheduleComputeToolbarState()
                    return
                  }
                }
                
                // Single line or no selection - use standard wrapInList
                wrapInList(bullet)(state, dispatch)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Bulleted list"
        >
          <List className="w-4 h-4" />
        </button>

        {/* Ordered list */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.orderedList ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const ordered = schema.nodes.ordered_list
              const listItem = schema.nodes.list_item
              const paragraph = schema.nodes.paragraph
              if (!ordered || !listItem || !paragraph) return
              
              if (toolbarState.orderedList) {
                liftListItem(listItem)(state, dispatch)
              } else {
                // Handle multi-line text properly
                const { from, to } = state.selection
                const selectedText = state.doc.textBetween(from, to)
                
                if (selectedText.includes('\n')) {
                  // Multi-line selection - split into separate list items
                  const lines = selectedText.split('\n').filter(line => line.trim().length > 0)
                  
                  if (lines.length > 1) {
                    const tr = state.tr
                    tr.delete(from, to)
                    
                    // Create list with items for each line
                    const listItems = lines.map(line => 
                      listItem.create(null, paragraph.create(null, schema.text(line.trim())))
                    )
                    const list = ordered.create(null, listItems)
                    tr.insert(from, list)
                    
                    dispatch(tr)
                    view.focus()
                    scheduleComputeToolbarState()
                    return
                  }
                }
                
                // Single line or no selection - use standard wrapInList
                wrapInList(ordered)(state, dispatch)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Numbered list"
        >
          <ListOrdered className="w-4 h-4" />
        </button>

        {/* Link */}
        {!hideLinkButton && (
          <button
            type="button"
            className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.link ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
            onMouseDown={(e) => { e.preventDefault() }}
            onClick={() => {
              const editor = editorApi.get()
              if (!editor) return
              editor.action((ctx) => {
                const view = ctx.get(editorViewCtx)
                const { state, dispatch } = view
                const schema = ctx.get(schemaCtx)
                const link = schema.marks.link
                if (!link) return
                const { from, to } = state.selection
                if (from === to) return
                const linkActive = (() => {
                  const { empty, $from } = state.selection
                  if (empty) return !!link.isInSet(state.storedMarks || $from.marks())
                  return state.doc.rangeHasMark(from, to, link)
                })()
                let tr = state.tr
                if (linkActive) {
                  tr = tr.removeMark(from, to, link)
                } else {
                  const url = window.prompt('Enter URL') || ''
                  if (url) tr = tr.addMark(from, to, link.create({ href: url }))
                }
                if (tr !== state.tr) dispatch(tr)
                view.focus()
                scheduleComputeToolbarState()
              })
            }}
            aria-label="Link"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
        )}

        {/* Inline code */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.code ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const marks = schema.marks as Record<string, MarkType>
              const code = marks['code'] ?? marks['code_inline'] ?? marks['inlineCode']
              if (!code) return
              const { from, to, empty } = state.selection
              if (empty) {
                toggleMark(code)(state, dispatch)
              } else {
                let tr = state.tr
                const hasMarkSomewhere = state.doc.rangeHasMark(from, to, code)
                if (hasMarkSomewhere) {
                  tr = tr.removeMark(from, to, code)
                } else {
                  tr = tr.addMark(from, to, code.create())
                }
                if (tr !== state.tr) dispatch(tr)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Inline code"
        >
          <Code className="w-4 h-4" />
        </button>

        {/* Code block */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.codeBlock ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const nodes = schema.nodes as unknown as Record<string, NodeType>
              const codeBlock = nodes['code_block']
              const paragraph = nodes['paragraph']
              if (!codeBlock || !paragraph) return
              const inCodeBlock = state.selection.$from.parent.type === codeBlock
              if (inCodeBlock) setBlockType(paragraph)(state, dispatch)
              else setBlockType(codeBlock)(state, dispatch)
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Code block"
        >
          <Code2 className="w-4 h-4" />
        </button>

        {/* Blockquote */}
        <button
          type="button"
          className={`px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 ${toolbarState.blockquote ? 'bg-gray-200 dark:bg-gray-700' : ''}`}
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const blockquote = schema.nodes.blockquote
              if (!blockquote) return
              if (toolbarState.blockquote) {
                lift(state, dispatch)
              } else {
                wrapIn(blockquote)(state, dispatch)
              }
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Blockquote"
        >
          <Quote className="w-4 h-4" />
        </button>

        {/* Horizontal rule */}
        <button
          type="button"
          className="px-2 py-1 rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
          onMouseDown={(e) => { e.preventDefault() }}
          onClick={() => {
            const editor = editorApi.get()
            if (!editor) return
            editor.action((ctx) => {
              const view = ctx.get(editorViewCtx)
              const { state, dispatch } = view
              const schema = ctx.get(schemaCtx)
              const nodes = schema.nodes as unknown as Record<string, NodeType>
              const hrType: NodeType | undefined = nodes['hr'] ?? nodes['horizontal_rule']
              if (!hrType) return
              const tr = state.tr.replaceSelectionWith(hrType.create())
              dispatch(tr)
              view.focus()
              scheduleComputeToolbarState()
            })
          }}
          aria-label="Horizontal rule"
        >
          <Minus className="w-4 h-4" />
        </button>
      </div>
      <Milkdown />
    </div>
  )
}

export default function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  )
}


