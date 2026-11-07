'use client'

import { useTheme } from 'next-themes'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

export default function ThemeUrlHandler() {
  const { setTheme } = useTheme()
  const searchParams = useSearchParams()
  
  useEffect(() => {
    const themeParam = searchParams?.get('theme')
    if (themeParam === 'dark' || themeParam === 'light') {
      setTheme(themeParam)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps
  
  // This component doesn't render anything
  return null
}
