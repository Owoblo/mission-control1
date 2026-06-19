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

function sameSmsGroup(current?: SmsMessage | null, adjacent?: SmsMessage | null) {
  if (!current || !adjacent) return false
  if (current.direction !== adjacent.direction) return false
  const currentAt = current.created_at ? new Date(current.created_at).getTime() : 0
  const adjacentAt = adjacent.created_at ? new Date(adjacent.created_at).getTime() : 0
  if (!currentAt || !adjacentAt) return true
  return Math.abs(adjacentAt - currentAt) < 10 * 60 * 1000
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
    pollRef.current = setInterval(() => {
      if (document.hidden) return
      void fetchMessages()
    }, 15000)
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
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-0 overflow-hidden bg-white md:h-[calc(100dvh-7rem)]">
      {/* Thread list */}
      <div className={`${selected ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-slate-200 bg-white md:w-[340px] lg:w-[360px]`}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-4">
          <div>
            <div className="text-xl font-semibold tracking-tight text-[#111827]">Operations SMS</div>
            <div className="text-xs font-medium text-slate-500">{formatPhone(OPS_NUMBER)}</div>
          </div>
          <button
            onClick={() => setNewChatOpen(true)}
            className="min-h-11 rounded-full bg-[#111827] px-4 text-sm font-semibold text-white transition hover:bg-slate-800 md:min-h-10 md:text-xs"
          >
            + New
          </button>
        </div>

        {/* New chat input */}
        {newChatOpen && (
          <div className="space-y-2 border-b border-slate-100 bg-slate-50 px-3 py-3">
            <input
              autoFocus
              value={newChatPhone}
              onChange={e => setNewChatPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') startNewChat(); if (e.key === 'Escape') setNewChatOpen(false) }}
              placeholder="Phone number (e.g. 226-555-1234)"
              className="crm-input min-h-12 w-full rounded-full text-base md:min-h-10 md:text-sm"
            />
            <div className="flex gap-1.5">
              <button onClick={startNewChat} className="min-h-11 flex-1 rounded-full bg-[#111827] px-3 text-sm font-semibold text-white md:min-h-9 md:text-xs">Start chat</button>
              <button onClick={() => setNewChatOpen(false)} className="min-h-11 flex-1 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 md:min-h-9 md:text-xs">Cancel</button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-8 text-xs text-slate-500">Loading...</div>}
          {!loading && threads.length === 0 && <div className="px-4 py-8 text-xs text-slate-500">No messages yet. Tap + New to start a conversation.</div>}
          {threads.map(thread => (
            <button
              key={thread.contactPhone}
              onClick={() => setSelected(thread.contactPhone)}
              className={`w-full border-b border-slate-100 px-4 py-4 text-left transition md:py-3.5 ${selected === thread.contactPhone ? 'bg-slate-100 shadow-[inset_3px_0_0_#111827]' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-sm font-semibold ${thread.unread || selected === thread.contactPhone ? 'text-[#111827]' : 'text-slate-700'}`}>{formatPhone(thread.contactPhone)}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{timeAgo(thread.lastAt)}</span>
              </div>
              <div className="mt-1 truncate text-sm leading-[1.5] text-slate-600">{thread.lastBody}</div>
              {thread.unread && <div className="mt-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">New</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Message view */}
      <div className={`${!selected ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0`}>
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-3xl">💬</div>
            <div className="text-base font-semibold text-[#111827]">Start conversation</div>
            <div className="max-w-xs text-center text-sm">Choose a thread from the list, or start a new SMS from the operations line.</div>
            <button onClick={() => setNewChatOpen(true)} className="rounded-full bg-[#111827] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">New conversation</button>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-200 bg-white px-4 py-3 md:px-5">
              <div className="flex items-center gap-2">
                <button onClick={() => setSelected(null)} className="flex h-11 w-11 items-center justify-center rounded-full text-2xl text-[#111827] md:hidden">‹</button>
                <div>
                  <div className="font-semibold text-[#111827]">{formatPhone(selected)}</div>
                  <div className="text-xs text-slate-500">Operations line · {formatPhone(OPS_NUMBER)}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-3 py-6 sm:px-6">
              {(!activeThread || activeThread.messages.length === 0) && (
                <div className="flex h-32 items-center justify-center text-xs text-slate-500">No messages yet. Send the first one below.</div>
              )}
              {activeThread?.messages.map((msg, index) => {
                const isOutbound = msg.direction === 'outbound'
                const previousMessage = activeThread.messages[index - 1]
                const nextMessage = activeThread.messages[index + 1]
                const groupedWithPrevious = sameSmsGroup(msg, previousMessage)
                const groupedWithNext = sameSmsGroup(msg, nextMessage)
                const mmsMatch = msg.body.match(/\[MMS: (.+?)\]/)
                const mediaUrls = mmsMatch ? mmsMatch[1].split(', ').filter(Boolean) : []
                const textBody = msg.body.replace(/\[MMS: .+?\]/, '').trim()
                return (
                  <div key={msg.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} ${index === 0 ? '' : groupedWithPrevious ? 'mt-1' : 'mt-6'}`}>
                    <div className={`max-w-[min(78%,620px)] px-4 py-3 text-base leading-[1.5] md:text-sm ${isOutbound ? `bg-[#0f6a53] text-white ${groupedWithPrevious ? 'rounded-tr-md' : 'rounded-tr-[18px]'} ${groupedWithNext ? 'rounded-br-md' : 'rounded-br-[18px]'} rounded-l-[18px]` : `bg-[#f1f3f5] text-[#111827] ${groupedWithPrevious ? 'rounded-tl-md' : 'rounded-tl-[18px]'} ${groupedWithNext ? 'rounded-bl-md' : 'rounded-bl-[18px]'} rounded-r-[18px]`}`}>
                      {textBody && <div className="whitespace-pre-wrap break-words">{textBody}</div>}
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
                      <div className={`mt-1 text-[10px] ${isOutbound ? 'text-white/60' : 'text-slate-500'}`}>{timeAgo(msg.created_at)}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Media preview */}
            {mediaFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 pt-2">
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
            <div className="border-t border-slate-200 bg-white px-4 py-3 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))]">
              {error && <div className="mb-2 text-xs text-rose-600">{error}</div>}
              <div className="flex gap-2 items-end">
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden"
                  onChange={e => { if (e.target.files) setMediaFiles(fs => [...fs, ...Array.from(e.target.files!)]) }} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-base transition hover:bg-slate-50 md:h-11 md:w-11"
                  title="Attach image or video"
                >📎</button>
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendReply() } }}
                  placeholder={mediaFiles.length > 0 ? 'Add a caption (optional)...' : 'Message...'}
                  rows={2}
                  className="min-h-12 flex-1 resize-none rounded-full border border-slate-200 bg-slate-100 px-5 py-3 text-base leading-[1.5] text-[#111827] outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white md:text-sm"
                />
                <button
                  onClick={() => void sendReply()}
                  disabled={(!reply.trim() && mediaFiles.length === 0) || sending}
                  className="min-h-12 shrink-0 rounded-full bg-[#0f6a53] px-5 text-sm font-semibold text-white transition hover:bg-[#0c5745] disabled:opacity-50 md:min-h-11"
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
