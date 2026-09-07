'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle2, Circle, Clock3, Plus, RefreshCw, UserRound } from 'lucide-react'
import { taskHref, type CRMTask, type TaskPriority } from '@/lib/tasks'

type User = { id: string; name: string; role: string }
type View = 'mine' | 'all' | 'today' | 'overdue' | 'upcoming' | 'unassigned' | 'completed'

function dueLabel(value?: string) {
  if (!value) return 'No due date'
  const date = new Date(value)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(date); target.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  const prefix = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
  return `${prefix} · ${date.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`
}

function priorityTone(priority: TaskPriority) {
  if (priority === 'urgent') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (priority === 'high') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (priority === 'low') return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-blue-100 bg-blue-50 text-blue-700'
}

export default function TasksPage() {
  return <Suspense fallback={<main className="mx-auto w-full max-w-[1500px] px-4 py-16 text-sm text-[var(--app-muted)] sm:px-6 lg:px-8">Loading tasks…</main>}><TasksWorkspace /></Suspense>
}

function TasksWorkspace() {
  const searchParams = useSearchParams()
  const relatedId = searchParams.get('relatedId') || ''
  const relatedLabel = searchParams.get('relatedLabel') || ''
  const [tasks, setTasks] = useState<CRMTask[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [view, setView] = useState<View>(relatedId ? 'all' : 'mine')
  const [owner, setOwner] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [completing, setCompleting] = useState<CRMTask | null>(null)
  const [outcome, setOutcome] = useState('')
  const [nextTitle, setNextTitle] = useState('')
  const [nextDue, setNextDue] = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const [taskResponse, userResponse] = await Promise.all([
        fetch(`/api/tasks${relatedId ? `?relatedId=${encodeURIComponent(relatedId)}` : ''}`, { cache: 'no-store', credentials: 'include' }),
        fetch('/api/sales/users', { cache: 'no-store', credentials: 'include' }),
      ])
      const taskBody = await taskResponse.json()
      if (!taskResponse.ok) throw new Error(taskBody.error || 'Failed to load tasks')
      setTasks(taskBody.tasks || []); setCurrentUser(taskBody.currentUser || null)
      if (userResponse.ok) setUsers(await userResponse.json())
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Failed to load tasks') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [relatedId])

  const visible = useMemo(() => {
    const now = new Date(); const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1)
    const upcomingEnd = new Date(start); upcomingEnd.setDate(upcomingEnd.getDate() + 7)
    return tasks.filter(task => {
      const active = task.status === 'open' || task.status === 'in_progress'
      const due = task.dueAt ? new Date(task.dueAt) : null
      if (owner && task.ownerUserId !== owner) return false
      if (category && task.category !== category) return false
      if (view === 'mine' && (!active || (task.ownerUserId !== currentUser?.id && task.ownerName !== currentUser?.name))) return false
      if (view === 'all' && !active) return false
      if (view === 'today' && (!active || !due || due < start || due >= end)) return false
      if (view === 'overdue' && (!active || !due || due >= now)) return false
      if (view === 'upcoming' && (!active || !due || due < end || due >= upcomingEnd)) return false
      if (view === 'unassigned' && (!active || task.ownerUserId || task.ownerName)) return false
      if (view === 'completed' && task.status !== 'completed') return false
      return true
    }).sort((a, b) => {
      const priority = { urgent: 0, high: 1, normal: 2, low: 3 }
      return priority[a.priority] - priority[b.priority] || String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999'))
    })
  }, [tasks, view, owner, category, currentUser])

  const counts = useMemo(() => {
    const now = new Date(); const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1)
    const active = tasks.filter(task => task.status === 'open' || task.status === 'in_progress')
    return {
      mine: active.filter(task => task.ownerUserId === currentUser?.id || task.ownerName === currentUser?.name).length,
      all: active.length, today: active.filter(task => task.dueAt && new Date(task.dueAt) >= start && new Date(task.dueAt) < end).length,
      overdue: active.filter(task => task.dueAt && new Date(task.dueAt) < now).length,
      upcoming: active.filter(task => task.dueAt && new Date(task.dueAt) >= end).length,
      unassigned: active.filter(task => !task.ownerUserId && !task.ownerName).length,
      completed: tasks.filter(task => task.status === 'completed').length,
    }
  }, [tasks, currentUser])

  async function patchTask(task: CRMTask, patch: Record<string, unknown>) {
    setError('')
    const response = await fetch(`/api/tasks/${task.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    const body = await response.json()
    if (!response.ok) { setError(body.error || 'Failed to update task'); return false }
    setTasks(current => current.map(item => item.id === task.id ? body.task : item).concat(body.nextTask ? [body.nextTask] : []))
    return true
  }

  async function finishTask() {
    if (!completing) return
    const ok = await patchTask(completing, { status: 'completed', outcomeNote: outcome, nextTask: nextTitle ? { title: nextTitle, dueAt: nextDue ? new Date(nextDue).toISOString() : undefined } : undefined })
    if (ok) { setCompleting(null); setOutcome(''); setNextTitle(''); setNextDue('') }
  }

  const views: Array<[View, string]> = [['mine', 'My Tasks'], ['all', 'All Open'], ['today', 'Due Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['unassigned', 'Unassigned'], ['completed', 'Completed']]
  const categories = Array.from(new Set(tasks.map(task => task.category))).sort()

  return <main className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-[var(--app-line)] pb-6">
      <div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-[#8a6800]">Shared accountability</div><h1 className="mt-2 font-display text-3xl font-semibold text-[#071421]">{relatedLabel ? `${relatedLabel} · Tasks` : 'Tasks'}</h1><p className="mt-2 max-w-2xl text-sm text-[var(--app-muted)]">{relatedId ? 'Accountable work and completion history attached to this record.' : 'Every promised follow-up, operational gap, and customer-care action in one owned queue.'}</p></div>
      <div className="flex gap-2"><button onClick={() => void load()} className="crm-button" disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button><button onClick={() => setCreating(true)} className="crm-button-dark"><Plus className="h-4 w-4" /> New task</button></div>
    </header>

    {error && <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

    <div className="mt-6 grid gap-6 xl:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="space-y-1">{views.map(([key, label]) => <button key={key} onClick={() => setView(key)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${view === key ? 'bg-[#071421] font-semibold text-white' : 'text-[#344054] hover:bg-[#f5f2e9]'}`}><span>{label}</span><span className={view === key ? 'text-white/70' : 'text-[var(--app-muted)]'}>{counts[key]}</span></button>)}</aside>
      <section>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select value={owner} onChange={event => setOwner(event.target.value)} className="crm-input min-w-[180px]"><option value="">All owners</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
          <select value={category} onChange={event => setCategory(event.target.value)} className="crm-input min-w-[180px]"><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select>
          <div className="ml-auto text-sm text-[var(--app-muted)]">{visible.length} task{visible.length === 1 ? '' : 's'}</div>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--app-line)] bg-white">
          {visible.map((task, index) => { const href = taskHref(task); const overdue = task.dueAt && new Date(task.dueAt) < new Date() && task.status !== 'completed'; return <article key={task.id} className={`p-4 sm:p-5 ${index ? 'border-t border-[var(--app-line)]' : ''}`}>
            <div className="flex gap-3">
              <button onClick={() => task.status === 'completed' ? undefined : setCompleting(task)} className="mt-0.5 text-[var(--app-muted)] hover:text-emerald-700" aria-label="Complete task">{task.status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5" />}</button>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className={`font-semibold ${task.status === 'completed' ? 'text-slate-500 line-through' : 'text-[#071421]'}`}>{task.title}</h2>{task.description && <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">{task.description}</p>}</div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${priorityTone(task.priority)}`}>{task.priority}</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--app-muted)]"><span className={overdue ? 'font-semibold text-rose-700' : ''}><Clock3 className="mr-1 inline h-3.5 w-3.5" />{dueLabel(task.dueAt)}</span><span><UserRound className="mr-1 inline h-3.5 w-3.5" />{task.ownerName || 'Unassigned'}</span><span className="capitalize">{task.category.replaceAll('_', ' ')}</span>{task.relatedLabel && (href ? <Link href={href} className="font-semibold text-[#8a6800] hover:underline">{task.relatedLabel}</Link> : <span>{task.relatedLabel}</span>)}<span>{task.source === 'condition' ? 'System generated' : 'Manual'}</span></div>
                {task.outcomeNote && <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><strong>Outcome:</strong> {task.outcomeNote}{task.completedByName ? ` · ${task.completedByName}` : ''}</div>}
                {task.status !== 'completed' && <div className="mt-3 flex gap-2"><button onClick={() => void patchTask(task, { status: task.status === 'in_progress' ? 'open' : 'in_progress' })} className="text-xs font-semibold text-[#344054] hover:underline">{task.status === 'in_progress' ? 'Move to open' : 'Start task'}</button><button onClick={() => setCompleting(task)} className="text-xs font-semibold text-emerald-700 hover:underline">Complete with outcome</button></div>}
              </div>
            </div>
          </article> })}
          {!visible.length && <div className="px-5 py-16 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" /><div className="mt-3 font-semibold text-[#071421]">Nothing in this queue</div><p className="mt-1 text-sm text-[var(--app-muted)]">No tasks match the selected view and filters.</p></div>}
        </div>
      </section>
    </div>

    {creating && <TaskDialog users={users} currentUser={currentUser} relatedId={relatedId} relatedLabel={relatedLabel} onClose={() => setCreating(false)} onCreated={task => { setTasks(current => [task, ...current]); setCreating(false) }} onError={setError} />}
    {completing && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold text-[#071421]">Complete task</h2><p className="mt-1 text-sm text-[var(--app-muted)]">{completing.title}</p><label className="mt-5 block"><span className="crm-label mb-2 block">Outcome note *</span><textarea autoFocus value={outcome} onChange={event => setOutcome(event.target.value)} className="crm-input min-h-[100px] w-full" placeholder="What happened, what was decided, and what should the team know?" /></label><div className="mt-5 border-t border-[var(--app-line)] pt-4"><div className="text-sm font-semibold text-[#344054]">Optional next task</div><input value={nextTitle} onChange={event => setNextTitle(event.target.value)} className="crm-input mt-2 w-full" placeholder="Next action, if another step is required" />{nextTitle && <input type="datetime-local" value={nextDue} onChange={event => setNextDue(event.target.value)} className="crm-input mt-2 w-full" />}</div><div className="mt-6 flex justify-end gap-2"><button className="crm-button" onClick={() => setCompleting(null)}>Cancel</button><button className="crm-button-dark" disabled={!outcome.trim()} onClick={() => void finishTask()}>Complete task</button></div></div></div>}
  </main>
}

function TaskDialog({ users, currentUser, relatedId, relatedLabel, onClose, onCreated, onError }: { users: User[]; currentUser: User | null; relatedId: string; relatedLabel: string; onClose: () => void; onCreated: (task: CRMTask) => void; onError: (message: string) => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [priority, setPriority] = useState<TaskPriority>('normal'); const [dueAt, setDueAt] = useState(''); const [ownerId, setOwnerId] = useState(currentUser?.id || ''); const [saving, setSaving] = useState(false)
  async function submit() { setSaving(true); const selected = users.find(user => user.id === ownerId); try { const response = await fetch('/api/tasks', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description, priority, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined, ownerUserId: selected?.id, ownerName: selected?.name, relatedType: relatedId ? 'lead' : undefined, relatedId: relatedId || undefined, relatedLabel: relatedLabel || undefined }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Failed to create task'); onCreated(body.task) } catch (caught) { onError(caught instanceof Error ? caught.message : 'Failed to create task') } finally { setSaving(false) } }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-semibold text-[#071421]">Create task</h2><div className="mt-5 space-y-4"><label className="block"><span className="crm-label mb-2 block">Task *</span><input autoFocus value={title} onChange={event => setTitle(event.target.value)} className="crm-input w-full" placeholder="What needs to happen?" /></label><label className="block"><span className="crm-label mb-2 block">Instructions / context</span><textarea value={description} onChange={event => setDescription(event.target.value)} className="crm-input min-h-[90px] w-full" /></label><div className="grid gap-3 sm:grid-cols-2"><label><span className="crm-label mb-2 block">Owner</span><select value={ownerId} onChange={event => setOwnerId(event.target.value)} className="crm-input w-full"><option value="">Unassigned</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label><span className="crm-label mb-2 block">Priority</span><select value={priority} onChange={event => setPriority(event.target.value as TaskPriority)} className="crm-input w-full"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label></div><label className="block"><span className="crm-label mb-2 block">Due date and time</span><input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} className="crm-input w-full" /></label></div><div className="mt-6 flex justify-end gap-2"><button className="crm-button" onClick={onClose}>Cancel</button><button className="crm-button-dark" disabled={!title.trim() || saving} onClick={() => void submit()}>{saving ? 'Creating…' : 'Create task'}</button></div></div></div>
}
