'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useEffect, Suspense } from 'react'
import { User, MessageSquare, Key, AlertTriangle, UserCircle, DatabaseBackup } from 'lucide-react'
import { themeUtils } from '@/lib/design-system'
import AccountSettingsForm from '@/components/settings/AccountSettingsForm'
import ChatSettingsForm from '@/components/settings/ChatSettingsForm'
import ProfileSettingsForm from '@/components/settings/ProfileSettingsForm'
import UserManagementSection from '@/components/settings/UserManagementSection'
import AccountCancellation from '@/components/settings/AccountCancellation'
import IngredientSetup from '@/components/settings/IngredientSetup'
import BackupSettings from '@/components/settings/BackupSettings'
import { TokenManagementSection } from './tokens/components'

type TabId = 'account' | 'chat' | 'profile' | 'tokens' | 'users' | 'backup' | 'ingredients' | 'delete'

const VALID_TAB_IDS: TabId[] = ['account', 'chat', 'profile', 'tokens', 'users', 'backup', 'ingredients', 'delete']

function SettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading } = useAuth()

  const tabParam = searchParams.get('tab')
  const activeTab: TabId =
    tabParam && VALID_TAB_IDS.includes(tabParam as TabId)
      ? (tabParam as TabId)
      : 'account'

  const selectTab = (tab: TabId) => {
    router.replace(`/settings?tab=${tab}`)
  }
  
  const handleClose = () => {
    router.push('/')
  }

  const tabs = [
    { id: 'account' as TabId, label: 'Account', icon: User, shortLabel: 'Account' },
    { id: 'profile' as TabId, label: 'Profile', icon: UserCircle, shortLabel: 'Profile' },
    { id: 'chat' as TabId, label: 'Chat', icon: MessageSquare, shortLabel: 'Chat' },
    { id: 'tokens' as TabId, label: 'API Tokens', icon: Key, shortLabel: 'API' },
    ...(user?.is_admin ? [{ id: 'users' as TabId, label: 'Users', icon: User, shortLabel: 'Users' }] : []),
    ...(user?.is_admin ? [{ id: 'backup' as TabId, label: 'Backup', icon: DatabaseBackup, shortLabel: 'Backup' }] : []),
    ...(user?.is_admin ? [{ id: 'ingredients' as TabId, label: 'Ingredients', icon: DatabaseBackup, shortLabel: 'Ingredients' }] : []),
    { id: 'delete' as TabId, label: 'Delete Account', icon: AlertTriangle, shortLabel: 'Delete' },
  ]

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/')
    }
  }, [loading, user, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!user) {
    return null // Will redirect via useEffect
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className={themeUtils.card()}>
          {/* Header with close button */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
            <button 
              onClick={handleClose} 
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 rounded-lg p-1"
              aria-label="Close settings"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Tab Navigation */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="flex -mb-px overflow-x-auto" aria-label="Settings tabs">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    onClick={() => selectTab(tab.id)}
                    className={`
                      flex items-center justify-center space-x-1 md:space-x-2 py-3 md:py-4 px-2 md:px-4 border-b-2 font-medium text-xs md:text-sm whitespace-nowrap transition-colors flex-1
                      ${activeTab === tab.id
                        ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                      }
                    `}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {/* Avoid `hidden` + `sm:inline` (Tailwind v4 can leave labels stuck hidden after re-render) */}
                    <span className="max-sm:hidden">{tab.label}</span>
                    <span className="sm:hidden">{tab.shortLabel}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'ingredients' && user.is_admin && <IngredientSetup />}
            {activeTab === 'account' && <AccountSettingsForm />}
            
            {activeTab === 'chat' && <ChatSettingsForm />}
            
            {activeTab === 'profile' && <ProfileSettingsForm />}
            
            {activeTab === 'tokens' && <TokenManagementSection />}
            {activeTab === 'users' && <UserManagementSection />}
            {activeTab === 'backup' && <BackupSettings />}
            
            {activeTab === 'delete' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Delete Account
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Permanently remove your account and all associated data.
                  </p>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
                  <h4 className="text-base font-medium text-red-900 dark:text-red-100 mb-2">
                    Danger Zone
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                    Deleting your account will log you out and delete everything including all of your recipe data 😱
                    <br /><br />
                    The last administrator must create another administrator before deleting their account.
                  </p>
                  <AccountCancellation />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    }>
      <SettingsContent />
    </Suspense>
  )
}
