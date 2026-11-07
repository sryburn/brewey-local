'use client'

import { Suspense } from 'react'
import AuthForm from '@/components/auth/auth-form'

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm initialMode="signin" />
    </Suspense>
  )
}

