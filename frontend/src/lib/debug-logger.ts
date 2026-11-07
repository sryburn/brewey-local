/**
 * Client-Side Debug Logger for Brewey
 * Stores conversation flow and tool calls for debugging support
 */

import { AppConfig, config } from '@/lib/config'
import { getRecipeWithIngredients } from '@/lib/api/recipes'

interface DebugLogEntry {
  timestamp: string
  type: 'user_message' | 'chatbot_response' | 'tool_call' | 'tool_result' | 'error'
  content: string
  metadata?: {
    toolName?: string
    toolId?: string
    duration?: number
    args?: unknown
    result?: unknown
    error?: string
    sessionId?: string
    recipeId?: string
  }
}

export class ClientDebugLogger {
  private static instance: ClientDebugLogger
  private logs: DebugLogEntry[] = []
  private readonly storageKey = 'brewey-debug-logs'
  private sessionId: string = ''
  private currentRecipeId: string = ''
  private config: AppConfig

  private constructor() {
    this.config = config
    
    if (this.config.debug.enableLocalStorage) {
      this.loadFromStorage()
    }
    this.generateSessionId()
  }

  static getInstance(): ClientDebugLogger {
    if (!ClientDebugLogger.instance) {
      ClientDebugLogger.instance = new ClientDebugLogger()
    }
    return ClientDebugLogger.instance
  }

