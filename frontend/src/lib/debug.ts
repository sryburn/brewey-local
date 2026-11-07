/**
 * Debug utility that logs in development or when explicitly enabled in production
 * Set NEXT_PUBLIC_ENABLE_DEBUG=true to enable debug logs in production
 */

const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';
const isDebugEnabled = process.env.NEXT_PUBLIC_ENABLE_DEBUG === 'true';
const shouldLog = (isDevelopment || isDebugEnabled) && !isTest;

export const debug = {
  log: (...args: unknown[]) => {
    if (shouldLog) {
      console.log(...args);
    }
  },
  warn: (...args: unknown[]) => {
    if (shouldLog) {
      console.warn(...args);
    }
  },
  error: (...args: unknown[]) => {
    if (shouldLog) {
      console.error(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (shouldLog) {
      console.info(...args);
    }
  },
  debug: (...args: unknown[]) => {
    if (shouldLog) {
      console.debug(...args);
    }
  }
}; 