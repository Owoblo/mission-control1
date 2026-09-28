'use client'

import { useRef, useState } from 'react'
import { prepareUploadFile } from '@/lib/browser-media'
import type { CRMLead } from '@/lib/types'

export function InventoryPhotoUpload({ leadId, onSynced }: { leadId: string; onSynced: (lead: CRMLead) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [room, setRoom] = useState('')
  async function upload(files: File[]) {
    if (!files.length || busy) return
    setBusy(true)
    setNotice('Uploading and scanning photos…')
    let saved = 0
    const warnings: string[] = []
    try {
      for (const file of files) {
        const form = new FormData()
        form.set('purpose', 'customer_media')
        form.set('room', room.trim() || 'Unassigned')
        form.set('notes', 'Customer photos uploaded during inventory review')
        form.append('files', await prepareUploadFile(file))
        const response = await fetch(`/api/sales/leads/${leadId}/media-upload`, { method: 'POST', body: form, credentials: 'include' })
        const result = await response.json() as { lead?: CRMLead; error?: string; analyzeWarning?: string }
        if (!response.ok || result.error || !result.lead) throw new Error(result.error || `Upload failed (${response.status})`)
        saved++
        onSynced(result.lead)
        if (result.analyzeWarning) warnings.push(result.analyzeWarning)
        setNotice(`${saved} of ${files.length} photos saved…`)
      }
      setNotice(`${saved} photo${saved === 1 ? '' : 's'} saved. Review detected items below and verify the final inventory.${warnings.length ? ` ${warnings.join(' ')}` : ''}`)
    } catch (error) {
      setNotice(`${saved ? `${saved} photo(s) saved. ` : ''}${error instanceof Error ? error.message : 'Upload failed.'} Retry the remaining photos.`)
    } finally {
      setBusy(false)
    }
  }
  return <div className="mt-3 rounded-[7px] border border-[var(--app-line)] bg-white p-3">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs">Room (optional)<input value={room} disabled={busy} onChange={event => setRoom(event.target.value)} placeholder="e.g. Living room" className="crm-input ml-2 py-1.5 text-xs" /></label>
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-[6px] bg-[#071421] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{busy ? 'Uploading photos…' : '+ Upload customer photos'}</button>
      <input ref={input} type="file" accept="image/*,.heic,.heif" multiple className="hidden" aria-label="Upload customer inventory photos" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files) }} />
    </div>
    <p className="mt-2 text-xs text-[var(--app-muted)]">Photos are saved to this move and scanned for inventory here.</p>
    {notice ? <p role="status" className="mt-2 text-xs">{notice}</p> : null}
  </div>
}
