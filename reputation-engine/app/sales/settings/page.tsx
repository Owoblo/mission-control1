'use client'

import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import type { DialerSettings } from '@/lib/server/dialer-settings'

const DAYS: { key: keyof DialerSettings['businessHours']['schedule']; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

function Toggle({ checked, onChange, label = 'Toggle setting' }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${checked ? 'bg-[#071421]' : 'bg-slate-200'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-[var(--app-line)] bg-white">
      <div className="border-b border-[var(--app-line)] px-6 py-4">
        <div className="font-semibold text-[var(--app-ink)]">{title}</div>
        {description && <div className="mt-0.5 text-xs text-[var(--app-muted)]">{description}</div>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  )
}

export default function DialerSettingsPage() {
  const currentUser = useCurrentUser()
  const [settings, setSettings] = useState<DialerSettings | null>(null)
  const [tableExists, setTableExists] = useState(true)
  const [setupSql, setSetupSql] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newSipUser, setNewSipUser] = useState('')
  const [newBlockedPhone, setNewBlockedPhone] = useState('')
  const [newBlockedTag, setNewBlockedTag] = useState('Spam')

  const isOwner = currentUser?.role === 'owner'

  useEffect(() => {
    fetch('/api/sales/settings', { credentials: 'include' })
      .then(r => r.json())
      .then((data: { settings: DialerSettings; tableExists: boolean; setupSql?: string }) => {
        setSettings(data.settings)
        setTableExists(data.tableExists ?? true)
        setSetupSql(data.setupSql || '')
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  async function save(patch: Partial<DialerSettings>) {
    if (!isOwner || !settings) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/sales/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json()) as { ok?: boolean; settings?: DialerSettings; error?: string }
      if (!res.ok) throw new Error(data.error || 'Save failed')
      if (data.settings) setSettings(data.settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function patch<K extends keyof DialerSettings>(key: K, value: DialerSettings[K]) {
    if (!settings) return
    const next = { ...settings, [key]: value }
    setSettings(next)
    void save({ [key]: value })
  }

  async function addBlockedCaller() {
    if (!newBlockedPhone.trim()) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/sales/dialer/blocked-callers', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: newBlockedPhone, tag: newBlockedTag }),
      })
      const payload = await response.json() as { blockedCallers?: DialerSettings['blockedCallers']; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not block number')
      setSettings(current => current ? { ...current, blockedCallers: payload.blockedCallers || [] } : current)
      setNewBlockedPhone('')
      setNewBlockedTag('Spam')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not block number')
    } finally { setSaving(false) }
  }

  async function unblockCaller(phone: string) {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/sales/dialer/blocked-callers?phone=${encodeURIComponent(phone)}`, { method: 'DELETE', credentials: 'include' })
      const payload = await response.json() as { blockedCallers?: DialerSettings['blockedCallers']; error?: string }
      if (!response.ok) throw new Error(payload.error || 'Could not unblock number')
      setSettings(current => current ? { ...current, blockedCallers: payload.blockedCallers || [] } : current)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unblock number')
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="crm-shell">
        <h1 className="sr-only">Dialer settings</h1><div role="status" className="crm-panel px-6 py-16 text-center text-sm text-[var(--app-muted)]">Loading settings…</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="crm-shell">
        <h1 className="sr-only">Dialer settings</h1><div role="alert" className="rounded-[10px] border border-rose-200 bg-rose-50 px-6 py-4 text-sm text-rose-700">{error || 'Could not load settings.'}</div>
      </div>
    )
  }

  return (
    <div className="crm-shell space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--app-ink)]">Dialer Settings</h1>
          <div className="mt-1 text-sm text-[var(--app-muted)]">Configure call routing, business hours, notifications and more. Owner-only.</div>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-[var(--app-muted)]">Saving…</span>}
          {saved && <span className="text-xs font-semibold text-emerald-600">✓ Saved</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
        </div>
      </div>

      {/* DB Setup Banner */}
      {!tableExists && (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div className="flex-1">
              <div className="font-semibold text-amber-800">One-time setup required</div>
              <div className="mt-1 text-sm text-amber-700">Run this SQL in your Supabase dashboard to enable settings storage. Settings are currently showing defaults.</div>
              <pre className="mt-3 overflow-x-auto rounded-[8px] bg-white px-4 py-3 text-xs text-slate-700">{setupSql}</pre>
              <div className="mt-3 flex gap-2">
                <a
                  href="https://supabase.com/dashboard/project/idbyrtwdeeruiutoukct/editor"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-[8px] bg-amber-500 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-400"
                >
                  Open Supabase SQL Editor →
                </a>
                <button
                  onClick={() => navigator.clipboard.writeText(setupSql)}
                  className="rounded-[8px] border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  Copy SQL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isOwner && (
        <div className="rounded-[10px] border border-sky-200 bg-sky-50 px-5 py-3 text-sm text-sky-700">
          You can view settings but only the owner can make changes.
        </div>
      )}

      {/* Business Hours */}
      <SectionCard title="Spam & Blocked Numbers" description="Blocked callers are rejected by Twilio before any CRM browser, SIP phone, IVR, voicemail, or missed-call workflow rings.">
        <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
          <input value={newBlockedPhone} onChange={event => setNewBlockedPhone(event.target.value)} placeholder="Phone number" className="crm-input" />
          <input value={newBlockedTag} onChange={event => setNewBlockedTag(event.target.value)} placeholder="Tag (Spam, Robocall…)" className="crm-input" />
          <button onClick={() => void addBlockedCaller()} disabled={!newBlockedPhone.trim() || saving} className="rounded-[8px] bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40">Tag & block</button>
        </div>
        <div className="mt-4 space-y-2">
          {(settings.blockedCallers || []).length === 0 ? (
            <div className="rounded-[8px] bg-[var(--app-bg)] px-4 py-5 text-center text-sm text-[var(--app-muted)]">No blocked callers yet.</div>
          ) : (settings.blockedCallers || []).map(entry => (
            <div key={entry.phone} className="flex items-center justify-between gap-4 rounded-[8px] border border-[var(--app-line)] px-4 py-3">
              <div className="min-w-0">
                <div className="font-semibold text-[var(--app-ink)]">{entry.phone}</div>
                <div className="mt-0.5 text-xs text-[var(--app-muted)]"><span className="font-semibold text-rose-600">{entry.tag}</span> · Blocked {new Date(entry.blockedAt).toLocaleDateString()}{entry.blockedBy ? ` by ${entry.blockedBy}` : ''}</div>
              </div>
              <button onClick={() => void unblockCaller(entry.phone)} className="shrink-0 rounded-[7px] border border-[var(--app-line)] px-3 py-1.5 text-xs font-semibold text-[var(--app-ink)] hover:bg-[var(--app-bg)]">Unblock</button>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Business Hours */}
      <SectionCard title="Business Hours" description="Calls outside these hours go straight to voicemail.">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--app-ink)]">Enable business hours restriction</span>
          <Toggle
            checked={settings.businessHours.enabled}
            onChange={v => patch('businessHours', { ...settings.businessHours, enabled: v })}
          />
        </div>
        {settings.businessHours.enabled && (
          <div className="mt-5 space-y-3">
            <div className="grid grid-cols-[100px_1fr_1fr_40px] gap-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
              <div>Day</div><div>Opens</div><div>Closes</div><div>Open</div>
            </div>
            {DAYS.map(({ key, label }) => {
              const sched = settings.businessHours.schedule[key]
              return (
                <div key={key} className="grid grid-cols-[100px_1fr_1fr_40px] items-center gap-3">
                  <div className="text-sm text-[var(--app-ink)]">{label}</div>
                  <input
                    type="time"
                    aria-label={`${label} opening time`}
                    value={sched?.open || '08:00'}
                    disabled={!sched || !isOwner}
                    onChange={e => patch('businessHours', {
                      ...settings.businessHours,
                      schedule: { ...settings.businessHours.schedule, [key]: { ...sched, open: e.target.value } },
                    })}
                    className="crm-input disabled:opacity-40"
                  />
                  <input
                    type="time"
                    aria-label={`${label} closing time`}
                    value={sched?.close || '21:00'}
                    disabled={!sched || !isOwner}
                    onChange={e => patch('businessHours', {
                      ...settings.businessHours,
                      schedule: { ...settings.businessHours.schedule, [key]: { ...sched, close: e.target.value } },
                    })}
                    className="crm-input disabled:opacity-40"
                  />
                  <div className="flex justify-center">
                    <Toggle
                      checked={!!sched}
                      onChange={open => patch('businessHours', {
                        ...settings.businessHours,
                        schedule: {
                          ...settings.businessHours.schedule,
                          [key]: open ? { open: '08:00', close: '21:00' } : null,
                        },
                      })}
                    />
                  </div>
                </div>
              )
            })}
            <div className="mt-2 text-xs text-[var(--app-muted)]">Timezone: {settings.businessHours.timezone}</div>
          </div>
        )}
      </SectionCard>

      {/* Ring Timeout */}
      <SectionCard title="Ring Timeout" description="How long to ring reps before sending to voicemail or queue.">
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="10"
            max="60"
            step="2"
            value={settings.ringTimeout}
            disabled={!isOwner}
            onChange={e => setSettings(s => s ? { ...s, ringTimeout: Number(e.target.value) } : s)}
            onMouseUp={e => patch('ringTimeout', Number((e.target as HTMLInputElement).value))}
            onTouchEnd={e => patch('ringTimeout', Number((e.target as HTMLInputElement).value))}
            className="flex-1 accent-[#071421]"
          />
          <span className="w-16 text-center text-sm font-semibold text-[var(--app-ink)]">{settings.ringTimeout}s</span>
        </div>
        <div className="mt-2 text-xs text-[var(--app-muted)]">Currently ringing each inbound call for {settings.ringTimeout} seconds before triggering missed-call flow.</div>
      </SectionCard>

      {/* Queue */}
      <SectionCard title="Call Queue" description="When all reps are busy, hold the caller instead of sending to voicemail.">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--app-ink)]">Enable call queue</span>
          <Toggle checked={settings.queue.enabled} onChange={v => patch('queue', { ...settings.queue, enabled: v })} />
        </div>
        {settings.queue.enabled && (
          <div className="mt-4 flex items-center gap-3">
            <label className="text-sm text-[var(--app-muted)]">Max hold time</label>
            <input
              type="number"
              min="30"
              max="600"
              step="15"
              value={settings.queue.maxWaitSeconds}
              disabled={!isOwner}
              onChange={e => setSettings(s => s ? { ...s, queue: { ...s.queue, maxWaitSeconds: Number(e.target.value) } } : s)}
              onBlur={e => patch('queue', { ...settings.queue, maxWaitSeconds: Number(e.target.value) })}
              className="crm-input w-24"
            />
            <span className="text-sm text-[var(--app-muted)]">seconds</span>
          </div>
        )}
      </SectionCard>

      {/* Voicemail */}
      <SectionCard title="Voicemail" description="Plays after ring timeout (or after-hours). Callers record a message.">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--app-ink)]">Enable voicemail</span>
          <Toggle checked={settings.voicemail.enabled} onChange={v => patch('voicemail', { ...settings.voicemail, enabled: v })} />
        </div>
        {settings.voicemail.enabled && (
          <div className="mt-4">
            <label className="crm-label">Greeting message (read by AI voice)</label>
            <textarea
              value={settings.voicemail.greeting}
              disabled={!isOwner}
              rows={3}
              onChange={e => setSettings(s => s ? { ...s, voicemail: { ...s.voicemail, greeting: e.target.value } } : s)}
              onBlur={e => patch('voicemail', { ...settings.voicemail, greeting: e.target.value })}
              className="crm-input mt-1.5 resize-none"
              placeholder="Hi! You've reached Saturn Star Moving…"
            />
          </div>
        )}
      </SectionCard>

      {/* IVR Menu */}
      <SectionCard title="IVR Menu (Optional)" description='Phone menu like "Press 1 for a quote". Off by default — most customers prefer to speak directly.'>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-[var(--app-ink)]">Enable IVR menu</span>
            <div className="mt-0.5 text-xs text-[var(--app-muted)]">Also requires ENABLE_IVR_MENU=true in Vercel environment variables</div>
          </div>
          <Toggle checked={settings.ivr.enabled} onChange={v => patch('ivr', { ...settings.ivr, enabled: v })} />
        </div>
        {settings.ivr.enabled && (
          <div className="mt-4">
            <label className="crm-label">Menu greeting</label>
            <textarea
              value={settings.ivr.greeting}
              disabled={!isOwner}
              rows={2}
              onChange={e => setSettings(s => s ? { ...s, ivr: { ...s.ivr, greeting: e.target.value } } : s)}
              onBlur={e => patch('ivr', { ...settings.ivr, greeting: e.target.value })}
              className="crm-input mt-1.5 resize-none"
              placeholder="Press 1 for a quote. Press 2 for an existing booking."
            />
            <div className="mt-2 rounded-[8px] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-muted)]">
              Both options currently route to the same rep team. Assign dedicated reps per option in a future update.
            </div>
          </div>
        )}
      </SectionCard>

      {/* Notifications */}
      <SectionCard title="Rep Notifications" description="Email alerts sent to the team for missed calls, inbound SMS, and voicemails.">
        <div className="space-y-3">
          {[
            { key: 'notifyOnMissedCall' as const, label: 'Email on missed call' },
            { key: 'notifyOnSms' as const, label: 'Email on inbound SMS' },
            { key: 'notifyOnVoicemail' as const, label: 'Email on new voicemail' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-sm text-[var(--app-ink)]">{label}</span>
              <Toggle
                checked={settings.notifications[key]}
                onChange={v => patch('notifications', { ...settings.notifications, [key]: v })}
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            <span className="text-sm text-[var(--app-ink)]">Caller ID SMS on Groundwire</span>
            <div className="mt-0.5 text-xs text-[var(--app-muted)]">When a saved lead calls, instantly SMS rep phones with their name before Groundwire is answered</div>
          </div>
          <Toggle
            checked={settings.notifications.notifyCallerIdSms ?? true}
            onChange={v => patch('notifications', { ...settings.notifications, notifyCallerIdSms: v })}
          />
        </div>

        <div className="mt-5">
          <div className="crm-label">Rep phones (for caller ID SMS)</div>
          <div className="mt-2 space-y-2">
            {(settings.notifications.repPhones || []).map((phone, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={phone}
                  disabled={!isOwner}
                  onChange={e => {
                    const next = [...(settings.notifications.repPhones || [])]
                    next[i] = e.target.value
                    setSettings(s => s ? { ...s, notifications: { ...s.notifications, repPhones: next } } : s)
                  }}
                  onBlur={e => {
                    const next = [...(settings.notifications.repPhones || [])]
                    next[i] = e.target.value
                    patch('notifications', { ...settings.notifications, repPhones: next })
                  }}
                  className="crm-input flex-1"
                  placeholder="+1..."
                />
                {isOwner && (settings.notifications.repPhones || []).length > 1 && (
                  <button
                    onClick={() => {
                      const next = (settings.notifications.repPhones || []).filter((_, j) => j !== i)
                      patch('notifications', { ...settings.notifications, repPhones: next })
                    }}
                    className="text-sm text-rose-500 hover:text-rose-700"
                  >×</button>
                )}
              </div>
            ))}
            {isOwner && (
              <div className="flex gap-2">
                <input
                  value={newEmail.startsWith('+') ? newEmail : ''}
                  onChange={e => setNewEmail(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newEmail.startsWith('+')) {
                      patch('notifications', { ...settings.notifications, repPhones: [...(settings.notifications.repPhones || []), newEmail] })
                      setNewEmail('')
                    }
                  }}
                  placeholder="+1... rep phone"
                  className="crm-input flex-1"
                />
                <button
                  onClick={() => {
                    if (newEmail.startsWith('+')) {
                      patch('notifications', { ...settings.notifications, repPhones: [...(settings.notifications.repPhones || []), newEmail] })
                      setNewEmail('')
                    }
                  }}
                  className="rounded-[8px] border border-[var(--app-line)] px-3 py-2 text-sm text-[var(--app-ink)] hover:bg-[var(--app-bg)]"
                >Add</button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5">
          <div className="crm-label">Notification emails</div>
          <div className="mt-2 space-y-2">
            {settings.notifications.emails.map((email, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={email}
                  disabled={!isOwner}
                  onChange={e => {
                    const next = [...settings.notifications.emails]
                    next[i] = e.target.value
                    setSettings(s => s ? { ...s, notifications: { ...s.notifications, emails: next } } : s)
                  }}
                  onBlur={e => {
                    const next = [...settings.notifications.emails]
                    next[i] = e.target.value
                    patch('notifications', { ...settings.notifications, emails: next })
                  }}
                  className="crm-input flex-1"
                />
                {isOwner && settings.notifications.emails.length > 1 && (
                  <button
                    onClick={() => {
                      const next = settings.notifications.emails.filter((_, j) => j !== i)
                      patch('notifications', { ...settings.notifications, emails: next })
                    }}
                    className="text-sm text-rose-500 hover:text-rose-700"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {isOwner && (
              <div className="flex gap-2">
                <input
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newEmail.includes('@')) {
                      patch('notifications', { ...settings.notifications, emails: [...settings.notifications.emails, newEmail] })
                      setNewEmail('')
                    }
                  }}
                  placeholder="Add email…"
                  className="crm-input flex-1"
                />
                <button
                  onClick={() => {
                    if (newEmail.includes('@')) {
                      patch('notifications', { ...settings.notifications, emails: [...settings.notifications.emails, newEmail] })
                      setNewEmail('')
                    }
                  }}
                  className="rounded-[8px] border border-[var(--app-line)] px-3 py-2 text-sm text-[var(--app-ink)] hover:bg-[var(--app-bg)]"
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* SIP Users */}
      <SectionCard title="Groundwire / SIP Users" description="These usernames ring on Groundwire for every inbound call (alongside browser reps).">
        <div className="space-y-2">
          {settings.sipUsers.map((user, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2">
                <span className="text-xs text-[var(--app-muted)]">sip:</span>
                <input
                  value={user}
                  disabled={!isOwner}
                  onChange={e => {
                    const next = [...settings.sipUsers]
                    next[i] = e.target.value
                    setSettings(s => s ? { ...s, sipUsers: next } : s)
                  }}
                  onBlur={e => {
                    const next = [...settings.sipUsers]
                    next[i] = e.target.value
                    patch('sipUsers', next)
                  }}
                  className="flex-1 bg-transparent text-sm text-[var(--app-ink)] outline-none"
                />
                <span className="text-xs text-[var(--app-muted)]">@saturn.sip.twilio.com</span>
              </div>
              {isOwner && settings.sipUsers.length > 1 && (
                <button
                  onClick={() => patch('sipUsers', settings.sipUsers.filter((_, j) => j !== i))}
                  className="text-sm text-rose-500 hover:text-rose-700"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {isOwner && (
            <div className="flex gap-2">
              <input
                value={newSipUser}
                onChange={e => setNewSipUser(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newSipUser.trim()) {
                    patch('sipUsers', [...settings.sipUsers, newSipUser.trim()])
                    setNewSipUser('')
                  }
                }}
                placeholder="username (no domain)"
                className="crm-input flex-1"
              />
              <button
                onClick={() => {
                  if (newSipUser.trim()) {
                    patch('sipUsers', [...settings.sipUsers, newSipUser.trim()])
                    setNewSipUser('')
                  }
                }}
                className="rounded-[8px] border border-[var(--app-line)] px-3 py-2 text-sm text-[var(--app-ink)] hover:bg-[var(--app-bg)]"
              >
                Add
              </button>
            </div>
          )}
          <div className="mt-2 text-xs text-[var(--app-muted)]">
            In Groundwire: Server = saturn.sip.twilio.com · Username = your entry above · Password = Twilio API Key Secret
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
