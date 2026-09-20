'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Building2, Check, CheckCircle2, FileText, Loader2, Medal, Wallet } from 'lucide-react'

type Invite = {
  stage: string
  application: Record<string, string> | null
  checklist: Record<string, boolean> | null
  agreementVersion: string | null
  agreementAcceptedAt: string | null
  stripeStatus: string | null
  brandAcknowledgedAt: string | null
}

const STEPS = [
  { id: 'application', label: 'Company details', icon: Building2 },
  { id: 'agreement', label: 'Agreement', icon: FileText },
  { id: 'brand', label: 'Service standards', icon: Medal },
  { id: 'payout', label: 'Payout setup', icon: Wallet },
] as const

const FIELD_LABELS: Array<{ key: string; label: string; type?: string; hint?: string }> = [
  { key: 'legalBusinessName', label: 'Legal business name' },
  { key: 'contactName', label: 'Your full name' },
  { key: 'phone', label: 'Phone number', type: 'tel' },
  { key: 'homeMarket', label: 'Home market', hint: 'The city or area you normally work in.' },
  { key: 'services', label: 'Services you offer', hint: 'For example: local moves, long-distance, packing, junk removal.' },
  { key: 'capacity', label: 'Weekly capacity', hint: 'Roughly how many jobs you can take on per week.' },
]

function stageIndex(invite: Invite): number {
  if (invite.stage === 'trial') return 4
  if (invite.stage === 'payout_setup') return 3
  if (invite.stage === 'verification') return 1
  return 0
}

const AGREEMENT_POINTS = [
  ['Independent contractor', 'You work with Saturn Star Movers as an independent contractor, not an employee. You control your own schedule, crew, and equipment.'],
  ['Insurance', 'You carry your own commercial liability and vehicle insurance, and keep proof of coverage on file with us.'],
  ['Service standards', 'Jobs are done on time, handled with care, and communicated clearly. Repeated no-shows or damage claims can end the partnership.'],
  ['Getting paid', 'Payouts go to the bank account you connect through Stripe. Rates are agreed per job before you accept it.'],
  ['Ending the partnership', 'Either side can end the partnership at any time. Completed, accepted jobs are still paid out.'],
]

const BRAND_POINTS = [
  'Show up in clean, unbranded or Saturn-approved gear — never in a competitor\'s branding.',
  'Confirm arrival windows with the customer the day before the job.',
  'Photograph the job at arrival and at completion, every time.',
  'If anything goes wrong, tell operations immediately — never hide damage.',
  'Leave every home cleaner than you found the work area.',
]

