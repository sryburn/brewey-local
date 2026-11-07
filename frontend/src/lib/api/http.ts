import type { ApiResponse } from '@/types/database'

export async function localApi<T>(path: string, method = 'GET', body?: unknown): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
    const result = response.status === 204 ? { data: null } : await response.json()
    if (!response.ok) return { data: null, error: result.error || 'Request failed' }
    return { data: result.data, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Request failed' }
  }
}
