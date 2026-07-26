'use client'

import { useCallback, useEffect, useState } from 'react'

type Evidence = {
  id: string
  room: string
  item_name: string
  quantity: number
  disposition: 'moving' | 'staying' | 'uncertain'
  confidence?: number
  estimated_cubic_feet?: number
  estimated_weight_lbs?: number
  transcript_excerpt?: string
  review_status: 'pending' | 'approved' | 'rejected' | 'merged' | 'edited'
  offset_ms?: number
  duplicate_group_id?: string
}

export function VideoSurveyReviewPanel({ sessionId }: { sessionId: string }) {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [verificationUrl, setVerificationUrl] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/sales/video-surveys/${encodeURIComponent(sessionId)}/review`, { cache: 'no-store' })
      const data = await response.json()
      if (response.ok) setEvidence(data.evidence || [])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(interval)
  }, [load])

  async function decide(item: Evidence, reviewStatus: 'approved' | 'rejected') {
    setBusyId(item.id)
    setNotice(null)
    try {
      const response = await fetch(`/api/sales/video-surveys/${encodeURIComponent(sessionId)}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evidenceId: item.id, reviewStatus }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save review decision.')
      setEvidence(current => current.map(entry => entry.id === item.id ? data.evidence : entry))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save review decision.')
    } finally {
      setBusyId(null)
    }
  }

  async function applyApproved() {
    setApplying(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/sales/video-surveys/${encodeURIComponent(sessionId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_approved_inventory' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not apply inventory.')
      setNotice(`${data.applied} reviewed item${data.applied === 1 ? '' : 's'} applied to the lead. Customer confirmation is still required.`)
      setVerificationUrl(data.verificationUrl || '')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not apply inventory.')
    } finally {
      setApplying(false)
    }
  }

  const unresolved = evidence.filter(item => item.review_status === 'pending' || item.disposition === 'uncertain').length
  const approved = evidence.filter(item => ['approved', 'edited'].includes(item.review_status) && item.disposition === 'moving').length

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">AI inventory evidence</h3>
          <p className="mt-0.5 text-[10px] text-slate-500">Review required—AI never edits the quote directly.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold">{loading ? '…' : evidence.length}</span>
      </div>
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {evidence.map(item => (
          <div key={item.id} className={`rounded-xl border p-3 text-xs ${item.review_status === 'approved' ? 'border-emerald-200 bg-emerald-50' : item.review_status === 'rejected' ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{item.quantity > 1 ? `${item.quantity} × ` : ''}{item.item_name}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">{item.room} · {Math.round(Number(item.confidence || 0) * 100)}% confidence{item.offset_ms != null ? ` · ${Math.floor(item.offset_ms / 60000)}:${String(Math.floor((item.offset_ms % 60000) / 1000)).padStart(2, '0')}` : ''}</div>
                <div className="mt-1 text-[10px] text-slate-600">{Number(item.estimated_cubic_feet || 0)} cu ft · {Number(item.estimated_weight_lbs || 0)} lb · {item.disposition}</div>
                {item.transcript_excerpt && <div className="mt-1 line-clamp-2 text-[10px] italic text-slate-500">{item.transcript_excerpt}</div>}
                {item.duplicate_group_id && <div className="mt-1 text-[10px] font-semibold text-amber-700">Possible repeated sighting grouped</div>}
              </div>
            </div>
            {item.review_status === 'pending' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button disabled={busyId === item.id || item.disposition === 'uncertain'} onClick={() => void decide(item, 'approved')} className="rounded-lg bg-[#0b7055] px-2 py-2 font-semibold text-white disabled:opacity-40">Approve</button>
                <button disabled={busyId === item.id} onClick={() => void decide(item, 'rejected')} className="rounded-lg border border-slate-300 bg-white px-2 py-2 font-semibold">Reject</button>
              </div>
            )}
          </div>
        ))}
        {!loading && evidence.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Evidence will appear here after the recording finishes and analysis completes.</div>}
      </div>
      {evidence.length > 0 && (
        <button onClick={() => void applyApproved()} disabled={applying || unresolved > 0 || approved === 0} className="mt-3 w-full rounded-xl bg-[#071421] px-3 py-3 text-xs font-semibold text-white disabled:opacity-40">
          {applying ? 'Applying…' : unresolved > 0 ? `Resolve ${unresolved} item${unresolved === 1 ? '' : 's'} first` : `Apply ${approved} approved item${approved === 1 ? '' : 's'} to lead`}
        </button>
      )}
      {notice && <div className="mt-2 rounded-lg bg-slate-100 p-2 text-[10px] leading-4 text-slate-700">{notice}</div>}
      {verificationUrl && (
        <button
          onClick={() => void navigator.clipboard.writeText(verificationUrl).then(() => setNotice('Customer verification link copied.'))}
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs font-semibold"
        >
          Copy customer confirmation link
        </button>
      )}
    </div>
  )
}
