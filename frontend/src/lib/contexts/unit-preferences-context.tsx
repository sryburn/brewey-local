'use client'

import { createContext, useContext, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import type { UnitSystem } from '@/lib/utils/unit-conversion'
import { getUnitSystemLabel } from '@/lib/utils/unit-conversion'

interface UnitPreferencesContextType {
  unitSystem: UnitSystem
  unitLabel: string
}

const UnitPreferencesContext = createContext<UnitPreferencesContextType | undefined>(undefined)

export function UnitPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const displayUnits = useRecipeStore((state) => state.displayUnits)
  const loadUserPreferences = useRecipeStore((state) => state.loadUserPreferences)
  
  // Load user preferences when user logs in
  useEffect(() => {
    if (user?.id) {
      loadUserPreferences(user.id)
    }
  }, [user?.id, loadUserPreferences])
  
  const unitLabel = getUnitSystemLabel(displayUnits)
  
  return (
    <UnitPreferencesContext.Provider value={{ unitSystem: displayUnits, unitLabel }}>
      {children}
    </UnitPreferencesContext.Provider>
  )
}

export function useUnitPreference() {
  const context = useContext(UnitPreferencesContext)
  if (context === undefined) {
    throw new Error('useUnitPreference must be used within a UnitPreferencesProvider')
  }
  return context
}

