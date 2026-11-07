'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getLegalDocument } from '@/lib/api/legal-documents'
import type { LegalDocument } from '@/lib/api/legal-documents'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function TermsOfUsePage() {
  const [document, setDocument] = useState<LegalDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDocument() {
      try {
        const response = await getLegalDocument('terms_of_use')
        if (response.error) {
          setError(response.error)
        } else {
          setDocument(response.data)
        }
      } catch {
        setError('Failed to load terms of use')
      } finally {
        setLoading(false)
      }
    }

    fetchDocument()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-8">
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !document) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-8">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Unable to Load Terms of Use
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {error || 'Document not found'}
              </p>
              <Link 
                href="/signup"
                className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline"
              >
                ← Back to Sign Up
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-8">
          {/* Header */}
          <div className="mb-8">
            <Link 
              href="/signup"
              className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 text-sm font-medium mb-4 inline-block"
            >
              ← Back to Sign Up
            </Link>
          </div>

          {/* Content */}
          <div className="text-gray-900 dark:text-gray-100 space-y-6 text-sm leading-normal">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold mb-3 mt-4">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-medium mb-2 mt-3">{children}</h3>,
                h4: ({ children }) => <h4 className="text-base font-medium mb-2 mt-2">{children}</h4>,
                p: ({ children }) => <p className="mb-3">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 ml-6 mb-4">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 ml-6 mb-4">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                hr: () => <hr className="my-8 border-gray-300 dark:border-gray-600" />,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-4 italic text-gray-700 dark:text-gray-300">
                    {children}
                  </blockquote>
                ),
              }}
            >
              {document.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}