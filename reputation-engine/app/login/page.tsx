'use client'

import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function safeNextPath(value: string | null) {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return null
    try {
      const parsed = new URL(value, window.location.origin)
      return parsed.origin === window.location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null
    } catch {
      return null
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setLoading(true)
      setError(null)
      const body = email.trim()
        ? { email: email.trim(), password }
        : { password }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Login failed')
      }

      const role = payload?.role as string | undefined
      const next = safeNextPath(searchParams.get('next'))
      if (next) {
        window.location.href = next
      } else if (role === 'crew') {
        window.location.href = '/crew/calendar'
      } else if (role === 'operations_lead') {
        window.location.href = '/sales/operations'
      } else {
        window.location.href = '/sales'
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-8 shadow-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <Image src="/saturn-star-logo.png" alt="Saturn Star Moving" width={96} height={96} priority />
          <div className="text-center">
            <div className="font-semibold text-[var(--app-ink)]">Saturn Star OS</div>
            <div className="text-xs text-[var(--app-muted)]">Mission Control</div>
          </div>
        </div>

        <h1 className="mb-1 text-xl font-semibold text-[var(--app-ink)]">Sign in</h1>
        <p className="mb-6 text-sm text-[var(--app-muted)]">Enter your credentials to access the platform.</p>

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">
              Email <span className="normal-case font-normal text-[var(--app-muted)]">(optional for owner)</span>
            </span>
            <input
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="name@company.com"
              className="crm-input"
              autoComplete="email"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--app-muted)] uppercase tracking-wide">Password</span>
            <input
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
              className="crm-input"
              autoComplete="current-password"
            />
          </label>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            disabled={loading}
            className="crm-button-dark w-full disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--app-muted)]">
        Saturn Star Moving — Internal Platform
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <Suspense fallback={
        <div className="w-full max-w-sm rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-8 text-center text-sm text-[var(--app-muted)]">
          Loading...
        </div>
      }>
        <LoginForm />
      </Suspense>
    </div>
  )
}
