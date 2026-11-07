import { useState, useEffect } from 'react'

export const useMobile = () => {
  const [isMobile, setIsMobile] = useState(() => 
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isMobile
}

export const usePointerType = () => {
  const [hasFinePointer, setHasFinePointer] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(pointer: fine)').matches ?? window.innerWidth >= 768
  })

  useEffect(() => {
    if (!window.matchMedia) return

    const mediaQuery = window.matchMedia('(pointer: fine)')
    const handleChange = () => setHasFinePointer(mediaQuery.matches)

    // Use the modern addEventListener method
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return hasFinePointer
} 