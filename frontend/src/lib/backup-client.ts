function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = window.setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

export async function waitForRestart(signal: AbortSignal) {
  const deadline = Date.now() + 30_000
  // Give the old process time to stop before accepting a healthy response.
  await pause(2000, signal)
  while (!signal.aborted && Date.now() < deadline) {
    const probe = new AbortController()
    const abort = () => probe.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timeout = window.setTimeout(abort, Math.min(1000, deadline - Date.now()))
    try {
      const response = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin', signal: probe.signal })
      if (response.ok && !signal.aborted && !probe.signal.aborted && Date.now() < deadline) return true
    } catch { /* restarting servers can temporarily be unavailable */ }
    finally { window.clearTimeout(timeout); signal.removeEventListener('abort', abort) }
    await pause(Math.min(1000, Math.max(0, deadline - Date.now())), signal)
  }
  return false
}
