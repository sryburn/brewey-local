import { localApi } from './http'

export interface LegalDocument {
  id: string
  document_type: string
  version: string
  title: string
  effective_date: string
  last_updated: string
  content: string
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export function getLegalDocument(documentType: 'terms_of_use' | 'privacy_policy'): Promise<ApiResponse<LegalDocument>> {
  return localApi<LegalDocument>(`/api/legal/${documentType}`)
}
