'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { getProfile, saveProfile as persistProfile } from '@/lib/api/profile'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import dynamic from 'next/dynamic'

// Types for user preferences
type UnitSystem = 'metric' | 'imperial'

// Dynamic import for the Milkdown editor to avoid SSR issues
const EditorSkeleton = () => (
  <div className="animate-pulse">
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      <div className="h-8 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-700 rounded-t-lg"></div>
      <div className="p-4 space-y-3">
        <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-3/4"></div>
        <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2"></div>
      </div>
    </div>
  </div>
)

const MilkdownEditor = dynamic(() => import('@/components/recipe/notes/MilkdownEditor'), {
  ssr: false,
  loading: () => <EditorSkeleton />
})

export default function ProfileSettingsForm() {
  const { user } = useAuth()
  return user ? <ProfileSettingsFormForAccount key={user.id} /> : null
}

function ProfileSettingsFormForAccount() {
  const { user } = useAuth()
  const [profile, setProfile] = useState('')
  const [isProfileFocused, setIsProfileFocused] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInfoExpanded, setIsInfoExpanded] = useState(false)
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('metric')
  const [unitSaving, setUnitSaving] = useState(false)
  const [unitSaved, setUnitSaved] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const identity = useRef(user?.id)
  useLayoutEffect(() => { identity.current = user?.id; return () => { identity.current = undefined } }, [user?.id])
  useEffect(() => {
    let active = true
    if (user?.id) void getProfile().then(({ data, error }) => {
      if (!active) return
      if (error) setError(error)
      setProfile(data?.profile || '')
      setUnitSystem(data?.unit_system || 'metric')
      setIsInfoExpanded(!data?.profile?.trim())
    })
    return () => { active = false; if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current) }
  }, [user?.id])

  const saveProfile = useCallback(async (newProfile: string, owner: string) => {
    if (identity.current !== owner) return
    setIsSaving(true)
    const { error } = await persistProfile({ profile: newProfile.trim() })
    if (identity.current !== owner) return
    setError(error); setIsSaved(!error); setIsSaving(false)
  }, [])
  const handleProfileChange = useCallback((newProfile: string) => {
    setProfile(newProfile); setIsSaved(false); setError(null)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    const owner = identity.current
    if (owner) saveTimeoutRef.current = setTimeout(() => { void saveProfile(newProfile, owner) }, 1000)
  }, [saveProfile])
  const handleUnitSystemChange = useCallback(async (next: UnitSystem) => {
    const owner = identity.current
    if (!owner) return
    const previous = unitSystem
    setUnitSystem(next); setUnitSaving(true); setUnitSaved(false)
    const { error } = await persistProfile({ unit_system: next })
    if (identity.current !== owner) return
    setError(error); setUnitSaving(false); setUnitSaved(!error)
    if (error) setUnitSystem(previous)
    else useRecipeStore.setState({ displayUnits: next })
  }, [unitSystem])

  if (!user) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* Unit System Preference */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Units
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Choose your preferred measurement system
        </p>
        
        <div className="flex items-center gap-4">
          <label className="flex items-center cursor-pointer">
            <input
              type="radio"
              name="unitSystem"
              value="metric"
              autoComplete="off"
              checked={unitSystem === 'metric'}
              onChange={() => handleUnitSystemChange('metric')}
              disabled={unitSaving}
              className="w-4 h-4 text-amber-600 border-gray-300 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700 cursor-pointer disabled:opacity-50"
            />
            <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Metric</span>
          </label>

          <label className="flex items-center cursor-pointer">
            <input
              type="radio"
              name="unitSystem"
              value="imperial"
              autoComplete="off"
              checked={unitSystem === 'imperial'}
              onChange={() => handleUnitSystemChange('imperial')}
              disabled={unitSaving}
              className="w-4 h-4 text-amber-600 border-gray-300 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700 cursor-pointer disabled:opacity-50"
            />
            <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">US</span>
          </label>
        </div>
        
        {unitSaving && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Saving...
          </div>
        )}
        {unitSaved && (
          <div className="mt-2 text-xs text-green-600 dark:text-green-400">
            Saved
          </div>
        )}
      </div>

      {/* Profile Editor */}
      <div>
        <div className={`mb-4 rounded-lg border ${(!profile || profile.trim().length === 0) ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
          <button
            onClick={() => setIsInfoExpanded(!isInfoExpanded)}
            className="w-full px-4 py-3 text-left flex items-center justify-between text-sm font-medium text-gray-900 dark:text-gray-100"
          >
            <span className="flex items-center">
              <svg className="w-4 h-4 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              This is your profile for Brewey
            </span>
            <svg
              className={`w-5 h-5 transform transition-transform ${isInfoExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isInfoExpanded && (
            <div className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-300 space-y-4">
              <p>
                Brewey has access to your profile in every chat and saves notes here when asked - eg &ldquo;update my profile with this information&rdquo;.
              </p>
              <p>
                Provide information such as your:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>name/nickname,</li>
                <li>brewing experience,</li>
                <li>brewing equipment,</li>
                <li>usual batch size(s),</li>
                <li>preferred or in stock ingredients,</li>
                <li>water profile information (ask Brewey if you need help),</li>
                <li>special instructions</li>
              </ul>
              <p className="mt-4">
                <strong>Tip:</strong> Ask Brewey to format your profile for improved performance.
              </p>
            </div>
          )}
        </div>
        
        <div className={`relative border rounded-lg bg-white dark:bg-stone-700 border-gray-300 dark:border-stone-600 ${isProfileFocused ? 'ring-2 ring-blue-500 dark:ring-amber-500 border-transparent' : ''} transition-colors`}>
          <MilkdownEditor
            key={`profile-${user?.id}`}
            value={profile}
            onChange={handleProfileChange}
            docVersion={user?.id}
            onEditorFocus={() => setIsProfileFocused(true)}
            onEditorBlur={() => setIsProfileFocused(false)}
            className="min-h-[120px] p-4 [&_.milkdown]:!border-0 [&_.milkdown]:!bg-transparent"
            hideLinkButton={true}
          />
          {(!profile || profile.trim().length === 0) && !isProfileFocused && (
            <div className="absolute left-4 top-3 md:top-12 text-sm text-gray-500 dark:text-gray-400 pointer-events-none select-none">
              Click to add your profile...
            </div>
          )}
        </div>

        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {isSaving ? 'Saving...' : (isSaved ? 'Saved' : '')}
        </div>

        {/* Success/Error Messages */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 p-4">
            <div className="text-sm text-red-700 dark:text-red-200">{error}</div>
          </div>
        )}
      </div>
    </div>
  )
}

