'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchWorkers, saveWorker, updateWorker, removeWorker } from '@/lib/sales-api'
import type { CRMWorker, WorkerCity, WorkerRole } from '@/lib/types'

const CITIES: { id: WorkerCity; label: string }[] = [
  { id: 'kitchener', label: 'Kitchener / Waterloo' },
  { id: 'windsor', label: 'Windsor' },
  { id: 'toronto', label: 'Toronto / GTA' },
  { id: 'hamilton', label: 'Hamilton' },
  { id: 'ottawa', label: 'Ottawa' },
  { id: 'london', label: 'London' },
  { id: 'other', label: 'Other' },
]

const ROLES: { id: WorkerRole; label: string }[] = [
  { id: 'lead', label: 'Crew Lead' },
  { id: 'driver', label: 'Driver' },
  { id: 'mover', label: 'Mover' },
  { id: 'packer', label: 'Packer' },
]

const CITY_LABELS: Record<WorkerCity, string> = {
  kitchener: 'KW',
  windsor: 'Windsor',
  toronto: 'Toronto',
  hamilton: 'Hamilton',
  ottawa: 'Ottawa',
  london: 'London',
  other: 'Other',
}

const ROLE_COLORS: Record<WorkerRole, string> = {
  lead: 'bg-indigo-100 text-indigo-700',
  driver: 'bg-blue-100 text-blue-700',
  mover: 'bg-emerald-100 text-emerald-700',
  packer: 'bg-amber-100 text-amber-700',
}

type FormState = {
  name: string
  phone: string
  city: WorkerCity
  role: WorkerRole
  notes: string
}

const EMPTY_FORM: FormState = { name: '', phone: '', city: 'kitchener', role: 'mover', notes: '' }

