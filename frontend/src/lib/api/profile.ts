import { localApi } from './http'
export interface LocalProfile { id: string; profile: string; unit_system: 'metric' | 'imperial'; created_at: string; updated_at: string }
export function getProfile() { return localApi<LocalProfile>('/api/v1/profile') }
export function saveProfile(body: Partial<Pick<LocalProfile, 'profile' | 'unit_system'>>) { return localApi<LocalProfile>('/api/v1/profile', 'PATCH', body) }
