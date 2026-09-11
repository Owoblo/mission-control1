'use client'

import { useEffect, useState } from 'react'
import { PartnerReferralSelector } from './partner-referral-selector'
import type { PartnerDirectoryEntry } from '@/lib/partner-directory'
import type { AcquisitionInterview, AcquisitionInterviewDraft } from '@/lib/acquisition-interview'

const blank: AcquisitionInterviewDraft = { status: 'answered', channel: 'unknown', customerWords: '', postcardRoute: 'unknown', postcardLocation: '', postcardCode: '', connectorId: '', connectorRole: 'unknown' }
export function AcquisitionInterviewPanel({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  const [saved, setSaved] = useState<AcquisitionInterview | null>(null)
  const [draft, setDraft] = useState(blank)
  const [connector, setConnector] = useState<PartnerDirectoryEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setNotice('')
    fetch(`/api/sales/leads/${encodeURIComponent(leadId)}/acquisition`, { signal: controller.signal, credentials: 'include' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d })
      .then(d => { setSaved(d.interview); setDraft(d.interview || blank); setCanEdit(d.canEdit); setConnector(d.interview?.connectorId ? { id: d.interview.connectorId, name: d.interview.connectorName, company: d.interview.connectorCompany } : null) })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [leadId, reload])
  const set = (field: keyof AcquisitionInterviewDraft, value: string) => { setDraft(d => ({ ...d, [field]: value })); setNotice('') }
  async function save() {
    setSaving(true); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/sales/leads/${encodeURIComponent(leadId)}/acquisition`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interview: { ...draft, connectorId: connector?.id || '' }, expectedRevision: saved?.revision || 0 }) })
      const data = await r.json(); if (!r.ok) throw new Error(data.error)
      setSaved(data.interview); setDraft(data.interview)
      setConnector(data.interview.connectorId ? { id: data.interview.connectorId, name: data.interview.connectorName, company: data.interview.connectorCompany } : null)
      setNotice('Source details saved.')
    } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  return <section className="border-b border-[var(--app-line)] p-5" aria-label="Connector and postcard source">
    <h2 className="crm-label">Connector & postcard source</h2>
    <p className="mt-2 text-sm font-medium">“How did you first hear about us? If you saw our postcard, where did you get it—and did someone pass it to you?”</p>
    <p className="mt-2 text-xs text-[var(--app-muted)]">{saved ? `Recorded by ${saved.recordedBy} · ${new Date(saved.recordedAt).toLocaleDateString()}` : 'Not asked yet — capture the answer during the conversation.'}</p>
    {loading ? <p role="status" className="mt-3 text-sm">Loading source details…</p> : <details className="mt-3" open={undefined}>
      <summary className="cursor-pointer text-sm font-semibold">{saved ? 'Review / update the answer' : 'Record the answer'}</summary>
      <fieldset disabled={disabled || !canEdit || saving} className="mt-3 grid gap-3">
        <label className="text-xs">Customer response<select aria-label="Customer response" className="crm-input mt-1" value={draft.status} onChange={e => set('status', e.target.value)}><option value="answered">Answered</option><option value="does_not_recall">Does not recall</option><option value="declined">Prefers not to answer</option></select></label>
        {draft.status === 'answered' && <>
          <label className="text-xs">How they heard about us<select aria-label="Discovery channel" className="crm-input mt-1" value={draft.channel} onChange={e => set('channel', e.target.value)}>{[['unknown','Not sure'],['postcard','Postcard / card'],['connector','Someone recommended us'],['search','Search / website'],['social','Social media'],['existing_customer','Previous customer'],['other','Other']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-xs">How the postcard reached them, if applicable<select aria-label="Postcard delivery" className="crm-input mt-1" value={draft.postcardRoute} onChange={e => set('postcardRoute', e.target.value)}>{[['unknown','Not known / not applicable'],['home_mail','Mailed to their home'],['work_mail','Mailed to their workplace'],['handed_by_connector','Handed to them by someone'],['building_display','Picked up in a building / office'],['forwarded_digitally','Forwarded by text or email'],['other','Other']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-xs">Where did they receive it?<input aria-label="Postcard received location" className="crm-input mt-1" maxLength={300} placeholder="City, building, office or address they mention" value={draft.postcardLocation} onChange={e => set('postcardLocation', e.target.value)} /></label>
          <label className="text-xs">Printed card code / description, if available<input aria-label="Postcard code" className="crm-input mt-1" maxLength={120} placeholder="Leave blank if unknown" value={draft.postcardCode} onChange={e => set('postcardCode', e.target.value)} /></label>
          <div className="text-xs">Who connected them with us?<div className="mt-1"><PartnerReferralSelector value={connector} disabled={disabled || saving || !canEdit} onChange={value => { setConnector(value); setNotice('') }} /></div></div>
          <label className="text-xs">Connector’s role<select aria-label="Connector role" className="crm-input mt-1" value={draft.connectorRole} onChange={e => set('connectorRole', e.target.value)}><option value="unknown">Not established</option><option value="referred_customer">Recommended / referred us</option><option value="passed_card">Passed along the card</option><option value="assisted">Helped with the introduction</option></select></label>
        </>}
        <label className="text-xs">Customer’s words / context<textarea aria-label="Customer source answer" className="crm-input mt-1" rows={3} maxLength={2000} value={draft.customerWords} onChange={e => set('customerWords', e.target.value)} placeholder="Record their answer without guessing." /></label>
        <button type="button" className="crm-button-dark text-sm" onClick={save}>{saving ? 'Saving…' : 'Save source details'}</button>
      </fieldset>
    </details>}
    {error && <div role="alert" className="mt-3 text-xs text-red-700">{error} <button type="button" className="underline" onClick={() => setReload(n => n + 1)}>Reload saved answer</button></div>}
    {notice && <p role="status" className="mt-3 text-xs text-green-700">{notice}</p>}
  </section>
}