  private generateSessionId(): void {
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined' || !this.config.debug.enableLocalStorage) return
    
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        this.logs = JSON.parse(stored)
      }
    } catch (error) {
      console.warn('Failed to load debug logs from storage:', error)
      this.logs = []
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined' || !this.config.debug.enableLocalStorage) return
    
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.logs))
    } catch (error) {
      console.warn('Failed to save debug logs to storage:', error)
    }
  }

  setCurrentRecipe(recipeId: string): void {
    this.currentRecipeId = recipeId
  }

  logUserMessage(content: string): void {
    this.addLog({
      type: 'user_message',
      content,
      metadata: {
        sessionId: this.sessionId,
        recipeId: this.currentRecipeId
      }
    })
  }

  logChatbotResponse(content: string): void {
    this.addLog({
      type: 'chatbot_response',
      content,
      metadata: {
        sessionId: this.sessionId,
        recipeId: this.currentRecipeId
      }
    })
  }

  logToolCall(toolName: string, toolId: string, args: unknown): void {
    this.addLog({
      type: 'tool_call',
      content: `Tool call: ${toolName}`,
      metadata: {
        toolName,
        toolId,
        args,
        sessionId: this.sessionId,
        recipeId: this.currentRecipeId
      }
    })
  }

  logToolResult(toolName: string, toolId: string, result: unknown, duration?: number): void {
    this.addLog({
      type: 'tool_result',
      content: `Tool result: ${toolName}`,
      metadata: {
        toolName,
        toolId,
        result,
        duration,
        sessionId: this.sessionId,
        recipeId: this.currentRecipeId
      }
    })
  }

  logToolError(toolName: string, toolId: string, error: string, duration?: number): void {
    this.addLog({
      type: 'tool_result', // Use tool_result type but with error metadata
      content: `Tool error: ${toolName}`,
      metadata: {
        toolName,
        toolId,
        error,
        duration,
        sessionId: this.sessionId,
        recipeId: this.currentRecipeId
      }
    })
  }

  logError(message: string, error?: string): void {
    this.addLog({
      type: 'error',
      content: message,
      metadata: {
        error,
        sessionId: this.sessionId,
        recipeId: this.currentRecipeId
      }
    })
  }

  private addLog(entry: Omit<DebugLogEntry, 'timestamp'>): void {
    // Don't log if debugging is disabled
    if (!this.config.debug.enabled) {
      return
    }

    const logEntry: DebugLogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    }
    
    this.logs.push(logEntry)
    this.saveToStorage()
  }

  clear(): void {
    this.logs = []
    this.generateSessionId() // New session after clear
    if (typeof window !== 'undefined' && this.config.debug.enableLocalStorage) {
      localStorage.removeItem(this.storageKey)
    }
  }

  hasLogs(): boolean {
    return this.logs.length > 0
  }

  private htmlEscape(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  async exportToHTML(): Promise<string> {
    const title = 'Brewey Debug Log'
    const hasLogs = this.logs.length > 0
    const startTime = hasLogs ? this.logs[0].timestamp : new Date().toISOString()
    const startDate = new Date(startTime).toLocaleDateString('en-GB')
    const startTimeFormatted = new Date(startTime).toLocaleTimeString('en-GB')
    const recipeInfo = this.currentRecipeId ? ` - Current Recipe: ${this.currentRecipeId}` : ''
    const isoNow = new Date().toISOString()
    const timestamp = isoNow.replace(/[:.]/g, '-').split('T')[0] + '-' + isoNow.split('T')[1].split('.')[0].replace(/:/g, '-')
    const fileName = `brewey-debug-log-${timestamp}.html`

    // Fetch current recipe data for debug context
    let recipeContextHtml = ''
    if (this.currentRecipeId && typeof window !== 'undefined') {
      try {
        const result = await getRecipeWithIngredients(this.currentRecipeId)
        const recipeResponse = { success: !result.error, recipe: result.data, error: result.error }
          if (recipeResponse?.success && recipeResponse?.recipe) {
            const recipeJson = JSON.stringify(recipeResponse.recipe, null, 2)
            recipeContextHtml = `
<details class="recipe-context">
  <summary>📋 Current Recipe Data (LLM Context)</summary>
  <div class="recipe-section">
    <p class="recipe-note">Recipe data from this installation at the time of export.</p>
    <pre class="code"><code>${this.htmlEscape(recipeJson)}</code></pre>
  </div>
</details>
<div class="spacer" aria-hidden="true"></div>
`
          }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        recipeContextHtml = `
<details class="recipe-context">
  <summary>📋 Recipe Context (Error)</summary>
  <div class="recipe-section">
    <p class="error-text">Failed to fetch recipe data: ${this.htmlEscape(errorMsg)}</p>
  </div>
</details>
<div class="spacer" aria-hidden="true"></div>
`
      }
    }

    // Build conversation HTML
    type Processed = { log: DebugLogEntry; toolResult?: DebugLogEntry }
    const processedLogs: Processed[] = []
    for (let i = 0; i < this.logs.length; i++) {
      const log = this.logs[i]
      if (log.type === 'tool_call') {
        const nextLog = this.logs[i + 1]
        if (nextLog && nextLog.type === 'tool_result' && nextLog.metadata?.toolId === log.metadata?.toolId) {
          processedLogs.push({ log, toolResult: nextLog })
          i++
        } else {
          processedLogs.push({ log })
        }
      } else if (log.type !== 'tool_result') {
        processedLogs.push({ log })
      }
    }

    let conversation = ''
    processedLogs.forEach(({ log, toolResult }, index) => {
      const time = new Date(log.timestamp).toLocaleTimeString('en-GB')
      if (log.type === 'user_message') {
        conversation += `
<blockquote class="msg user"><div class="badge">${this.htmlEscape(time)} 🧑</div><div class="content">${this.htmlEscape(log.content)}</div></blockquote>
`
      } else if (log.type === 'chatbot_response') {
        conversation += `
<blockquote class="msg assistant"><div class="badge">${this.htmlEscape(time)} 🤖</div><div class="content">${this.htmlEscape(log.content)}</div></blockquote>
`
      } else if (log.type === 'error') {
        const errorContent = `Error: ${log.content}${log.metadata?.error ? ` - ${log.metadata.error}` : ''}`
        conversation += `
<blockquote class="msg error"><div class="badge">${this.htmlEscape(time)} ❌</div><div class="content">${this.htmlEscape(errorContent)}</div></blockquote>
`
      } else if (log.type === 'tool_call') {
        const status = toolResult?.metadata?.error ? '❌' : '✅'
        const responseTime = toolResult ? new Date(toolResult.timestamp).toLocaleTimeString('en-GB') : time
        conversation += `
<details class="tool">
  <summary>🔧 ${this.htmlEscape(log.metadata?.toolName || 'Tool')} ${status}</summary>
  <div class="tool-section"><div class="tool-time">${this.htmlEscape(time)} Request</div>
${log.metadata?.args ? `<pre class="code"><code>${this.htmlEscape(JSON.stringify(log.metadata.args, null, 2))}</code></pre>` : ''}
${toolResult ? `<div class="tool-time">${this.htmlEscape(responseTime)} Response</div>
${toolResult.metadata?.result ? `<pre class="code"><code>${this.htmlEscape(JSON.stringify(toolResult.metadata.result, null, 2))}</code></pre>` : toolResult.metadata?.error ? `<div class="error-text">${this.htmlEscape(toolResult.metadata.error)}</div>` : ''}` : ''}
  </div>
</details>
`
        const nextLog = processedLogs[index + 1]
        if (nextLog && (nextLog.log.type === 'user_message' || nextLog.log.type === 'chatbot_response' || nextLog.log.type === 'error')) {
          conversation += `
<div class="spacer" aria-hidden="true"></div>
`
        }
      }
    })

    const bodyContent = hasLogs
      ? `<section>
  ${recipeContextHtml}
  <h2>Conversation Flow</h2>
  ${conversation}
</section>`
      : `<section>
  ${recipeContextHtml}
  <p>No conversation data available.</p>
</section>`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.htmlEscape(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    html, body { margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif; line-height: 1.5; background: #ffffff; color: #0f172a; }
    @media (prefers-color-scheme: dark) { body { background: #0b0b0c; color: #e7e5e4; } }
    .container { max-width: 900px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 24px 0 8px; }
    .meta { margin: 0 0 16px; font-size: 14px; color: #334155; }
    @media (prefers-color-scheme: dark) { .meta { color: #a8a29e; } }
    blockquote.msg { margin: 12px 0; padding: 12px 14px; border: 1px solid; border-radius: 8px; }
    blockquote.msg .badge { font-weight: 600; margin-bottom: 6px; font-size: 13px; opacity: 0.9; }
    blockquote.msg .content { white-space: pre-wrap; word-break: break-word; font-size: 14px; }
    blockquote.user { background: #f1f5f9; border-color: #cbd5e1; }
    blockquote.assistant { background: #f8fafc; border-color: #cbd5e1; }
    blockquote.error { background: #fef2f2; border-color: #fecaca; }
    @media (prefers-color-scheme: dark) {
      blockquote.user { background: #0b2538; border-color: #1f2937; }
      blockquote.assistant { background: #0f172a; border-color: #1f2937; }
      blockquote.error { background: #3b0d0d; border-color: #7f1d1d; }
    }
    details.tool { margin: 12px 0; padding: 0; border: 1px solid; border-radius: 8px; overflow: hidden; }
    details.tool summary { cursor: pointer; padding: 10px 12px; background: #eef2ff; border-bottom: 1px solid; list-style: none; }
    details.tool[open] summary { border-bottom-color: inherit; }
    .tool-section { padding: 12px; background: #f8fafc; }
    .tool-time { font-size: 12px; opacity: 0.8; margin: 6px 0; }
    .code { margin: 8px 0 12px; padding: 10px; border-radius: 6px; overflow: auto; background: #0f172a; color: #e5e7eb; }
    .error-text { color: #b91c1c; font-weight: 600; margin: 6px 0; }
    .spacer { height: 8px; }
    @media (prefers-color-scheme: dark) {
      details.tool summary { background: #0f172a; }
      .tool-section { background: #0b0b0c; }
    }
    details.recipe-context { margin: 12px 0; padding: 0; border: 1px solid; border-radius: 8px; overflow: hidden; border-color: #10b981; }
    details.recipe-context summary { cursor: pointer; padding: 10px 12px; background: #ecfdf5; border-bottom: 1px solid; list-style: none; font-weight: 600; color: #065f46; }
    details.recipe-context[open] summary { border-bottom-color: inherit; }
    .recipe-section { padding: 12px; background: #f0fdf4; }
    .recipe-note { font-size: 14px; color: #374151; margin: 0 0 12px; font-style: italic; }
    @media (prefers-color-scheme: dark) {
      details.recipe-context { border-color: #10b981; }
      details.recipe-context summary { background: #064e3b; color: #6ee7b7; }
      .recipe-section { background: #022c22; }
      .recipe-note { color: #d1d5db; }
    }
    .muted { color: #64748b; }
    @media (prefers-color-scheme: dark) { .muted { color: #a1a1aa; } }
    .header { margin-bottom: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; justify-content: space-between; }
    .actions { display: flex; gap: 8px; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 14px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: inherit; text-decoration: none; cursor: pointer; }
    .btn:hover { background: #eef2ff; }
    @media (prefers-color-scheme: dark) { .btn { border-color: #374151; background: #111827; } .btn:hover { background: #1f2937; } }
  </style>
</head>
<body>
  <main class="container">
    <header class="header">
      <h1>${this.htmlEscape(title)}</h1>
      <div class="meta">Session: ${this.htmlEscape(this.sessionId)} · Started: ${this.htmlEscape(startDate)}, ${this.htmlEscape(startTimeFormatted)}${recipeInfo ? ` · ${this.htmlEscape(recipeInfo)}` : ''}</div>
      <div class="actions">
        <a id="downloadLink" class="btn" download="${this.htmlEscape(fileName)}" href="#">⬇️ Download</a>
      </div>
    </header>
    ${bodyContent}
  </main>
  <script>
  (function(){
    function prepareDownload() {
      try {
        var clone = document.documentElement.cloneNode(true);
        var actions = clone.querySelector('.actions');
        if (actions && actions.parentNode) {
          actions.parentNode.removeChild(actions);
        }
        var html = '<!DOCTYPE html>' + (clone.outerHTML || new XMLSerializer().serializeToString(clone));
        var blob = new Blob([html], { type: 'text/html' });
        var url = URL.createObjectURL(blob);
        var link = document.getElementById('downloadLink');
        if (link) {
          link.setAttribute('href', url);
        }
      } catch (e) {
        try { console.warn('Failed to prepare download link', e); } catch(_) {}
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', prepareDownload);
    } else {
      prepareDownload();
    }
  })();
  </script>
</body>
</html>`

    return html
  }

  async openHtmlLog(): Promise<void> {
    if (!this.config.debug.enableDownloads) {
      console.warn('Debug log downloads are disabled')
      return
    }
    const html = await this.exportToHTML()
    if (typeof window === 'undefined') return
    try {
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const newWindow = window.open('', '_blank')
      if (newWindow) {
        try { newWindow.opener = null } catch {}
        newWindow.location.href = url
      } else {
        // Fallback for PWAs or blocked popups: trigger a direct download
        const isoNow = new Date().toISOString()
        const timestamp = isoNow.replace(/[:.]/g, '-').split('T')[0] + '-' + isoNow.split('T')[1].split('.')[0].replace(/:/g, '-')
        const filename = `brewey-debug-log-${timestamp}.html`
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch (e) {
      console.warn('Failed to open debug log HTML via Blob URL', e)
    }
  }

}

// Export singleton instance
export const debugLogger = ClientDebugLogger.getInstance() 