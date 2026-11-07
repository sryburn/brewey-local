// Mock LLM API for testing
export const mockLLMResponse = {
  content: [{ text: 'Mock AI response about beer brewing!' }],
  usage: {
    input_tokens: 10,
    output_tokens: 20
  }
}

// Mock streaming response
export const createMockStreamingResponse = (responses: string[]) => {
  return {
    async *[Symbol.asyncIterator]() {
      // Start chunk
      yield {
        type: 'content_block_start',
        content_block: {
          type: 'text',
          text: ''
        }
      }
      
      // Text chunks
      for (const response of responses) {
        yield {
          type: 'content_block_delta',
          delta: {
            text: response
          }
        }
      }
      
      // End chunk
      yield {
        type: 'message_stop',
        usage: {
          input_tokens: 10,
          output_tokens: responses.join('').length
        }
      }
    }
  }
}

// Mock fetch for API routes with a simulated ReadableStream
export const mockFetchStreamingResponse = (responses: string[]) => {
  // Create a mock ReadableStream-like object
  const mockStream = {
    getReader: () => ({
      read: (() => {
        let index = 0
        const allResponses = [
          ...responses.map(text => `data: ${JSON.stringify({ type: 'text', content: text })}\n\n`),
          `data: ${JSON.stringify({ type: 'done', usage: { input_tokens: 10, output_tokens: 20 } })}\n\n`
        ]
        
        return async () => {
          if (index >= allResponses.length) {
            return { done: true, value: undefined }
          }
          
          const encoder = new TextEncoder()
          const value = encoder.encode(allResponses[index])
          index++
          
          return { done: false, value }
        }
      })()
    })
  }
  
  return Promise.resolve({
    ok: true,
    status: 200,
    body: mockStream,
    json: () => Promise.resolve({ message: 'Success' })
  })
}