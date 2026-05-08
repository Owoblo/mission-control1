'use client'

import { useEffect, useState } from 'react'
import { fetchPartners, removePartner, savePartner } from '@/lib/api'
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
    <div className="animate-fade-in space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Referral Partners</h1>
          <p className="mt-0.5 text-sm text-slate-400">Shared partner directory with live referral counts</p>
        </div>
        <button onClick={openAdd} className="btn-gold">Add Partner</button>
      </div>

      {error && <div className="card border-red-800/50 p-4 text-sm text-red-300">{error}</div>}

      {partners.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="mb-3 text-4xl">[]</div>
          <p className="text-slate-400">No partners yet.</p>
          <button onClick={openAdd} className="btn-gold mx-auto mt-4">Add Your First Partner</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {partners.map(partner => (
            <div key={partner.id} className="card space-y-4 p-5 transition-all hover:border-[#3D5A7A]">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-white">{partner.name}</p>
                  {partner.company && <p className="text-xs text-slate-500">{partner.company}</p>}
                  <span className="badge badge-pending mt-1">{TYPE_LABELS[partner.type]}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(partner)} className="rounded-lg px-2 py-1 text-xs text-slate-500 transition-all hover:bg-navy-2 hover:text-white">
                    Edit
                  </button>
                  <button onClick={() => void remove(partner.id)} className="rounded-lg px-2 py-1 text-xs text-slate-600 transition-all hover:bg-red-900/20 hover:text-red-400">
                    Delete
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <a href={`mailto:${partner.email}`} className="flex items-center gap-1.5 text-xs text-slate-400 transition-all hover:text-gold">
                  {partner.email}
                </a>
                {partner.phone && (
                  <a href={`tel:${partner.phone}`} className="flex items-center gap-1.5 text-xs text-slate-400 transition-all hover:text-gold">
                    {partner.phone}
                  </a>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-[#2D4A6A] pt-1">
                <div className="text-center">
                  <p className="text-lg font-bold text-white">{partner.totalJobsReferred}</p>
                  <p className="text-xs text-slate-500">Jobs Sent</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-gold">${partner.totalIncentiveOwed * 50}</p>
                  <p className="text-xs text-slate-500">Reward Exposure</p>
                </div>
              </div>

              <button onClick={() => openProof(partner)} className="w-full rounded-lg border border-[#2D4A6A] py-2 text-xs text-slate-400 transition-all hover:border-gold hover:text-gold">
                Send Proof Package
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md space-y-5 p-6 animate-slide-up">
            <h3 className="text-lg font-bold text-white">{editing ? 'Edit Partner' : 'Add Partner'}</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" required value={form.name} onChange={event => set('name', event.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type *</label>
                  <select className="input" value={form.type} onChange={event => set('type', event.target.value as PartnerType)}>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Company</label>
                  <input className="input" value={form.company} onChange={event => set('company', event.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Email *</label>
                <input className="input" required type="email" value={form.email} onChange={event => set('email', event.target.value)} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" type="tel" value={form.phone} onChange={event => set('phone', event.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModal(false)} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" className="btn-gold flex-1">{editing ? 'Save Changes' : 'Add Partner'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {proofModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg space-y-4 p-6 animate-slide-up">
            <div>
              <h3 className="text-lg font-bold text-white">Send Proof Package</h3>
              <p className="text-sm text-slate-400">
                To: <span className="text-white">{proofModal.name}</span> · {proofModal.email}
              </p>
            </div>
            <div>
              <label className="label">Email Body</label>
              <textarea className="input min-h-[200px] resize-none font-mono text-xs" value={proofText} onChange={event => setProofText(event.target.value)} />
            </div>
            <p className="text-xs text-slate-500">This opens your mail client so you can attach screenshots before sending.</p>
            <div className="flex gap-2">
              <button onClick={() => setProofModal(null)} className="btn-ghost flex-1">Cancel</button>
              <button onClick={sendProof} className="btn-gold flex-1">Open Email Client</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
