'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { observeSessionFailures, SESSION_REQUIRED, SESSION_RESTORED } from '@/lib/session-recovery'

export function SessionRecovery() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const stop = observeSessionFailures()
    const expired = () => setOpen(true)
    window.addEventListener(SESSION_REQUIRED, expired)
    return () => { stop(); window.removeEventListener(SESSION_REQUIRED, expired) }
  }, [])
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(email.trim() ? { email: email.trim() } : {}), password }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Sign in failed')
      setPassword(''); setOpen(false)
      window.dispatchEvent(new Event(SESSION_RESTORED))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign in failed') }
    finally { setBusy(false) }
  }
  if (!open) return null
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="session-title">
    <form onSubmit={login} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 text-slate-900 shadow-xl">
      <h2 id="session-title" className="text-xl font-semibold">Sign in to continue</h2>
      <p>Your session ended. Your open form is still here. After signing in, review it and submit again.</p>
      <label className="block">Email (optional for owner)<input autoFocus type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block">Password<input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button disabled={busy} className="w-full rounded bg-slate-900 p-2 text-white">{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>
}
