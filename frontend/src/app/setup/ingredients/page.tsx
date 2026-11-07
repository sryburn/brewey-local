'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import IngredientSetup from '@/components/settings/IngredientSetup'
import { themeUtils } from '@/lib/design-system'
export default function IngredientSetupPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!loading && !user) router.replace('/signin')
    else if (!loading && !user?.is_admin) router.replace('/')
  }, [loading, user, router])
  if (loading || !user?.is_admin) return <p role="status">Loading setup…</p>
  return <main className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6"><div className={`mx-auto max-w-xl p-6 ${themeUtils.card()}`}><IngredientSetup firstRun /></div></main>
}