export default function Onboard() {
  const { token } = useParams<{ token: string }>()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [broken, setBroken] = useState(false)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'ok' | 'err'>('ok')
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({
    legalBusinessName: '', contactName: '', phone: '', homeMarket: '', services: '', capacity: '',
  })
  const [signatory, setSignatory] = useState('')
  const [activeStep, setActiveStep] = useState(0)

  async function load() {
    try {
      const r = await fetch(`/api/onboarding/${token}`)
      const b = await r.json()
      if (!r.ok) { setBroken(true); return }
      const inv = b.invite as Invite
      setInvite(inv)
      if (inv.application) setForm(f => ({ ...f, ...inv.application }))
      setActiveStep(Math.min(stageIndex(inv), 3))
    } catch {
      setBroken(true)
    }
  }

  useEffect(() => { void load() }, [token])

  function note(text: string, tone: 'ok' | 'err' = 'ok') {
    setMessage(text)
    setMessageTone(tone)
  }

  async function run(action: string, extra: Record<string, unknown>, label: string) {
    setBusy(label)
    note('')
    try {
      const r = await fetch(`/api/onboarding/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const b = await r.json().catch(() => null)
      if (!r.ok) { note(b?.error || 'Something went wrong. Please try again.', 'err'); return }
      await load()
      note('Saved.')
    } catch {
      note('Could not reach the server. Check your connection and try again.', 'err')
    } finally {
      setBusy(null)
    }
  }

  if (broken) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center p-6">
        <div className="w-full rounded-2xl border bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FEF2F2] text-[#B42318]">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-[#071421]">This link doesn&apos;t work anymore</h1>
          <p className="mt-2 text-sm leading-6 text-[#667085]">
            The onboarding link is invalid or has expired. Ask your Saturn Star contact to send you a fresh one,
            or call us at <a className="font-semibold text-[#071421] underline" href="tel:+12267732993">226-773-2993</a>.
          </p>
        </div>
      </main>
    )
  }

  if (!invite) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl items-center justify-center p-6">
        <p className="flex items-center gap-2 text-sm text-[#667085]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your onboarding…
        </p>
      </main>
    )
  }

  const done = invite.stage === 'trial'
  const checklist = invite.checklist || {}

  return (
    <main className="min-h-screen bg-[#F9FAFB]">
      <div className="mx-auto max-w-xl space-y-5 p-6 pb-16">
        <header>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8a6800]">Saturn Star Partner Network</p>
          <h1 className="mt-1 text-2xl font-bold text-[#071421]">Contractor onboarding</h1>
          <p className="mt-1 text-sm text-[#667085]">Four short steps. Most people finish in under ten minutes.</p>
        </header>

        {/* Step tracker */}
        <ol className="flex items-center gap-1" aria-label="Onboarding progress">
          {STEPS.map((step, i) => {
            const complete = i < activeStep || done
            const current = i === activeStep && !done
            const Icon = complete ? Check : step.icon
            return (
              <li key={step.id} className="flex flex-1 items-center gap-1">
                <button
                  type="button"
                  onClick={() => !(done || i > activeStep) && setActiveStep(i)}
                  disabled={done || i > activeStep}
                  className="flex flex-1 flex-col items-center gap-1.5 py-1 disabled:cursor-default"
                  aria-current={current ? 'step' : undefined}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-bold ${
                    complete ? 'border-[#0F6A53] bg-[#0F6A53] text-white'
                    : current ? 'border-[#071421] bg-[#071421] text-white'
                    : 'border-[#E5E7EB] bg-white text-[#667085]'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={`text-[11px] font-semibold ${current ? 'text-[#071421]' : 'text-[#667085]'}`}>{step.label}</span>
                </button>
                {i < STEPS.length - 1 && <span className={`mb-6 h-px flex-1 ${complete ? 'bg-[#0F6A53]' : 'bg-[#E5E7EB]'}`} aria-hidden="true" />}
              </li>
            )
          })}
        </ol>

        {message && (
          <div className={`rounded-xl border p-3 text-sm ${
            messageTone === 'err' ? 'border-[#B42318]/25 bg-[#FEF2F2] text-[#B42318]' : 'border-[#0F6A53]/25 bg-[#ECFDF3] text-[#0F6A53]'
          }`} role="status">
            {message}
          </div>
        )}

        {done ? (
          <section className="rounded-2xl border bg-white p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#ECFDF3] text-[#0F6A53]">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-bold text-[#071421]">You&apos;re on board</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#667085]">
              Your application, agreement, and service standards are all recorded. Our operations team reviews every
              new contractor and will reach out about trial jobs.
            </p>
          </section>
        ) : (
          <>
            {/* Step 1 — company details */}
            {activeStep === 0 && (
              <section className="rounded-2xl border bg-white p-5">
                <h2 className="text-lg font-bold text-[#071421]">Tell us about your company</h2>
                <p className="mt-1 text-sm text-[#667085]">This is how you&apos;ll appear to our operations team.</p>
                <form
                  className="mt-4 space-y-4"
                  onSubmit={e => { e.preventDefault(); void run('application', { application: form }, 'application') }}
                >
                  {FIELD_LABELS.map(f => (
                    <div key={f.key}>
                      <label htmlFor={`f-${f.key}`} className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                        {f.label} <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id={`f-${f.key}`}
                        type={f.type || 'text'}
                        required
                        value={form[f.key] || ''}
                        onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                        className="mt-1 block w-full rounded-xl border border-[#E5E7EB] px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0F6A53]"
                      />
                      {f.hint && <p className="mt-1 text-[11px] text-[#667085]">{f.hint}</p>}
                    </div>
                  ))}
                  <button
                    type="submit"
                    disabled={busy === 'application'}
                    className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#071421] px-4 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {busy === 'application' ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Save and continue <ArrowRight className="h-4 w-4" /></>}
                  </button>
                </form>
              </section>
            )}

            {/* Step 2 — agreement */}
            {activeStep === 1 && (
              <section className="rounded-2xl border bg-white p-5">
                <h2 className="text-lg font-bold text-[#071421]">Subcontractor agreement</h2>
                <p className="mt-1 text-sm text-[#667085]">
                  Version {invite.agreementVersion || '1.0'}. Here&apos;s what it covers, in plain language:
                </p>
                <ul className="mt-4 space-y-3 rounded-xl bg-[#F9FAFB] p-4">
                  {AGREEMENT_POINTS.map(([title, body]) => (
                    <li key={title} className="flex gap-3">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0F6A53]" />
                      <div>
                        <p className="text-sm font-semibold text-[#071421]">{title}</p>
                        <p className="mt-0.5 text-sm leading-6 text-[#667085]">{body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] leading-5 text-[#667085]">
                  This is a summary. By accepting, you agree to the full subcontractor agreement (version {invite.agreementVersion || '1.0'}),
                  which our team can send you any time.
                </p>
                {checklist.agreement ? (
                  <p className="mt-4 flex items-center gap-2 rounded-xl bg-[#ECFDF3] p-3 text-sm font-semibold text-[#0F6A53]">
                    <CheckCircle2 className="h-4 w-4" /> Agreement accepted
                    {invite.agreementAcceptedAt && <span className="font-normal">on {new Date(invite.agreementAcceptedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                  </p>
                ) : (
                  <form
                    className="mt-4 space-y-3"
                    onSubmit={e => { e.preventDefault(); void run('agreement', { version: invite.agreementVersion || '1.0', signatory }, 'agreement') }}
                  >
                    <div>
                      <label htmlFor="signatory" className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                        Type your full name to sign <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="signatory"
                        required
                        value={signatory}
                        onChange={e => setSignatory(e.target.value)}
                        placeholder="Jane Doe"
                        className="mt-1 block w-full rounded-xl border border-[#E5E7EB] px-3 py-2.5 text-sm text-[#071421] outline-none focus:border-[#0F6A53]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy === 'agreement' || !signatory.trim()}
                      className="min-h-[48px] w-full rounded-xl bg-[#071421] px-4 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {busy === 'agreement' ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'I accept the agreement'}
                    </button>
                  </form>
                )}
              </section>
            )}

            {/* Step 3 — service standards */}
            {activeStep === 2 && (
              <section className="rounded-2xl border bg-white p-5">
                <h2 className="text-lg font-bold text-[#071421]">Service standards</h2>
                <p className="mt-1 text-sm text-[#667085]">Every Saturn Star job is expected to meet these, no exceptions:</p>
                <ul className="mt-4 space-y-3">
                  {BRAND_POINTS.map(point => (
                    <li key={point} className="flex gap-3 rounded-xl bg-[#F9FAFB] p-3">
                      <Medal className="mt-0.5 h-4 w-4 shrink-0 text-[#8a6800]" />
                      <p className="text-sm leading-6 text-[#071421]">{point}</p>
                    </li>
                  ))}
                </ul>
                {checklist.brand ? (
                  <p className="mt-4 flex items-center gap-2 rounded-xl bg-[#ECFDF3] p-3 text-sm font-semibold text-[#0F6A53]">
                    <CheckCircle2 className="h-4 w-4" /> Standards acknowledged
                  </p>
                ) : (
                  <button
                    onClick={() => void run('brand', {}, 'brand')}
                    disabled={busy === 'brand'}
                    className="mt-4 min-h-[48px] w-full rounded-xl bg-[#071421] px-4 text-sm font-bold text-white disabled:opacity-50"
                  >
                    {busy === 'brand' ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'I understand and agree'}
                  </button>
                )}
              </section>
            )}

            {/* Step 4 — payout setup */}
            {activeStep === 3 && (
              <section className="rounded-2xl border bg-white p-5">
                <h2 className="text-lg font-bold text-[#071421]">Payout setup</h2>
                {invite.stripeStatus === 'enabled' ? (
                  <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#ECFDF3] p-4 text-sm leading-6 text-[#0F6A53]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    Your payout account is connected. Job payouts will go to the bank account you linked.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm leading-6 text-[#667085]">
                      We pay contractors through Stripe — never by e-transfer or cash. Your banking details go
                      directly to Stripe, not to us, and never into this form.
                    </p>
                    <div className="mt-4 rounded-xl bg-[#FFFAEB] p-4 text-sm leading-6 text-[#92400E]">
                      Your secure Stripe link hasn&apos;t been issued yet. Our operations team sends it after
                      reviewing your application — usually within one business day.
                    </div>
                  </>
                )}
                <button
                  onClick={() => setActiveStep(s => Math.max(0, s - 1))}
                  className="mt-4 min-h-[44px] w-full rounded-xl border border-[#E5E7EB] px-4 text-sm font-semibold text-[#071421]"
                >
                  Back to service standards
                </button>
              </section>
            )}
          </>
        )}

        <p className="text-center text-[11px] text-[#667085]">
          Questions? Call <a className="font-semibold underline" href="tel:+12267732993">226-773-2993</a>
        </p>
      </div>
    </main>
  )
}
