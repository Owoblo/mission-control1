'use client'

import { useState } from 'react'

export function ChangePasswordButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function reset() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(null)
  }

  async function submit() {
    setError(null)
    setSuccess(null)
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok || data.error) throw new Error(data.error || 'Could not change password.')
      setSuccess('Password updated.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset()
          setOpen(true)
        }}
        className={compact
          ? 'rounded-2xl px-3 py-2 text-sm text-[var(--app-muted)] transition hover:bg-white hover:text-[var(--app-ink)]'
          : 'w-full rounded-2xl px-4 py-3 text-left text-sm text-[var(--app-muted)] transition hover:bg-white hover:text-[var(--app-ink)]'}
      >
        Change Password
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/35 p-0 md:items-center md:p-4">
          <div className="w-full rounded-t-[14px] border border-[var(--app-line)] bg-white shadow-2xl md:max-w-md md:rounded-[12px]">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-5 py-4">
              <div>
                <div className="text-sm font-bold text-[var(--app-ink)]">Change Password</div>
                <div className="mt-0.5 text-xs text-[var(--app-muted)]">Use a password Rahin can remember but others cannot guess.</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-[var(--app-muted)] hover:bg-[var(--app-bg)]"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 px-5 py-5">
              <input
                type="password"
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
                className="crm-input"
                placeholder="Current password"
                autoComplete="current-password"
              />
              <input
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                className="crm-input"
                placeholder="New password"
                autoComplete="new-password"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                className="crm-input"
                placeholder="Confirm new password"
                autoComplete="new-password"
              />

              {error ? (
                <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>
              ) : null}
              {success ? (
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{success}</div>
              ) : null}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !currentPassword || !newPassword || !confirmPassword}
                className="crm-button-dark w-full justify-center text-sm disabled:opacity-50"
              >
                {busy ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
