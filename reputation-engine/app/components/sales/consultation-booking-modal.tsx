'use client'

import { useState } from 'react'
import type { CRMLead } from '@/lib/types'

const TRIGGER_REASONS = [
  'Customer requested in-person visit',
  'Move likely over $2,500',
  'Senior or older customer',
  'Two-truck move',
  'Long-distance move',
  'Large home (4+ bedrooms)',
  'Complex access (stairs, elevator, long carry)',
  'High-value or fragile items',
  'Packing required',
  'Customer hesitant to book over phone',
  'Other',
]

interface Props {
  lead: CRMLead
  salesUsers: Array<{ id: string; name: string; role?: string }>
  onClose: () => void
  onConfirm: (data: {
    estimateDate: string
    estimateTime: string
    consultationTriggerReason: string
    consultationAssignedManagerName: string
    consultationAssignedManagerId: string
    consultationCustomerConcern: string
    consultationPreVisitBrief: string
    sendSms: boolean
  }) => void
}

function buildPreVisitBrief(lead: CRMLead, managerName: string, triggerReason: string, date: string, time: string): string {
  const firstName = lead.name?.split(' ')[0] || 'Customer'
  const included = (lead.inventory || []).filter(i => i.included !== false).slice(0, 10)
  const inventoryLine = included.length > 0
    ? included.map(i => `${i.qty || 1}x ${i.name || i.item}`).join(', ')
    : 'Not yet scanned — review on arrival'
  const rooms = lead.roomBreakdown ? Object.keys(lead.roomBreakdown).join(', ') : ''
  const route = [
    lead.originAddress || lead.originCity,
    lead.destAddress || lead.destCity,
  ].filter(Boolean).join(' → ')

  const lines = [
    `IN-HOME CONSULTATION BRIEF`,
    `Customer: ${lead.name || 'Unknown'} | ${lead.phone || 'no phone'}`,
    `Move date: ${lead.moveDate || 'TBD'} | Route: ${route || 'TBD'}`,
    `Move type: ${lead.moveType || 'residential'}`,
    ``,
    `APPOINTMENT`,
    `Date: ${date}${time ? ` at ${time}` : ''}`,
    `Assigned: ${managerName || 'TBD'}`,
    `Reason for visit: ${triggerReason}`,
    ``,
    `PRELIMINARY INVENTORY`,
    inventoryLine,
    rooms ? `Rooms noted: ${rooms}` : '',
    ``,
    `WHAT TO VERIFY ON-SITE`,
    `□ Confirm all items going (walk every room)`,
    `□ Basement / garage / outdoor items`,
    `□ Appliances — confirm which are moving`,
    `□ Boxes estimate — packing themselves or need help?`,
    `□ Heavy/fragile: piano, safe, gym equipment`,
    `□ Driveway access — truck can park close?`,
    `□ Stairs, elevator, long carry at origin`,
    `□ Destination access — condo rules, elevator booking?`,
    `□ Move date flexible or fixed?`,
    `□ Closing date / key handoff time`,
    `□ Damage concerns, past experience, insurance questions`,
    ``,
    `CUSTOMER NOTES`,
    lead.notes || 'None on file',
  ].filter(l => l !== undefined)

  return lines.join('\n')
}

export function ConsultationBookingModal({ lead, salesUsers, onClose, onConfirm }: Props) {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultDate = tomorrow.toISOString().slice(0, 10)

  const [date, setDate] = useState(lead.estimateDate || defaultDate)
  const [time, setTime] = useState(lead.estimateTime || '10:00')
  const [triggerReason, setTriggerReason] = useState(TRIGGER_REASONS[0])
  const [managerId, setManagerId] = useState('')
  const [managerName, setManagerName] = useState('')
  const [concern, setConcern] = useState('')
  const [sendSms, setSendSms] = useState(!!lead.phone)
  const [step, setStep] = useState<'book' | 'brief'>('book')

  const brief = buildPreVisitBrief(lead, managerName, triggerReason, date, time)

  function handleManagerChange(userId: string) {
    setManagerId(userId)
    const user = salesUsers.find(u => u.id === userId)
    setManagerName(user?.name || '')
  }

  function handleConfirm() {
    onConfirm({
      estimateDate: date,
      estimateTime: time,
      consultationTriggerReason: triggerReason,
      consultationAssignedManagerName: managerName,
      consultationAssignedManagerId: managerId,
      consultationCustomerConcern: concern,
      consultationPreVisitBrief: brief,
      sendSms,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-none overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#071421] px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50">New appointment</div>
              <div className="mt-1 text-lg font-bold text-white">In-Home Move Consultation</div>
            </div>
            <button onClick={onClose} className="rounded-xl p-1.5 text-white/40 hover:bg-white/10 hover:text-white transition-colors">✕</button>
          </div>
          {/* Step tabs */}
          <div className="mt-4 flex gap-2">
            {(['book', 'brief'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${step === s ? 'bg-white text-[#071421]' : 'text-white/60 hover:text-white'}`}
              >
                {s === 'book' ? '1. Book Appointment' : '2. Pre-Visit Brief'}
              </button>
            ))}
          </div>
        </div>

        {step === 'book' ? (
          <div className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</span>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="crm-input w-full" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Time</span>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} className="crm-input w-full" />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Assigned Manager</span>
              <select value={managerId} onChange={e => handleManagerChange(e.target.value)} className="crm-input w-full">
                <option value="">Select manager…</option>
                {salesUsers.filter(u => u.role === 'owner' || u.role === 'manager').map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
                {salesUsers.filter(u => u.role !== 'owner' && u.role !== 'manager').map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason for In-Person Visit</span>
              <select value={triggerReason} onChange={e => setTriggerReason(e.target.value)} className="crm-input w-full">
                {TRIGGER_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer Concern (optional)</span>
              <input
                type="text"
                value={concern}
                onChange={e => setConcern(e.target.value)}
                placeholder="e.g. worried about damage to antique furniture"
                className="crm-input w-full"
              />
            </label>

            {lead.phone && (
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
                <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} className="h-4 w-4 rounded accent-[#071421]" />
                <div>
                  <div className="text-sm font-medium text-[#071421]">Send confirmation SMS to customer</div>
                  <div className="text-xs text-slate-500 mt-0.5">Premium In-Home Consultation language — date, time, and manager included</div>
                </div>
              </label>
            )}

            <button
              onClick={() => setStep('brief')}
              className="w-full rounded-[10px] bg-[#071421] py-2.5 text-sm font-semibold text-white hover:bg-[#071421] transition-colors"
            >
              Preview Pre-Visit Brief →
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="text-xs text-slate-500">Auto-generated from listing photos + lead data. Manager opens this before arriving.</div>
            <textarea
              value={brief}
              readOnly
              rows={14}
              className="w-full rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] font-mono text-slate-700 resize-none"
            />
            <div className="flex gap-3">
              <button onClick={() => setStep('book')} className="flex-1 rounded-[10px] border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                ← Edit Details
              </button>
              <button
                onClick={handleConfirm}
                disabled={!date}
                className="flex-2 flex-1 rounded-[10px] bg-[#C99700] py-2.5 text-sm font-bold text-[#071421] hover:bg-[#e09420] disabled:opacity-50 transition-colors"
              >
                Book Consultation {sendSms ? '+ Send SMS' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
