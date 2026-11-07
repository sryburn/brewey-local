import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { UnitPreferencesProvider } from "@/lib/contexts/unit-preferences-context";
import { ThemeProvider } from "next-themes";
import { Suspense } from "react";
import ThemeUrlHandler from "@/components/theme-url-handler";


export const metadata: Metadata = {
  title: "Brewey - AI-Powered Beer Recipe Creator",
  description: "Create, customize, and perfect your beer recipes with AI assistance. Real-time brewing calculations and intelligent ingredient suggestions.",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  interactiveWidget: 'resizes-content', // Make dvh units account for on-screen keyboard
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider 
          attribute="class" 
          defaultTheme="dark"
          disableTransitionOnChange
        >
          <Suspense fallback={null}>
            <ThemeUrlHandler />
          </Suspense>
          <AuthProvider>
            <UnitPreferencesProvider>
              {children}
            </UnitPreferencesProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
