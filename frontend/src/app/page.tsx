'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import ChatPanel from '@/components/chat/chat-panel'
import RecipePanel from '@/components/recipe/recipe-panel'
import { useChatActions } from '@/lib/stores/chat-store'
import { useRecipeStore } from '@/lib/stores/recipe-store'
import MobileHeader from '@/components/ui/mobile-header'
import HamburgerMenu from '@/components/ui/hamburger-menu'
import { responsiveUtils } from '@/lib/design-system'
import { useMobile } from '@/lib/hooks/useMobile'

export default function Home() {
  const isMobile = useMobile()
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const { setCurrentRecipeContext } = useChatActions()
  const { setSelectedRecipe, setMobileExpanded, loadUserRecipes, loadUserPreferences, selectedRecipeId: storeSelectedRecipeId, userRecipes: storeUserRecipes } = useRecipeStore()
  
  // Mobile menu state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  // Mobile recipe panel state  
  const [isMobileRecipeExpanded, setIsMobileRecipeExpanded] = useState(false)
  
  const userRecipes = useMemo(
    () => storeUserRecipes.map((r) => ({ id: r.id, name: r.name })),
    [storeUserRecipes],
  )
  const selectedRecipeId = storeSelectedRecipeId ?? ''

  // Load user recipes and preferences when user becomes available
  useEffect(() => {
    if (user?.id) {
      loadUserRecipes(user.id)
      loadUserPreferences(user.id)
    }
  }, [user?.id, loadUserRecipes, loadUserPreferences])

  // The current recipe is a preview, never an association that changes saved chat.
  useEffect(() => {
    setCurrentRecipeContext(storeSelectedRecipeId)
  }, [storeSelectedRecipeId, setCurrentRecipeContext])

  // Mobile menu handlers
  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(prev => !prev)
  }

  const handleMobileMenuClose = () => {
    setIsMobileMenuOpen(false)
  }

  const handleMobileRecipeCollapse = () => {
    setMobileExpanded(false)
    setIsMobileRecipeExpanded(false)
  }

  const handleRecipeUpdate = useCallback((recipeId: string) => {
    // Recipe selection changes the preview independently of the current chat.
    setCurrentRecipeContext(recipeId)
    // Set the selected recipe - store will handle loading automatically
    setSelectedRecipe(recipeId)
  }, [setCurrentRecipeContext, setSelectedRecipe])

  // Handler for mobile header recipe changes
  const handleMobileRecipeChange = useCallback((recipeId: string) => {
    handleRecipeUpdate(recipeId)
  }, [handleRecipeUpdate])

  // Redirect to signin if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/signin')
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
    <div 
      className="flex flex-col bg-gray-50 dark:bg-gray-900 pwa-main-container"
      style={{
        // Use small viewport height for reliable mobile compatibility
        // Falls back to 100vh in older browsers automatically
        height: '100svh'
      }}
    >
      {/* Desktop Header - Hidden on Mobile */}
      <div className={`${responsiveUtils.mobile.visibility.hideOnMobileBlock} flex-shrink-0 px-6 border-b bg-white border-gray-200 dark:bg-gray-950 dark:border-gray-800`}>
        <div className="flex items-center justify-between h-[80px]">
          <div className="h-full">
            <Image
              src="/brewey-logo-light.webp"
              alt="Brewey Logo"
              height={80}
              width={240}
              className="object-contain h-full w-auto transition-all duration-200 dark:hidden"
              priority
            />
            <Image
              src="/brewey-logo-dark.webp"
              alt="Brewey Logo"
              height={80}
              width={240}
              className="object-contain transition-all duration-200 hidden dark:block"
              style={{ height: '100%' }}
              priority
            />
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Hamburger Menu Button - Desktop */}
            <button
              onClick={handleMobileMenuToggle}
              className="rounded-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors duration-200 p-2 text-gray-600 hover:text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:text-gray-200 dark:hover:bg-gray-800"
              aria-label="Toggle menu"
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? (
                /* X Icon when menu is open */
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                /* Hamburger Icon when menu is closed */
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M0 6h24M0 12h24M0 18h24" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Header - Render only when viewport is mobile */}
      {isMobile && (
        <MobileHeader 
          onMenuToggle={handleMobileMenuToggle}
          isMenuOpen={isMobileMenuOpen}
          selectedRecipeId={selectedRecipeId || ''}
          userRecipes={userRecipes}
          onRecipeChange={handleMobileRecipeChange}
        />
      )}

      {/* Hamburger Menu - Desktop and Mobile */}
      <HamburgerMenu 
        isOpen={isMobileMenuOpen}
        onClose={handleMobileMenuClose}
        onSignOut={signOut}
      />



      {/* Main Content - Responsive Layout */}
      <div className={`${responsiveUtils.mobile.layout.dualToSingle} flex-1 overflow-hidden relative min-h-0`}>
        {/* Recipe Panel - Top on Mobile, Right on Desktop - Hidden on mobile when no recipes */}
        {(!isMobile || userRecipes.length > 0) && (
          <div className={`${responsiveUtils.mobile.layout.halfWidth} md:order-last flex-shrink-0 md:flex-1`}>
            <RecipePanel 
              onRecipeSelected={handleRecipeUpdate}
            />
          </div>
        )}

        {/* Chat Panel - Bottom on Mobile, Left on Desktop - Full height on mobile when no recipes */}
        <div className={`${isMobile && userRecipes.length === 0 ? 'h-full' : responsiveUtils.mobile.layout.halfWidth} chat-panel-bg md:order-first flex-1 min-h-0`}>
          <ChatPanel 
            onRecipeUpdate={(recipeId) => { setCurrentRecipeContext(recipeId); setSelectedRecipe(recipeId) }}
            onMobileRecipeCollapse={handleMobileRecipeCollapse}
            isMobileRecipeExpanded={isMobileRecipeExpanded}
          />
        </div>
      </div>
    </div>
  )
}
