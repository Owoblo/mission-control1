'use client'

import { useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setLoading(true)
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Login failed')
      }

      window.location.href = searchParams.get('next') || '/sales'
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="crm-shell max-w-md">
      <div className="crm-label">Mission Control</div>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-900">Secure login.</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">Sales and inbox workflows are now protected behind an internal session.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block">
          <span className="crm-label">Password</span>
          <input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            className="crm-input mt-2"
          />
        </label>
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        <button disabled={loading} className="crm-button-dark w-full disabled:opacity-60">
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <Suspense fallback={<div className="crm-shell max-w-md"><div className="crm-panel p-10 text-center text-sm text-stone-500">Loading...</div></div>}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
