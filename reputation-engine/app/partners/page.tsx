'use client'

import { useEffect, useState } from 'react'
import { Edit3, Mail, Phone, Plus, Send, Trash2, X } from 'lucide-react'
import { fetchPartners, removePartner, savePartner } from '@/lib/api'
import { formatCadFromCents, REFERRAL_INCENTIVE_PER_JOB_CENTS } from '@/lib/partnership-constants'
import { generateId } from '@/lib/store'
import type { Partner, PartnerType } from '@/lib/types'

const TYPE_LABELS: Record<PartnerType, string> = {
  realtor: 'Realtor',
  'property-manager': 'Property Manager',
  builder: 'Builder',
  'supply-chain': 'Supply Chain',
  other: 'Other',
}

const BLANK = { name: '', type: 'realtor' as PartnerType, email: '', phone: '', company: '' }

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const [form, setForm] = useState(BLANK)
  const [proofModal, setProofModal] = useState<Partner | null>(null)
  const [proofText, setProofText] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    try {
      setPartners(await fetchPartners())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function openAdd() {
    setEditing(null)
    setForm(BLANK)
    setModal(true)
  }

  function openEdit(partner: Partner) {
    setEditing(partner)
    setForm({
      name: partner.name,
      type: partner.type,
      email: partner.email,
      phone: partner.phone ?? '',
      company: partner.company ?? '',
    })
    setModal(true)
  }

  function set<K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()

    const partner: Partner = {
      id: editing?.id ?? generateId(),
      name: form.name.trim(),
      type: form.type,
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      company: form.company.trim() || undefined,
      totalJobsReferred: editing?.totalJobsReferred ?? 0,
      totalIncentiveOwed: editing?.totalIncentiveOwed ?? 0,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    }

    try {
      await savePartner(partner)
      setModal(false)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this partner?')) return
    await removePartner(id)
    await refresh()
  }

  function openProof(partner: Partner) {
    setProofModal(partner)
    setProofText(
      `Hi ${partner.name},\n\nOne of your referred clients completed their review follow-up with Saturn Star Movers.\n\n` +
        `We appreciate you sending clients our way. If you have anyone else planning a move, we'd love to help.\n\n` +
        `Thanks again,\nSaturn Star Movers\n226-773-2993`
    )
  }

  function sendProof() {
    if (!proofModal) return
    const subject = encodeURIComponent('Your client completed their review follow-up')
    const body = encodeURIComponent(proofText)
    window.open(`mailto:${proofModal.email}?subject=${subject}&body=${body}`)
    setProofModal(null)
  }

  return (
    <div className="crm-shell animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1a2744]">Referral Partners</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">Shared partner directory with live referral counts.</p>
        </div>
        <button onClick={openAdd} className="crm-button-dark gap-2">
          <Plus className="h-4 w-4" />
          Add Partner
        </button>
      </div>

      {error && <div className="crm-panel border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}

      {partners.length === 0 ? (
        <div className="crm-panel p-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] text-[#1a2744]">
            <Plus className="h-5 w-5" />
          </div>
          <p className="font-semibold text-[#1a2744]">No partners yet.</p>
          <p className="mt-1 text-sm text-[var(--app-muted)]">Add the first referral partner to start tracking jobs and reward exposure.</p>
          <button onClick={openAdd} className="crm-button-dark mx-auto mt-5 gap-2">
            <Plus className="h-4 w-4" />
            Add First Partner
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {partners.map(partner => (
            <div key={partner.id} className="crm-panel space-y-4 transition hover:border-[#cfd6d1]">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-[#1a2744]">{partner.name}</p>
                  {partner.company && <p className="mt-0.5 text-xs text-[var(--app-muted)]">{partner.company}</p>}
                  <span className="crm-chip mt-2">{TYPE_LABELS[partner.type]}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(partner)} className="rounded-[4px] p-2 text-[var(--app-muted)] transition hover:bg-[var(--app-bg)] hover:text-[#1a2744]" aria-label={`Edit ${partner.name}`}>
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button onClick={() => void remove(partner.id)} className="rounded-[4px] p-2 text-[var(--app-muted)] transition hover:bg-rose-50 hover:text-rose-600" aria-label={`Delete ${partner.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <a href={`mailto:${partner.email}`} className="flex items-center gap-2 text-xs text-[var(--app-muted)] transition hover:text-[#1a2744]">
                  <Mail className="h-3.5 w-3.5" />
                  {partner.email}
                </a>
                {partner.phone && (
                  <a href={`tel:${partner.phone}`} className="flex items-center gap-2 text-xs text-[var(--app-muted)] transition hover:text-[#1a2744]">
                    <Phone className="h-3.5 w-3.5" />
                    {partner.phone}
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-[var(--app-line)] pt-3">
                <div className="rounded-[8px] bg-[var(--app-bg)] p-3 text-center">
                  <p className="text-lg font-bold text-[#1a2744]">{partner.totalJobsReferred}</p>
                  <p className="text-xs text-[var(--app-muted)]">Jobs Sent</p>
                </div>
                <div className="rounded-[8px] bg-[var(--app-bg)] p-3 text-center">
                  <p className="text-lg font-bold text-[#1a2744]">{formatCadFromCents(partner.totalIncentiveOwed * REFERRAL_INCENTIVE_PER_JOB_CENTS)}</p>
                  <p className="text-xs text-[var(--app-muted)]">Reward Exposure</p>
                </div>
              </div>

              <button onClick={() => openProof(partner)} className="crm-button w-full gap-2 text-xs">
                <Send className="h-3.5 w-3.5" />
                Send Proof Package
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="crm-panel w-full max-w-md space-y-5 animate-slide-up">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-[#1a2744]">{editing ? 'Edit Partner' : 'Add Partner'}</h3>
              <button type="button" onClick={() => setModal(false)} className="rounded-[4px] p-2 text-[var(--app-muted)] hover:bg-[var(--app-bg)] hover:text-[#1a2744]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="crm-label">Full Name *</label>
                <input className="crm-input mt-2" required value={form.name} onChange={event => set('name', event.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="crm-label">Type *</label>
                  <select className="crm-input mt-2" value={form.type} onChange={event => set('type', event.target.value as PartnerType)}>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="crm-label">Company</label>
                  <input className="crm-input mt-2" value={form.company} onChange={event => set('company', event.target.value)} />
                </div>
              </div>
              <div>
                <label className="crm-label">Email *</label>
                <input className="crm-input mt-2" required type="email" value={form.email} onChange={event => set('email', event.target.value)} />
              </div>
              <div>
                <label className="crm-label">Phone</label>
                <input className="crm-input mt-2" type="tel" value={form.phone} onChange={event => set('phone', event.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModal(false)} className="crm-button flex-1">Cancel</button>
                <button type="submit" className="crm-button-dark flex-1">{editing ? 'Save Changes' : 'Add Partner'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {proofModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="crm-panel w-full max-w-lg space-y-4 animate-slide-up">
            <div>
              <h3 className="text-lg font-bold text-[#1a2744]">Send Proof Package</h3>
              <p className="text-sm text-[var(--app-muted)]">
                To: <span className="font-medium text-[#1a2744]">{proofModal.name}</span> · {proofModal.email}
              </p>
            </div>
            <div>
              <label className="crm-label">Email Body</label>
              <textarea className="crm-input mt-2 min-h-[200px] resize-none font-mono text-xs" value={proofText} onChange={event => setProofText(event.target.value)} />
            </div>
            <p className="text-xs text-[var(--app-muted)]">This opens your mail client so you can attach screenshots before sending.</p>
            <div className="flex gap-2">
              <button onClick={() => setProofModal(null)} className="crm-button flex-1">Cancel</button>
              <button onClick={sendProof} className="crm-button-dark flex-1">Open Email Client</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
