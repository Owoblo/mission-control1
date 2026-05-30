'use client'

import { useEffect, useRef, useState } from 'react'

const OPS_NUMBER = '+12267746581'
const SUPA_URL = 'https://idbyrtwdeeruiutoukct.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkYnlydHdkZWVydWl1dG91a2N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgyNTk0NjQsImV4cCI6MjA1MzgzNTQ2NH0.Hw0oJmIuDGdITM3TZkMWeXkHy53kO4i8TCJMxb6_hko'

type SmsMessage = {
  id: string
  from_number: string
  to_number: string
  body: string
  direction: 'inbound' | 'outbound'
  twilio_sid?: string
  created_at: string
}

type Thread = {
  contactPhone: string
  messages: SmsMessage[]
  lastAt: string
  lastBody: string
  unread: boolean
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `+1 ${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`
  return phone
}

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  if (d.length > 7) return `+${d}`
  return raw
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function groupIntoThreads(messages: SmsMessage[]): Thread[] {
  const map = new Map<string, SmsMessage[]>()
  for (const msg of messages) {
    const contact = msg.direction === 'inbound' ? msg.from_number : msg.to_number
    if (!map.has(contact)) map.set(contact, [])
    map.get(contact)!.push(msg)
  }
  return Array.from(map.entries())
    .map(([phone, msgs]) => {
      const sorted = [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      const last = sorted[sorted.length - 1]
      return { contactPhone: phone, messages: sorted, lastAt: last.created_at, lastBody: last.body, unread: last.direction === 'inbound' }
    })
    .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|heic)(\?|$)/i.test(url)
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|avi|webm|3gp)(\?|$)/i.test(url)
}

