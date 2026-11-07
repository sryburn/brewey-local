import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import IngredientSetup from './IngredientSetup'
const status = { state: 'idle', updatedAt: 0, counts: { grains: 0 }, completed: 0, total: 0, missing: [] }
const reply = (value: unknown) => Promise.resolve({ ok: true, json: async () => value } as Response)
beforeEach(() => { global.fetch = jest.fn().mockImplementation(() => reply(status)) })
test('download progresses to a partial catalogue with an explicit continue choice', async () => {
  render(<IngredientSetup firstRun />)
  await screen.findByRole('button', { name: 'Download ingredients' })
  const running = { ...status, state: 'running', completed: 1, total: 2 }
  jest.mocked(fetch).mockImplementation((_url, options) => reply(options?.method === 'POST' ? running : { ...status, state: 'partial', counts: { yeasts: 25 }, missing: ['Unavailable source'], completed: 2, total: 2 }))
  fireEvent.click(screen.getByRole('button', { name: 'Download ingredients' }))
  expect(await screen.findByRole('link', { name: 'Continue with available ingredients' })).toHaveAttribute('href', '/')
  expect(screen.getByText('Unavailable source')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry downloads' })).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledWith('/api/admin/ingredients', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }))
})
test('an active download displays progress and cannot start another or continue early', async () => {
  jest.mocked(fetch).mockImplementation(() => reply({ ...status, state: 'running', completed: 3, total: 10 }))
  const { unmount } = render(<IngredientSetup firstRun />)
  expect(await screen.findByRole('progressbar')).toHaveAttribute('value', '3')
  expect(screen.queryByRole('button', { name: /Download|Retry/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Continue/ })).not.toBeInTheDocument()
  unmount()
})
test('interrupted downloads can be retried and a complete catalogue can be used', async () => {
  jest.mocked(fetch).mockImplementation(() => reply({ ...status, state: 'failed', error: 'Interrupted download' }))
  render(<IngredientSetup firstRun />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Interrupted download')
  jest.mocked(fetch).mockImplementation(() => reply({ ...status, state: 'ready', counts: { grains: 12 } }))
  fireEvent.click(screen.getByRole('button', { name: 'Retry downloads' }))
  await waitFor(() => expect(screen.getByRole('link', { name: 'Continue to Brewey' })).toBeInTheDocument())
})
