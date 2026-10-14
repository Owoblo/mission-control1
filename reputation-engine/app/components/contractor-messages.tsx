'use client'
import { useEffect, useState } from 'react'

type Message = { id: string; from_number: string; to_number: string; body: string; direction: string; created_at: string }
export default function ContractorMessages({ endpoint }: { endpoint: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch(`${endpoint}/messages`, { cache: 'no-store' })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'Could not load messages')
        if (active) { setMessages(body.messages); setError('') }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not load messages') }
      finally { if (active) setLoading(false) }
    }
    setLoading(true)
    void load()
    const timer = setInterval(load, 15000)
    return () => { active = false; clearInterval(timer) }
  }, [endpoint, refresh])
  return <section className="space-y-4 rounded-2xl border bg-white p-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">Text messages</h2><p className="text-xs text-slate-500">Latest 200 messages · refreshes every 15 seconds</p></div><button onClick={() => setRefresh(value => value + 1)} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {loading && <p className="text-sm text-slate-500">Loading messages…</p>}
    {!loading && !error && !messages.length && <p className="text-sm text-slate-500">No text messages recorded for this contractor's phone number.</p>}
    <div className="space-y-3">{messages.map(message => <article key={message.id} className={`max-w-3xl rounded-xl p-4 ${message.direction === 'outbound' ? 'ml-auto bg-blue-50' : 'mr-auto bg-slate-100'}`}>
      <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-600"><b>{message.direction === 'outbound' ? 'Saturn Star Movers →' : 'Received from'} {message.direction === 'outbound' ? message.to_number : message.from_number}</b><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' })} ET</time></div>
      <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
    </article>)}</div>
  </section>
}
