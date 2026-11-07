import { render, screen } from '@testing-library/react'
import AssistantMessage from './assistant-message'
import type { Message } from '@/types/chat'

jest.mock('react-markdown', () => ({ __esModule: true, default: ({ children }: { children: string }) => <div>{children}</div> }))
jest.mock('remark-gfm', () => ({ __esModule: true, default: jest.fn() }))

function message(content = '', metadata: Message['metadata'] = {}): Message {
  return { id: 'reply', type: 'assistant', content, timestamp: new Date(), metadata }
}

describe('thinking summary display', () => {
  it('opens a summary while waiting for an answer, including during tool use', () => {
    render(<AssistantMessage message={message('', { reasoningPreview: 'Checking fermentation timing', isStreaming: true, isExecutingTool: true })} />)
    expect(screen.getByText('Thinking summary').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Checking fermentation timing')).toBeInTheDocument()
  })

  it('retains a collapsed summary once the answer is complete', () => {
    render(<AssistantMessage message={message('Ferment at 12 C.', { reasoningPreview: 'Checking fermentation timing', isComplete: true })} />)
    expect(screen.getByText('Thinking summary').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('Ferment at 12 C.')).toBeInTheDocument()
    expect(screen.getByText('Checking fermentation timing')).toBeInTheDocument()
  })

  it('has no empty summary panel for replies without summaries', () => {
    render(<AssistantMessage message={message('Ferment at 12 C.')} />)
    expect(screen.queryByText('Thinking summary')).not.toBeInTheDocument()
  })
})
