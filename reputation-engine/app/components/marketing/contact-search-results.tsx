'use client'
import { useEffect, useRef, useState } from 'react'
import { fetchRead } from '@/lib/resilient-read'

type Row = { id: string; name: string; company?: string; city?: string; email?: string; phone?: string }
type Page = { contacts: Row[]; nextCursor: string | null }
export function ContactSearchResults({ query, filters, selectedId, onSelect, refreshKey = 0 }: {
  refreshKey?: number
  query: string; filters: Record<string, string>; selectedId: string | null
  onSelect: (contact: Record<string, unknown>) => void
}) {
  const key = new URLSearchParams({ q: query.trim(), ...filters, limit: '50' }).toString()
  const [page, setPage] = useState<Page>({ contacts: [], nextCursor: null })
  const [publishedKey, setPublishedKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selecting, setSelecting] = useState<string | null>(null)
  const version = useRef(0)
  const read = useRef<AbortController | null>(null)
  const detail = useRef<AbortController | null>(null)
  useEffect(() => {
    const current = ++version.current
    read.current?.abort()
    const controller = new AbortController(); read.current = controller
    setLoading(true); setError('')
    const timer = setTimeout(() => {
      void fetchRead(`/api/marketing/contacts/search?${key}`, { credentials: 'include', signal: controller.signal })
        .then(response => response.json() as Promise<Page>)
        .then(result => { if (current === version.current) { setPage(result); setPublishedKey(key) } })
        .catch(() => { if (!controller.signal.aborted) setError('Contact search could not load. Retry to search again.') })
        .finally(() => { if (current === version.current) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, retry, refreshKey])
  useEffect(() => () => { detail.current?.abort(); version.current++ }, [])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRetry(value => value + 1) }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])
  async function more() {
    if (!page.nextCursor || loading || publishedKey !== key) return
    const current = version.current
    const controller = new AbortController(); read.current = controller
    setLoading(true); setError('')
    try {
      const response = await fetchRead(`/api/marketing/contacts/search?${key}&cursor=${encodeURIComponent(page.nextCursor)}`, { credentials: 'include', signal: controller.signal })
      const result = await response.json() as Page
      if (version.current === current) setPage(previous => ({ contacts: [...new Map([...previous.contacts, ...result.contacts].map(row => [row.id, row])).values()], nextCursor: result.nextCursor }))
    } catch { if (!controller.signal.aborted) setError('More contacts could not load. Retry Load more.') }
    finally { if (version.current === current) setLoading(false) }
  }
  async function select(id: string) {
    detail.current?.abort()
    const controller = new AbortController(); detail.current = controller
    setSelecting(id); setError('')
    try {
      const response = await fetchRead(`/api/marketing/contacts?mode=directory&id=${encodeURIComponent(id)}&limit=1`, { credentials: 'include', signal: controller.signal })
      const result = await response.json()
      if (!controller.signal.aborted) {
        if (result.contacts?.[0]?.id !== id) throw new Error('Unavailable')
        onSelect(result.contacts[0])
      }
    } catch { if (!controller.signal.aborted) setError('This contact could not be opened. Your current conversation is unchanged.') }
    finally { if (detail.current === controller) setSelecting(null) }
  }
  const rows = publishedKey === key ? page.contacts : []
  return <section aria-label="Contact search results" aria-busy={loading} className="flex-1 overflow-y-auto">
    <p role="status" className="p-3 text-xs text-slate-500">{loading ? 'Searching contacts…' : `${rows.length} contacts loaded${page.nextCursor ? ' · more available' : ''}`}</p>
    {error && <div role="alert" className="p-3 text-sm text-red-700">{error} <button onClick={() => setRetry(value => value + 1)}>Retry search</button></div>}
    {!loading && !error && !rows.length && <p className="p-4 text-sm">No matching contacts. Use Comprehensive for messages, campaigns and other fields.</p>}
    {rows.map(row => <button key={row.id} data-contact-id={row.id} onClick={() => void select(row.id)} className={`w-full border-b p-4 text-left ${selectedId === row.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
      <strong className="block">{row.name || 'Unnamed contact'}</strong><span className="block text-sm">{[row.company, row.city].filter(Boolean).join(' · ')}</span>
      <span className="block text-xs text-slate-500">{row.email || row.phone}{selecting === row.id ? ' · Opening…' : ''}</span>
    </button>)}
    {publishedKey === key && page.nextCursor && <button className="w-full p-4 font-semibold" disabled={loading} onClick={() => void more()}>Load more contacts</button>}
  </section>
}
