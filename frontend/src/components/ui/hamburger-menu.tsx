'use client'

import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { responsiveUtils } from '@/lib/design-system'
import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

interface HamburgerMenuProps {
  isOpen: boolean
  onClose: () => void
  onSignOut: () => void
}

export default function HamburgerMenu({ isOpen, onClose, onSignOut }: HamburgerMenuProps) {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
  const handleDarkModeToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const handleSettingsClick = () => {
    router.push('/settings')
    onClose()
  }

  const handleSignOut = () => {
    onSignOut()
    onClose()
  }

  return (
    <>
      {/* Backdrop - Transparent for click handling */}
      <div 
        className={`fixed inset-0 transition-opacity duration-300 z-40 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Slide-out Menu */}
      <div 
        className={`fixed top-0 right-0 h-full w-72 bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-xl transform transition-transform duration-300 ease-in-out z-50 flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Menu Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Menu
          </h2>
          <button
            onClick={onClose}
            className={`${responsiveUtils.mobile.sizing.touchTarget} ${responsiveUtils.mobile.interactions.touchHover} ${responsiveUtils.mobile.interactions.tapTarget} rounded-lg flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-amber-500`}
            aria-label="Close menu"
          >
            <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Menu Items */}
        <div className="p-4 space-y-2">
          {/* Dark Mode Toggle Menu Item */}
          <button
            onClick={handleDarkModeToggle}
            className={`${responsiveUtils.mobile.interactions.touchHover} ${responsiveUtils.mobile.interactions.tapTarget} w-full flex items-center space-x-3 p-3 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500`}
          >
            {/* Beer Glass Icon */}
            <div className="flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="transition-all duration-200">
                {/* Beer liquid - shows what you can switch TO */}
                <path 
                  d="M8 6v11c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V6H8z" 
                  className="transition-colors duration-200 fill-amber-900 dark:fill-amber-400"
                />
                
                {/* Beer foam on top */}
                <ellipse 
                  cx="12" 
                  cy="6" 
                  rx="4" 
                  ry="1" 
                  fill="#f9fafb"
                />
                
                {/* Simple handle */}
                <path 
                  d="M16 9h1c.55 0 1 .45 1 1v2c0 .55-.45 1-1 1h-1" 
                  fill="#d1d5db"
                />
              </svg>
            </div>
            
            {/* Label */}
            <span className="text-left text-gray-900 dark:text-gray-100">
              {mounted && theme === 'dark' ? 'Toggle Light Mode' : 'Toggle Dark Mode'}
            </span>
          </button>

          {/* Settings Menu Item */}
          <button
            onClick={handleSettingsClick}
            className={`${responsiveUtils.mobile.interactions.touchHover} ${responsiveUtils.mobile.interactions.tapTarget} w-full flex items-center space-x-3 p-3 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500`}
          >
            {/* Settings Icon */}
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            
            {/* Label */}
            <span className="text-left text-gray-900 dark:text-gray-100">
              Settings
            </span>
          </button>



          {/* Sign Out Menu Item */}
          <button
            onClick={handleSignOut}
            className={`${responsiveUtils.mobile.interactions.touchHover} ${responsiveUtils.mobile.interactions.tapTarget} w-full flex items-center space-x-3 p-3 rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500 text-red-600 dark:text-red-400`}
          >
            {/* Sign Out Icon */}
            <div className="flex-shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            
            {/* Label */}
            <span className="text-left">
              Sign Out
            </span>
          </button>
        </div>

      </div>
    </>
  )
}
