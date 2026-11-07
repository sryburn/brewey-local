/** Text attachment used by recipe import and the chat composer. */
export interface FileAttachment {
  id: string
  name: string
  type: 'text'
  size: number
  content: string
  mimeType: string
}
