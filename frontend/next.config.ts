import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // A source build must never package local databases or operator credentials.
  outputFileTracingExcludes: {
    '/*': ['.runtime/**/*', '**/.runtime/**/*', '.env*', '**/.env*', '**/*.sqlite*', '**/*.db', '**/.codex/**/*'],
  },
  // Next 16.3's CLI config reader returns empty output for TypeScript 6 here.
  // Use the supported compiler API until the CLI integration is fixed.
  experimental: { useTypeScriptCli: false },

  // Remove X-Powered-By header to prevent information leakage
  poweredByHeader: false,

  // Security headers configuration
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          {
            // Content Security Policy (CSP) - protects against XSS and data injection attacks
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js scripts and development tooling
              "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for styled components
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'none'", // Prevents clickjacking (alternative to X-Frame-Options)
              "base-uri 'self'",
              "form-action 'self'",
              "frame-src 'none'",
              "object-src 'none'",
            ].join('; '),
          },
          {
            // X-Frame-Options - prevents clickjacking attacks
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            // X-Content-Type-Options - prevents MIME-sniffing
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            // Permissions-Policy - restricts browser features
            key: 'Permissions-Policy',
            value: [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'payment=()',
              'usb=()',
            ].join(', '),
          },
          {
            // Cross-Origin-Resource-Policy - protects against Spectre attacks
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin',
          },
          {
            // X-DNS-Prefetch-Control - controls DNS prefetching
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            // Referrer-Policy - controls referrer information
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Strict-Transport-Security (HSTS) - enforces HTTPS
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
