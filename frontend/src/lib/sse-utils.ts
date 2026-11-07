/**
 * Server-Sent Events (SSE) utilities for streaming responses
 */

/**
 * Safely enqueue SSE data to a ReadableStream controller
 * Handles closed connections gracefully and provides consistent formatting
 * 
 * @param controller - ReadableStream controller (Uint8Array chunks)
 * @param encoder - TextEncoder instance
 * @param data - Data object to send as SSE event
 * @returns true if successful, false if stream was closed
 */
export function safeEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>, 
  encoder: TextEncoder, 
  data: Record<string, unknown>
): boolean {
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
    return true
  } catch (error) {
    if (error instanceof Error && 
        (error.message.includes('closed') || error.message.includes('controller'))) {
      console.log('Stream controller closed by client, stopping gracefully')
      return false
    }
    throw error
  }
}

/**
 * Send multiple SSE events safely, stopping on first failure
 * 
 * @param controller - ReadableStream controller (Uint8Array chunks)
 * @param encoder - TextEncoder instance
 * @param events - Array of data objects to send as SSE events
 * @returns true if all events sent successfully, false if stream closed
 */
export function safeBatchEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  events: Record<string, unknown>[]
): boolean {
  for (const event of events) {
    if (!safeEnqueue(controller, encoder, event)) {
      return false
    }
  }
  return true
}

/**
 * Helper to create standard SSE event objects
 */
export const sseEvents = {
  text: (content: string) => ({ type: 'text', content }),
  reasoning: (content: string) => ({ type: 'reasoning', content }),
  
  toolCall: (toolId: string, toolName: string, toolArgs: unknown) => ({
    type: 'tool_call',
    tool_id: toolId,
    tool_name: toolName,
    tool_args: toolArgs
  }),
  
  toolResult: (toolId: string, toolName: string, content: string, toolResult: unknown) => ({
    type: 'tool_result',
    tool_id: toolId,
    tool_name: toolName,
    content,
    tool_result: toolResult
  }),

  toolError: (toolId: string, toolName: string, errorMessage: string) => ({
    type: 'tool_error',
    tool_id: toolId,
    tool_name: toolName,
    error: errorMessage
  }),
  
  done: (usage: { input_tokens: number; output_tokens: number }) => ({
    type: 'done',
    usage
  }),
  
  /**
   * @param recoverable - When true, client should not throw: user was already notified (e.g. system_message).
   */
  error: (error: string, technicalDetails?: string, options?: { recoverable?: boolean }) => ({
    type: 'error',
    error,
    ...(technicalDetails && { technical_details: technicalDetails }),
    ...(options?.recoverable ? { recoverable: true } : {}),
  }),

  systemMessage: (content: string) => ({
    type: 'system_message',
    content
  }),

  toolStatus: (toolId: string, toolName: string, statusMessage: string) => ({
    type: 'tool_status',
    tool_id: toolId,
    tool_name: toolName,
    status_message: statusMessage
  })
}