export default function OpsSmsPage() {
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatPhone, setNewChatPhone] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchMessages() {
    try {
      const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
      const phone = encodeURIComponent(OPS_NUMBER)
      const base = `${SUPA_URL}/rest/v1/sms_messages?order=created_at.desc&limit=250`
      const [r1, r2] = await Promise.all([
        fetch(`${base}&to_number=eq.${phone}`, { headers, cache: 'no-store' }),
        fetch(`${base}&from_number=eq.${phone}`, { headers, cache: 'no-store' }),
      ])
      const [d1, d2] = await Promise.all([
        r1.ok ? r1.json() as Promise<SmsMessage[]> : Promise.resolve([]),
        r2.ok ? r2.json() as Promise<SmsMessage[]> : Promise.resolve([]),
      ])
      const seen = new Set<string>()
      const merged = [...d1, ...d2].filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
      setMessages(merged)
      if (!selected && merged.length > 0) {
        const threads = groupIntoThreads(merged)
        if (threads[0]) setSelected(threads[0].contactPhone)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchMessages()
    pollRef.current = setInterval(() => void fetchMessages(), 15000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selected, messages])

  async function uploadMedia(file: File): Promise<string | null> {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/sales/operations/upload-media', { method: 'POST', body: fd, credentials: 'include' })
      if (!res.ok) return null
      const data = (await res.json()) as { url?: string }
      return data.url || null
    } catch { return null }
  }

  async function sendReply() {
    if ((!reply.trim() && mediaFiles.length === 0) || !selected || sending) return
    setSending(true)
    setError(null)
    try {
      // Upload media files first
      const mediaUrls: string[] = []
      for (const file of mediaFiles) {
        const url = await uploadMedia(file)
        if (url) mediaUrls.push(url)
      }

      const res = await fetch('/api/sales/operations/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: selected, body: reply.trim() || ' ', mediaUrls }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error || 'Send failed')
      setReply('')
      setMediaFiles([])
      await fetchMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  function startNewChat() {
    const phone = normalizePhone(newChatPhone)
    if (phone.length < 10) return
    setSelected(phone)
    setNewChatOpen(false)
    setNewChatPhone('')
  }

  const threads = groupIntoThreads(messages)
  const activeThread = threads.find(t => t.contactPhone === selected)

  return (
    <div className="flex h-screen bg-[var(--app-bg)]">
      {/* Thread list */}
      <div className="w-72 shrink-0 border-r border-[var(--app-line)] bg-[var(--app-panel)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--app-line)] flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--app-muted)]">Operations SMS</div>
            <div className="text-[10px] text-[var(--app-muted)]">{formatPhone(OPS_NUMBER)}</div>
          </div>
          <button
            onClick={() => setNewChatOpen(true)}
            className="rounded-[6px] bg-[var(--app-accent)] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 transition"
          >
            + New
          </button>
        </div>

        {/* New chat input */}
        {newChatOpen && (
          <div className="px-3 py-2 border-b border-[var(--app-line)] bg-[var(--app-bg)] space-y-1.5">
            <input
              autoFocus
              value={newChatPhone}
              onChange={e => setNewChatPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') startNewChat(); if (e.key === 'Escape') setNewChatOpen(false) }}
              placeholder="Phone number (e.g. 226-555-1234)"
              className="crm-input w-full text-sm"
            />
            <div className="flex gap-1.5">
              <button onClick={startNewChat} className="flex-1 rounded-[6px] bg-[var(--app-accent)] py-1 text-[11px] font-semibold text-white">Start chat</button>
              <button onClick={() => setNewChatOpen(false)} className="flex-1 rounded-[6px] border border-[var(--app-line)] py-1 text-[11px] text-[var(--app-muted)]">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-8 text-xs text-[var(--app-muted)]">Loading...</div>}
          {!loading && threads.length === 0 && <div className="px-4 py-8 text-xs text-[var(--app-muted)]">No messages yet. Tap + New to start a conversation.</div>}
          {threads.map(thread => (
            <button
              key={thread.contactPhone}
              onClick={() => setSelected(thread.contactPhone)}
              className={`w-full text-left px-4 py-3 border-b border-[var(--app-line)] transition ${selected === thread.contactPhone ? 'bg-[rgba(15,106,83,0.06)] border-l-[3px] border-l-[var(--app-accent)]' : 'hover:bg-[var(--app-bg)]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold truncate ${thread.unread ? 'text-[var(--app-ink)]' : 'text-[var(--app-muted)]'}`}>{formatPhone(thread.contactPhone)}</span>
                <span className="text-[10px] text-[var(--app-muted)] shrink-0">{timeAgo(thread.lastAt)}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--app-muted)] truncate">{thread.lastBody}</div>
              {thread.unread && <div className="mt-1 inline-block rounded-full bg-[var(--app-accent)] px-2 py-0.5 text-[9px] font-semibold text-white uppercase tracking-wide">New</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Message view */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--app-muted)]">
            <div className="text-sm">Select a conversation or start a new one</div>
            <button onClick={() => setNewChatOpen(true)} className="rounded-[8px] bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition">+ New conversation</button>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-[var(--app-line)] bg-[var(--app-panel)]">
              <div className="font-semibold text-[var(--app-ink)]">{formatPhone(selected)}</div>
              <div className="text-[10px] text-[var(--app-muted)]">Operations line · {formatPhone(OPS_NUMBER)}</div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {(!activeThread || activeThread.messages.length === 0) && (
                <div className="flex items-center justify-center h-32 text-xs text-[var(--app-muted)]">No messages yet — send the first one below</div>
              )}
              {activeThread?.messages.map(msg => {
                const isOutbound = msg.direction === 'outbound'
                const mmsMatch = msg.body.match(/\[MMS: (.+?)\]/)
                const mediaUrls = mmsMatch ? mmsMatch[1].split(', ').filter(Boolean) : []
                const textBody = msg.body.replace(/\[MMS: .+?\]/, '').trim()
                return (
                  <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-[16px] px-3.5 py-2.5 ${isOutbound ? 'bg-[var(--app-accent)] text-white rounded-br-[4px]' : 'bg-white border border-[var(--app-line)] text-[var(--app-ink)] rounded-bl-[4px]'}`}>
                      {textBody && <div className="text-sm leading-relaxed whitespace-pre-wrap">{textBody}</div>}
                      {mediaUrls.map((url, i) => (
                        <div key={i} className="mt-1.5">
                          {isImageUrl(url) ? (
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <img src={url} alt="attachment" className="max-w-[220px] rounded-[8px] object-cover" />
                            </a>
                          ) : isVideoUrl(url) ? (
                            <video src={url} controls className="max-w-[220px] rounded-[8px]" />
                          ) : (
                            <a href={url} target="_blank" rel="noopener noreferrer" className={`text-[11px] underline ${isOutbound ? 'text-white/80' : 'text-[var(--app-accent)]'}`}>📎 View attachment</a>
                          )}
                        </div>
                      ))}
                      <div className={`mt-1 text-[9px] ${isOutbound ? 'text-white/60' : 'text-[var(--app-muted)]'}`}>{timeAgo(msg.created_at)}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Media preview */}
            {mediaFiles.length > 0 && (
              <div className="px-4 pt-2 flex gap-2 flex-wrap bg-[var(--app-panel)] border-t border-[var(--app-line)]">
                {mediaFiles.map((f, i) => (
                  <div key={i} className="relative">
                    {f.type.startsWith('image/') ? (
                      <img src={URL.createObjectURL(f)} alt={f.name} className="h-16 w-16 rounded-[6px] object-cover" />
                    ) : (
                      <div className="h-16 w-16 rounded-[6px] bg-[var(--app-bg)] flex items-center justify-center text-[10px] text-[var(--app-muted)] text-center px-1">{f.name.slice(0,12)}</div>
                    )}
                    <button onClick={() => setMediaFiles(fs => fs.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Reply bar */}
            <div className="px-4 py-3 border-t border-[var(--app-line)] bg-[var(--app-panel)]">
              {error && <div className="mb-2 text-xs text-rose-600">{error}</div>}
              <div className="flex gap-2 items-end">
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
                  onChange={e => { if (e.target.files) setMediaFiles(fs => [...fs, ...Array.from(e.target.files!)]) }} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 rounded-[8px] border border-[var(--app-line)] bg-white px-2.5 py-2 text-base hover:bg-[var(--app-bg)] transition"
                  title="Attach image or video"
                >📎</button>
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendReply() } }}
                  placeholder={mediaFiles.length > 0 ? 'Add a caption (optional)...' : 'Message...'}
                  rows={2}
                  className="crm-input flex-1 resize-none text-sm"
                />
                <button
                  onClick={() => void sendReply()}
                  disabled={(!reply.trim() && mediaFiles.length === 0) || sending}
                  className="shrink-0 rounded-[8px] bg-[var(--app-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition"
                >
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
