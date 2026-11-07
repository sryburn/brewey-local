import { act, renderHook } from '@testing-library/react'
import type { ChangeEvent } from 'react'
import { useFileUpload } from './useFileUpload'
import { processRecipeFile } from '@/lib/utils/file-processing'
import type { FileAttachment } from '@/types/attachments'

jest.mock('@/lib/utils/file-processing', () => ({
  processRecipeFile: jest.fn(),
  isNativeBreweyFormat: (content: string) => content === 'native',
}))
jest.mock('@/lib/debug', () => ({ debug: { log: jest.fn() } }))

const processFile = jest.mocked(processRecipeFile)
const attachment = (name: string, content = 'native'): FileAttachment => ({
  id: name, name, content, type: 'text', size: 10, mimeType: 'application/json',
})
function deferred() {
  let resolve!: (value: FileAttachment) => void
  let reject!: (error: Error) => void
  const promise = new Promise<FileAttachment>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function uploadEvent(name: string) {
  const target = { files: [new File(['recipe'], name)], value: name }
  return { target, event: { target } as unknown as ChangeEvent<HTMLInputElement> }
}

beforeEach(() => processFile.mockReset())

it('ignores a native file result after the input is unmounted', async () => {
  const read = deferred()
  processFile.mockReturnValueOnce(read.promise)
  const onNativeFileDetected = jest.fn()
  const { result, unmount } = renderHook(() => useFileUpload({ onNativeFileDetected }))
  act(() => { result.current.handleFileUpload(uploadEvent('old.brewey').event) })
  unmount()
  await act(async () => { read.resolve(attachment('old.brewey')); await read.promise })
  expect(onNativeFileDetected).not.toHaveBeenCalled()
})

it('removal cancels a pending native read without an import or restored attachment', async () => {
  const read = deferred()
  processFile.mockReturnValueOnce(read.promise)
  const onNativeFileDetected = jest.fn()
  const { result } = renderHook(() => useFileUpload({ onNativeFileDetected }))
  act(() => { result.current.handleFileUpload(uploadEvent('removed.brewey').event) })
  expect(result.current.isProcessingFile).toBe(true)
  act(() => { result.current.removeUploadedFile() })
  expect(result.current.isProcessingFile).toBe(false)
  await act(async () => { read.resolve(attachment('removed.brewey')); await read.promise })
  expect(onNativeFileDetected).not.toHaveBeenCalled()
  expect(result.current.uploadedFile).toBeNull()
  expect(result.current.fileError).toBeNull()
})

it('only invokes the latest native callback when overlapping reads finish out of order', async () => {
  const oldRead = deferred(), latestRead = deferred()
  processFile.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(latestRead.promise)
  const onNativeFileDetected = jest.fn()
  const { result } = renderHook(() => useFileUpload({ onNativeFileDetected }))
  act(() => { result.current.handleFileUpload(uploadEvent('old.brewey').event) })
  act(() => { result.current.handleFileUpload(uploadEvent('latest.brewey').event) })
  const latest = attachment('latest.brewey')
  await act(async () => { latestRead.resolve(latest); await latestRead.promise })
  await act(async () => { oldRead.resolve(attachment('old.brewey')); await oldRead.promise })
  expect(onNativeFileDetected).toHaveBeenCalledTimes(1)
  expect(onNativeFileDetected).toHaveBeenCalledWith(latest)
  expect(result.current.isProcessingFile).toBe(false)
})

it('a stale result cannot reset a newer input or end its loading state', async () => {
  const oldRead = deferred(), latestRead = deferred()
  processFile.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(latestRead.promise)
  const onNativeFileDetected = jest.fn()
  const { result } = renderHook(() => useFileUpload({ onNativeFileDetected }))
  const oldInput = uploadEvent('old.brewey'), latestInput = uploadEvent('latest.json')
  act(() => { result.current.handleFileUpload(oldInput.event) })
  act(() => { result.current.handleFileUpload(latestInput.event) })
  await act(async () => { oldRead.resolve(attachment('old.brewey')); await oldRead.promise })
  expect(onNativeFileDetected).not.toHaveBeenCalled()
  expect(result.current.isProcessingFile).toBe(true)
  expect(latestInput.target.value).toBe('latest.json')
  const latest = attachment('latest.json', 'other recipe format')
  await act(async () => { latestRead.resolve(latest); await latestRead.promise })
  expect(result.current.uploadedFile).toEqual(latest)
  expect(result.current.isProcessingFile).toBe(false)
  expect(latestInput.target.value).toBe('')
})

it('suppresses stale read errors after removal or a newer successful selection', async () => {
  const removedRead = deferred(), oldRead = deferred(), latestRead = deferred()
  processFile.mockReturnValueOnce(removedRead.promise).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(latestRead.promise)
  const { result } = renderHook(() => useFileUpload())
  act(() => { result.current.handleFileUpload(uploadEvent('removed.json').event) })
  act(() => { result.current.removeUploadedFile() })
  await act(async () => { removedRead.reject(new Error('Failed to read removed file')); await removedRead.promise.catch(() => {}) })
  expect(result.current.fileError).toBeNull()
  act(() => { result.current.handleFileUpload(uploadEvent('old.json').event) })
  act(() => { result.current.handleFileUpload(uploadEvent('latest.json').event) })
  const latest = attachment('latest.json', 'other recipe format')
  await act(async () => { latestRead.resolve(latest); await latestRead.promise })
  await act(async () => { oldRead.reject(new Error('Failed to read stale file')); await oldRead.promise.catch(() => {}) })
  expect(result.current.fileError).toBeNull()
  expect(result.current.uploadedFile).toEqual(latest)
  expect(result.current.isProcessingFile).toBe(false)
})