export default function CrewWorkersPage() {
  const [workers, setWorkers] = useState<CRMWorker[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCity, setFilterCity] = useState<WorkerCity | 'all'>('all')

  // Add / edit form
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetchWorkers()
      .then(setWorkers)
      .catch(() => setWorkers([]))
      .finally(() => setLoading(false))
  }, [])

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  function openEdit(w: CRMWorker) {
    setEditingId(w.id)
    setForm({ name: w.name, phone: w.phone, city: w.city, role: w.role, notes: w.notes || '' })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone are required.')
      return
    }
    try {
      setSaving(true)
      setError(null)
      if (editingId) {
        const updated = await updateWorker(editingId, form)
        setWorkers(ws => ws.map(w => w.id === editingId ? updated : w))
      } else {
        const created = await saveWorker(form)
        setWorkers(ws => [created, ...ws])
      }
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleAvailable(w: CRMWorker) {
    try {
      const updated = await updateWorker(w.id, { available: !w.available })
      setWorkers(ws => ws.map(x => x.id === w.id ? updated : x))
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await removeWorker(id)
      setWorkers(ws => ws.filter(w => w.id !== id))
      setDeletingId(null)
    } catch { /* ignore */ }
  }

  const filtered = filterCity === 'all' ? workers : workers.filter(w => w.city === filterCity)
  const grouped = CITIES.reduce<Record<string, CRMWorker[]>>((acc, c) => {
    acc[c.id] = filtered.filter(w => w.city === c.id)
    return acc
  }, {} as Record<string, CRMWorker[]>)

  return (
    <div className="min-h-screen bg-[var(--app-bg)]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3 md:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/crew/calendar" className="text-sm text-[var(--app-muted)] hover:text-[var(--app-ink)]">← Calendar</Link>
            <span className="text-[var(--app-line)]">|</span>
            <h1 className="text-base font-semibold text-[var(--app-ink)]">Crew Roster</h1>
            <span className="rounded-full bg-[var(--app-accent)] bg-opacity-10 px-2 py-0.5 text-xs font-semibold text-[var(--app-accent)]">
              {workers.filter(w => w.available).length} available
            </span>
          </div>
          <button
            onClick={openAdd}
            className="rounded-[8px] bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0a5b47]"
          >
            + Add Worker
          </button>
        </div>

        {/* City filter tabs */}
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {[{ id: 'all' as const, label: 'All Cities' }, ...CITIES].map(c => (
            <button
              key={c.id}
              onClick={() => setFilterCity(c.id as WorkerCity | 'all')}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                filterCity === c.id
                  ? 'bg-[var(--app-accent)] text-white'
                  : 'bg-[var(--app-line)] text-[var(--app-muted)] hover:bg-[var(--app-accent)] hover:bg-opacity-10'
              }`}
            >
              {c.label}
              {c.id !== 'all' && (
                <span className="ml-1 opacity-70">({workers.filter(w => w.city === c.id).length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--app-muted)]">Loading roster…</div>
        ) : workers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--app-line)] bg-[var(--app-panel)] py-16 text-center">
            <div className="text-2xl mb-2">👷</div>
            <div className="font-semibold text-[var(--app-ink)]">No workers yet</div>
            <p className="mt-1 text-sm text-[var(--app-muted)]">Add your first crew member to get started.</p>
            <button onClick={openAdd} className="mt-4 rounded-[8px] bg-[var(--app-accent)] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0a5b47]">
              Add Worker
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {CITIES.filter(c => filterCity === 'all' || filterCity === c.id).map(city => {
              const cityWorkers = grouped[city.id] || []
              if (cityWorkers.length === 0) return null
              return (
                <div key={city.id}>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--app-muted)]">{city.label}</h2>
                    <div className="h-px flex-1 bg-[var(--app-line)]" />
                    <span className="text-xs text-[var(--app-muted)]">{cityWorkers.length} total · {cityWorkers.filter(w => w.available).length} available</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {cityWorkers.map(worker => (
                      <div
                        key={worker.id}
                        className={`relative rounded-xl border bg-[var(--app-panel)] p-4 transition ${worker.available ? 'border-[var(--app-line)]' : 'border-dashed border-[var(--app-line)] opacity-60'}`}
                      >
                        {/* Delete confirm overlay */}
                        {deletingId === worker.id && (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-white bg-opacity-95">
                            <p className="text-sm font-semibold text-[var(--app-ink)]">Remove {worker.name}?</p>
                            <div className="flex gap-2">
                              <button onClick={() => void handleDelete(worker.id)} className="rounded-[6px] bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700">Remove</button>
                              <button onClick={() => setDeletingId(null)} className="rounded-[6px] border border-[var(--app-line)] px-3 py-1 text-xs text-[var(--app-muted)] hover:bg-[var(--app-bg)]">Cancel</button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-[var(--app-ink)]">{worker.name}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[worker.role]}`}>
                                {ROLES.find(r => r.id === worker.role)?.label || worker.role}
                              </span>
                              {!worker.available && (
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">Inactive</span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-[var(--app-muted)]">{worker.phone}</div>
                            {worker.notes && <div className="mt-1 text-xs text-[var(--app-muted)] italic">{worker.notes}</div>}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => void toggleAvailable(worker)}
                              title={worker.available ? 'Mark inactive' : 'Mark available'}
                              className={`rounded-[6px] px-2 py-1 text-[10px] font-semibold transition ${worker.available ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}
                            >
                              {worker.available ? '✓ Available' : 'Inactive'}
                            </button>
                            <button onClick={() => openEdit(worker)} className="rounded-[6px] p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-bg)]" title="Edit">
                              ✏️
                            </button>
                            <button onClick={() => setDeletingId(worker.id)} className="rounded-[6px] p-1.5 text-rose-400 hover:bg-rose-50" title="Remove">
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl">
            <h2 className="mb-4 text-lg font-semibold text-[var(--app-ink)]">
              {editingId ? 'Edit Worker' : 'Add Worker'}
            </h2>
            <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--app-muted)]">Full Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                  placeholder="e.g. Marcus Williams"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--app-muted)]">Phone *</label>
                <input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                  placeholder="226-555-0100"
                  type="tel"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[var(--app-muted)]">City</label>
                  <select
                    value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value as WorkerCity }))}
                    className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                  >
                    {CITIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[var(--app-muted)]">Role</label>
                  <select
                    value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value as WorkerRole }))}
                    className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                  >
                    {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--app-muted)]">Notes (optional)</label>
                <input
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]"
                  placeholder="e.g. Has own vehicle, prefers weekends"
                />
              </div>
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-[8px] bg-[var(--app-accent)] py-2 text-sm font-semibold text-white hover:bg-[#0a5b47] disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Worker'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-[8px] border border-[var(--app-line)] px-4 py-2 text-sm text-[var(--app-muted)] hover:bg-[var(--app-bg)]"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
