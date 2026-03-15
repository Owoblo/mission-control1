'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchPartners, saveJob } from '@/lib/api'
import { generateId } from '@/lib/store'
import type { Job, Partner } from '@/lib/types'

export default function TriggerPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [done, setDone] = useState(false)
  const [jobLink, setJobLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    moveDate: new Date().toISOString().slice(0, 10),
    moveFrom: '',
    moveTo: '',
    crewLead: '',
    referralPartnerId: '',
  })

  useEffect(() => {
    fetchPartners()
      .then(setPartners)
      .catch(err => setError((err as Error).message))
  }, [])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    try {
      const id = generateId()
      const partner = partners.find(item => item.id === form.referralPartnerId)
      const job: Job = {
        id,
        customerName: form.customerName.trim(),
        customerEmail: form.customerEmail.trim(),
        customerPhone: form.customerPhone.trim(),
        moveDate: form.moveDate,
        moveFrom: form.moveFrom.trim(),
        moveTo: form.moveTo.trim(),
        crewLead: form.crewLead.trim(),
        referralPartnerId: form.referralPartnerId || undefined,
        referralPartnerName: partner?.name,
        status: 'pending',
        feedbackRating: undefined,
        feedbackComment: undefined,
        reviews: { google: false, yelp: false, facebook: false, media: false },
        reviewConfirmedAt: {},
        incentiveEarned: false,
        incentivePaid: false,
        proofSentToPartner: false,
        createdAt: new Date().toISOString(),
        reviewSentAt: undefined,
      }

      await saveJob(job)
      setJobLink(`${window.location.origin}/review/${id}`)
      setDone(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(jobLink)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  function smsLink() {
    const message = encodeURIComponent(
      `Hi ${form.customerName}! Thank you for choosing Saturn Star Movers.\n\n` +
        `We'd love your feedback. This secure link works on any device:\n${jobLink}`
    )
    return `sms:${form.customerPhone}?body=${message}`
  }

  function emailLink() {
    const subject = encodeURIComponent('How was your move with Saturn Star?')
    const body = encodeURIComponent(
      `Hi ${form.customerName},\n\nThank you for trusting Saturn Star Movers with your move.\n\n` +
        `We'd love to hear how it went. You can share feedback here:\n\n${jobLink}\n\n` +
        `Thanks,\nSaturn Star Movers\n226-724-1730`
    )
    return `mailto:${form.customerEmail}?subject=${subject}&body=${body}`
  }

  function dayBeforeSmsLink() {
    const message = encodeURIComponent(
      `Hi ${form.customerName}! Your Saturn Star Moving crew arrives TOMORROW for your move from ${form.moveFrom} to ${form.moveTo}.\n\n` +
        `Please ensure clear access at both addresses. Any questions? Call/text us: 226-773-2993\n\nSee you tomorrow! — Saturn Star Movers`
    )
    return `sms:${form.customerPhone}?body=${message}`
  }

  function dayBeforeEmailLink() {
    const subject = encodeURIComponent('Your move is tomorrow — Saturn Star Moving')
    const body = encodeURIComponent(
      `Hi ${form.customerName},\n\nJust a reminder — your Saturn Star Moving crew arrives TOMORROW!\n\n` +
        `Move: ${form.moveFrom} → ${form.moveTo}\nDate: ${form.moveDate}\n\n` +
        `Please ensure clear access at both addresses and have any specialty items flagged.\n\n` +
        `Questions? Call or text us: 226-773-2993\n\nSee you tomorrow!\nSaturn Star Movers`
    )
    return `mailto:${form.customerEmail}?subject=${subject}&body=${body}`
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg animate-slide-up">
        <div className="card space-y-5 p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-3xl">
            OK
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Job saved</h2>
            <p className="mt-1 text-sm text-slate-400">
              Shared review link ready for <span className="text-white">{form.customerName}</span>
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-[#2D4A6A] bg-[#0F1B2D] p-4 text-left">
            <p className="text-xs uppercase tracking-wider text-slate-500">Customer Review Link</p>
            <p className="break-all font-mono text-sm text-gold">{jobLink}</p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              onClick={() => void copy()}
              className={`rounded-xl border py-2.5 text-sm font-medium transition-all ${
                copied
                  ? 'border-emerald-500 bg-emerald-900/20 text-emerald-400'
                  : 'border-[#2D4A6A] text-slate-300 hover:border-gold hover:text-gold'
              }`}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a href={smsLink()} className="rounded-xl border border-[#2D4A6A] py-2.5 text-center text-sm font-medium text-slate-300 transition-all hover:border-gold hover:text-gold">
              Text Customer
            </a>
            <a href={emailLink()} className="rounded-xl border border-[#2D4A6A] py-2.5 text-center text-sm font-medium text-slate-300 transition-all hover:border-gold hover:text-gold">
              Email Customer
            </a>
          </div>

          <div className="space-y-2 rounded-xl border border-[#2D4A6A] bg-[#0F1B2D] p-4 text-left">
            <p className="text-xs uppercase tracking-wider text-slate-500">Day-Before Reminder</p>
            <p className="text-sm text-slate-400">Send a heads-up the evening before the move.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {form.customerPhone ? (
                <a href={dayBeforeSmsLink()} className="rounded-xl border border-[#2D4A6A] py-2.5 text-center text-sm font-medium text-slate-300 transition-all hover:border-gold hover:text-gold">
                  Text Reminder
                </a>
              ) : null}
              {form.customerEmail ? (
                <a href={dayBeforeEmailLink()} className="rounded-xl border border-[#2D4A6A] py-2.5 text-center text-sm font-medium text-slate-300 transition-all hover:border-gold hover:text-gold">
                  Email Reminder
                </a>
              ) : null}
            </div>
          </div>

          <button
            onClick={() => {
              setDone(false)
              setCopied(false)
              setJobLink('')
              setForm({
                customerName: '',
                customerEmail: '',
                customerPhone: '',
                moveDate: new Date().toISOString().slice(0, 10),
                moveFrom: '',
                moveTo: '',
                crewLead: '',
                referralPartnerId: '',
              })
            }}
            className="btn-gold w-full"
          >
            Add Another Job
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Mark Job Complete</h1>
        <p className="mt-0.5 text-sm text-slate-400">Creates a shared review link customers can open from any device</p>
      </div>

      {error && (
        <div className="card mb-5 border-red-800/50 p-4 text-sm text-red-300">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="card space-y-4 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-gold">1</span>
            Customer Info
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">Full Name *</label>
              <input className="input" required value={form.customerName} onChange={event => set('customerName', event.target.value)} />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input className="input" required type="tel" value={form.customerPhone} onChange={event => set('customerPhone', event.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Email *</label>
              <input className="input" required type="email" value={form.customerEmail} onChange={event => set('customerEmail', event.target.value)} />
            </div>
          </div>
        </div>

        <div className="card space-y-4 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-gold">2</span>
            Move Details
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="label">Move Date *</label>
              <input className="input" required type="date" value={form.moveDate} onChange={event => set('moveDate', event.target.value)} />
            </div>
            <div>
              <label className="label">Moving From *</label>
              <input className="input" required value={form.moveFrom} onChange={event => set('moveFrom', event.target.value)} />
            </div>
            <div>
              <label className="label">Moving To *</label>
              <input className="input" required value={form.moveTo} onChange={event => set('moveTo', event.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Crew Lead *</label>
            <input className="input" required value={form.crewLead} onChange={event => set('crewLead', event.target.value)} />
          </div>
        </div>

        <div className="card space-y-4 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-gold">3</span>
            Referral Source <span className="font-normal text-slate-500">(optional)</span>
          </h2>
          <div>
            <label className="label">Who referred this customer?</label>
            <select className="input" value={form.referralPartnerId} onChange={event => set('referralPartnerId', event.target.value)}>
              <option value="">No referral / direct</option>
              {partners.map(partner => (
                <option key={partner.id} value={partner.id}>
                  {partner.name} ({partner.type})
                </option>
              ))}
            </select>
            {partners.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">
                No partners yet. <Link href="/partners" className="text-gold hover:underline">Add one</Link>
              </p>
            )}
          </div>
        </div>

        <button type="submit" className="btn-gold w-full py-3 text-base">
          Complete Job And Generate Review Link
        </button>
      </form>
    </div>
  )
}
