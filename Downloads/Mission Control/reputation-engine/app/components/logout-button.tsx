'use client'

export function LogoutButton() {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <button onClick={() => void logout()} className="w-full rounded-2xl px-4 py-3 text-left text-sm text-[var(--app-muted)] transition hover:bg-white hover:text-[var(--app-ink)]">
      Logout
    </button>
  )
}
