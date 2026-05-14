'use client'

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <button
      onClick={() => void logout()}
      className={compact
        ? 'rounded-2xl px-3 py-2 text-sm text-[var(--app-muted)] transition hover:bg-white hover:text-[var(--app-ink)]'
        : 'w-full rounded-2xl px-4 py-3 text-left text-sm text-[var(--app-muted)] transition hover:bg-white hover:text-[var(--app-ink)]'}
    >
      {compact ? 'Log Out' : 'Logout'}
    </button>
  )
}
