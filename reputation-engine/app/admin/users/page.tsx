'use client'

import { useEffect, useState } from 'react'
import type { UserRole } from '@/lib/auth'

interface AppUser {
  id: string
  email: string
  name: string
  role: UserRole
  branch?: string
  created_at: string
}

const BRANCH_LABELS: Record<string, string> = {
  windsor: 'Windsor',
  waterloo: 'Waterloo / KW',
  london: 'London',
  ottawa: 'Ottawa',
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  manager: 'Manager',
  sales_rep: 'Sales Rep',
  partnership_manager: 'Partnership Manager',
  operations_lead: 'Operations Lead',
  crew: 'Crew',
}

const ROLE_COLORS: Record<UserRole, string> = {
  owner: 'bg-[#1a2744] text-white',
  manager: 'bg-sky-100 text-sky-800',
  sales_rep: 'bg-emerald-100 text-emerald-800',
  partnership_manager: 'bg-teal-100 text-teal-800',
  operations_lead: 'bg-orange-100 text-orange-800',
  crew: 'bg-amber-100 text-amber-800',
}

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: 'Full access — CRM, operations, financials, settings',
  manager: 'CRM + operations, assign crew, no financials',
  sales_rep: 'Pipeline, leads, dialer, quotes only',
  partnership_manager: 'Partnership CRM, partner SMS, partner dialer, tasks, and appointments only',
  operations_lead: 'Operations calendar only — sees booked jobs, assigns crew for their branch',
  crew: 'Crew calendar — sees their assigned jobs only',
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<AppUser | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'sales_rep' as UserRole, password: '', branch: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/users', { credentials: 'include' })
    if (r.ok) setUsers(await r.json())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function openAdd() {
    setForm({ name: '', email: '', role: 'sales_rep', password: '', branch: '' })
    setError(null)
    setAddOpen(true)
    setEditUser(null)
  }

  function openEdit(u: AppUser) {
    setForm({ name: u.name, email: u.email, role: u.role, password: '', branch: u.branch || '' })
    setError(null)
    setEditUser(u)
    setAddOpen(true)
  }

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      if (editUser) {
        const updates: Record<string, string> = { id: editUser.id, name: form.name, role: form.role, branch: form.branch }
        if (form.password) updates.password = form.password
        const r = await fetch('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updates),
        })
        if (!r.ok) throw new Error((await r.json()).error)
        setSuccess(`${form.name} updated.`)
      } else {
        if (!form.password) throw new Error('Password is required for new users')
        const r = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(form),
        })
        if (!r.ok) throw new Error((await r.json()).error)
        setSuccess(`${form.name} added to the team.`)
      }
      setAddOpen(false)
      setEditUser(null)
      void load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(u: AppUser) {
    if (!window.confirm(`Remove ${u.name} from the team? They will no longer be able to log in.`)) return
    const r = await fetch(`/api/admin/users?id=${u.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (r.ok) {
      setSuccess(`${u.name} removed.`)
      void load()
    }
  }

  return (
    <div className="crm-shell space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1a2744]">Team Access</h1>
          <p className="mt-1 text-sm text-slate-500">Manage who can log in and what they can see.</p>
        </div>
        <button onClick={openAdd} className="crm-button-dark text-sm">+ Add Team Member</button>
      </div>

      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-700 flex justify-between">
          {success}
          <button onClick={() => setSuccess(null)} className="ml-4 text-emerald-400 hover:text-emerald-600">✕</button>
        </div>
      )}

      {/* Role guide */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(Object.keys(ROLE_LABELS) as UserRole[]).map(role => (
          <div key={role} className="rounded-xl border border-slate-100 bg-white p-4">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${ROLE_COLORS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
            <p className="mt-2 text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
          </div>
        ))}
      </div>

      {/* Users list */}
      {loading ? (
        <div className="crm-panel p-12 text-center text-sm text-slate-400">Loading team...</div>
      ) : (
        <div className="crm-panel divide-y divide-slate-100">
          {users.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              No team members yet. Add your first team member above.
            </div>
          ) : users.map(u => (
            <div key={u.id} className="flex items-center gap-4 px-5 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a2744] text-sm font-bold text-[#f5a623]">
                {u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#1a2744]">{u.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ROLE_COLORS[u.role]}`}>
                    {ROLE_LABELS[u.role]}
                  </span>
                  {u.branch && (
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                      {BRANCH_LABELS[u.branch] || u.branch}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400">{u.email}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => openEdit(u)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  Edit
                </button>
                <button
                  onClick={() => void remove(u)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit modal */}
      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,27,56,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={e => { if (e.target === e.currentTarget) { setAddOpen(false); setEditUser(null) } }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-[#1a2744] px-6 py-5" style={{ borderBottom: '2px solid #f5a623' }}>
              <h2 className="text-base font-bold text-white">
                {editUser ? `Edit ${editUser.name}` : 'Add Team Member'}
              </h2>
              <p className="mt-0.5 text-xs text-white/60">
                {editUser ? 'Update role or reset password.' : 'They\'ll use their email + password to sign in.'}
              </p>
            </div>

            <div className="p-6 space-y-4">
              <label className="block">
                <span className="crm-label">Full Name</span>
                <input
                  className="crm-input mt-1"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Marcus Johnson"
                />
              </label>

              <label className="block">
                <span className="crm-label">Email</span>
                <input
                  className="crm-input mt-1"
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="marcus@company.com"
                  disabled={!!editUser}
                />
              </label>

              <label className="block">
                <span className="crm-label">Role</span>
                <select
                  className="crm-input mt-1"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as UserRole }))}
                >
                  <option value="sales_rep">Sales Rep — CRM + dialer</option>
                  <option value="partnership_manager">Partnership Manager — partner CRM only</option>
                  <option value="crew">Crew — Job calendar only</option>
                  <option value="operations_lead">Operations Lead — Jobs calendar, crew assignment</option>
                  <option value="manager">Manager — CRM + operations</option>
                  <option value="owner">Owner — Full access</option>
                </select>
              </label>

              {(form.role === 'partnership_manager' || form.role === 'operations_lead' || form.role === 'crew') && (
                <label className="block">
                  <span className="crm-label">Branch <span className="font-normal text-slate-400">(which market this person manages)</span></span>
                  <select
                    className="crm-input mt-1"
                    value={form.branch}
                    onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
                  >
                    <option value="">All branches</option>
                    <option value="windsor">Windsor</option>
                    <option value="waterloo">Waterloo / KW</option>
                    <option value="london">London</option>
                    <option value="ottawa">Ottawa</option>
                  </select>
                </label>
              )}

              <label className="block">
                <span className="crm-label">Password {editUser && <span className="font-normal text-slate-400">(leave blank to keep current)</span>}</span>
                <input
                  className="crm-input mt-1"
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? 'New password (optional)' : 'Set a strong password'}
                />
              </label>

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setAddOpen(false); setEditUser(null) }}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy || !form.name || (!editUser && !form.email)}
                  className="flex-1 rounded-xl bg-[#1a2744] px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition disabled:opacity-60"
                >
                  {busy ? 'Saving...' : editUser ? 'Save Changes' : 'Add to Team'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
