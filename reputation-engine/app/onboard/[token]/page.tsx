'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Save, ShieldCheck } from 'lucide-react'
import { DOCUMENT_TYPES, EMPTY_APPLICATION, SPECIALTIES, STAGE_LABELS, type ContractorApplication } from '@/lib/contractor-onboarding'

type Document = { id: string; kind: string; filename: string }
type Invite = { stage: string; application: Partial<ContractorApplication>; editable: boolean; documents: Document[]; additionalInsuredInstructions: string }
const steps = ['Your business', 'People & contact', 'Crew & capabilities', 'Documents', 'Review & send']
const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-[#071421] outline-none focus:border-[#C99700] focus:ring-2 focus:ring-[#C99700]/20'

export default function Onboard() {
  const { token } = useParams<{ token: string }>()
  const preview = token === 'preview'
  const [invite, setInvite] = useState<Invite | null>(null)
  const [form, setForm] = useState<ContractorApplication>({ ...EMPTY_APPLICATION })
  const [step, setStep] = useState(0), [message, setMessage] = useState(''), [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState(false)
  useEffect(() => { if (preview) { setInvite({ stage: 'application', application: {}, editable: true, documents: [], additionalInsuredInstructions: 'Additional insured: MARS RELOCATION SERVICES INC. Saturn will confirm the address and insurer-specific details before the endorsement is requested.' }); return } fetch(`/api/onboarding/${token}`, { cache: 'no-store' }).then(async r => { const b = await r.json(); if (!r.ok) throw Error(b.error); setInvite(b.invite); setForm({ ...EMPTY_APPLICATION, ...b.invite.application }); setSubmitted(b.invite.stage === 'verification') }).catch(e => setMessage(e.message)) }, [token])
  function update<K extends keyof ContractorApplication>(key: K, value: ContractorApplication[K]) { setForm(f => ({ ...f, [key]: value })); setSubmitted(false) }
  async function save(submit = false, advance = false) {
    if (preview) { setMessage(submit ? 'Preview complete. Nothing was submitted or saved.' : 'Preview only. Nothing is saved.'); if (advance) setStep(s => Math.min(4, s + 1)); return }
    setBusy(true); setMessage(''); setErrors([])
    try {
      const r = await fetch(`/api/onboarding/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: submit ? 'application' : 'save', application: form }) })
      const b = await r.json(); if (!r.ok) { setErrors(b.errors || []); throw Error(b.error) }
      setInvite(i => i ? { ...i, stage: b.stage } : i); setSubmitted(submit)
      setMessage(submit ? 'Thank you. Your application is with Saturn for review. We’ll contact you about next steps.' : 'Progress saved. You can return using this same link.')
      if (advance) { setStep(s => Math.min(4, s + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save. Please try again.') } finally { setBusy(false) }
  }
  async function upload(kind: string, file?: File) {
    if (!file || preview) return
    setBusy(true); setMessage(''); setErrors([])
    try {
      if (file.size > 4 * 1024 * 1024) throw Error('Choose a file under 4 MB.')
      const body = new FormData(); body.set('kind', kind); body.set('file', file)
      const r = await fetch(`/api/onboarding/${token}/documents`, { method: 'POST', body }); const b = await r.json()
      if (!r.ok) throw Error(b.error)
      setInvite(i => i ? { ...i, documents: b.documents } : i); setMessage('Document uploaded securely. Saturn will review it.'); setSubmitted(false)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Upload failed.') } finally { setBusy(false) }
  }
  function field(key: keyof ContractorApplication, label: string, options: { required?: boolean; type?: string; hint?: string; multiline?: boolean } = {}) {
    const id = `field-${key}`
    return <label htmlFor={id} className="block text-sm font-semibold">{label}{options.required && <span className="text-[#8C6900]"> *</span>}{options.hint && <span className="mt-1 block font-normal leading-5 text-slate-500">{options.hint}</span>}{options.multiline ? <textarea id={id} maxLength={2000} rows={3} value={String(form[key])} onChange={e => update(key, e.target.value as never)} className={inputClass} /> : <input id={id} type={options.type || 'text'} maxLength={2000} value={String(form[key])} onChange={e => update(key, e.target.value as never)} className={inputClass} />}</label>
  }
  function select(key: keyof ContractorApplication, label: string, choices: string[], required = true) {
    return <label className="block text-sm font-semibold" htmlFor={`field-${key}`}>{label}{required && <span className="text-[#8C6900]"> *</span>}<select id={`field-${key}`} className={inputClass} value={String(form[key])} onChange={e => update(key, e.target.value as never)}><option value="">Choose an option</option>{choices.map(c => <option key={c}>{c}</option>)}</select></label>
  }
  function checks(key: 'truckAccess' | 'specialties', label: string, choices: string[]) {
    return <fieldset><legend className="mb-3 text-sm font-semibold">{label} <span className="text-[#8C6900]">*</span></legend><div className="grid gap-2 sm:grid-cols-2">{choices.map(c => <label key={c} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${form[key].includes(c) ? 'border-[#C99700] bg-amber-50' : 'border-slate-200'}`}><input type="checkbox" className="h-4 w-4 accent-[#071421]" checked={form[key].includes(c)} onChange={e => update(key, e.target.checked ? [...form[key], c] : form[key].filter(v => v !== c))} />{c}</label>)}</div></fieldset>
  }
  return <main className="min-h-screen bg-[#F5F6F8] pb-12 text-[#071421]">
    <header className="bg-[#071421] px-5 py-7 text-white"><div className="mx-auto max-w-2xl"><img src="/brand/saturn-star-horizontal-reverse.png" alt="Saturn Star Movers" className="h-12 w-auto max-w-full object-contain object-left" /><p className="mt-7 text-xs font-bold uppercase tracking-[.18em] text-[#D8B453]">Crew & contractor network</p><h1 className="mt-2 font-display text-3xl font-bold">Let’s get to know your team.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">Tell us where you work, what you can handle, and how to reach the right person. We’ll use this to review your company and offer suitable jobs.</p></div></header>
    <div className="mx-auto max-w-2xl space-y-5 px-4 pt-6">
      {preview && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><b>Preview only</b> · Explore all five steps. Nothing is saved or submitted, and document uploads are disabled. Use example details only.</div>}
      {message && <div role="status" aria-live="polite" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">{message}{errors.length > 1 && <ul className="mt-2 list-disc space-y-1 pl-5">{errors.map(e => <li key={e}>{e}</li>)}</ul>}</div>}
      {!invite ? <p className="text-sm text-slate-600">{message ? 'Please contact Saturn if you need help accessing this form.' : 'Loading your application…'}</p> : <>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="rounded-full bg-white px-3 py-2 font-semibold">{STAGE_LABELS[invite.stage] || invite.stage}</span><span className="text-slate-500">Save and return anytime · * Required</span></div>
        {!invite.editable ? <section className="rounded-2xl border bg-white p-6"><h2 className="text-xl font-bold">Your application has moved to the next stage.</h2><p className="mt-3 text-sm text-slate-600">Contact Saturn for updates. Company approval, job assignments and payment setup are handled separately.</p></section> : <>
          <nav aria-label="Application steps" className="grid grid-cols-5 gap-1">{steps.map((name, i) => <button key={name} type="button" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)} className={`rounded-xl px-1 py-3 text-center text-[11px] sm:text-xs ${step === i ? 'bg-[#071421] font-bold text-white' : 'bg-white text-slate-600'}`}><span className="mb-1 block font-bold">{i + 1}</span>{name}</button>)}</nav>
          <form onSubmit={e => { e.preventDefault(); void save(step === 4, step < 4) }}>
            <fieldset disabled={busy} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
              <div><p className="text-xs font-bold uppercase tracking-wider text-[#8C6900]">Step {step + 1} of 5</p><h2 className="mt-1 text-2xl font-bold">{steps[step]}</h2></div>
              {step === 0 && <>
                {field('legalBusinessName', 'Legal business name', { required: true, hint: 'As shown on your business registration.' })}
                <div className="grid gap-5 sm:grid-cols-2">{field('contactName', 'Your name', { required: true })}{select('contactRole', 'Your role', ['Owner', 'Dispatcher / operations', 'Sales representative', 'Other authorized representative'])}</div>
                {field('email', 'Business email', { required: true, type: 'email' })}
                {field('homeMarket', 'Where are you based?', { required: true, hint: 'City or town.' })}
                {field('serviceAreas', 'Where can you take jobs?', { required: true, hint: 'List cities/regions, travel limits and any long-distance routes.', multiline: true })}
              </>}
              {step === 1 && <>
                <p className="text-sm leading-6 text-slate-500">We need someone who can confirm availability, crew and truck details—not just take an enquiry.</p>
                {field('phone', 'Main business number', { required: true, type: 'tel' })}
                {select('phoneAnsweredBy', 'Who normally answers that number?', ['Owner directly', 'Dispatcher / operations', 'Sales representative', 'Reception / answering service', 'Shared team line', 'Usually voicemail / callback'])}
                {field('dispatchName', 'Who should we contact about jobs?', { required: true })}
                {select('dispatchRole', 'Their role', ['Owner', 'Dispatcher / operations', 'Crew lead', 'Sales representative who coordinates dispatch', 'Other'])}
                {field('dispatchPhone', 'Direct / mobile number for job coordination', { required: true, type: 'tel', hint: 'Use the business number again if it reaches this person. Share a personal number only with their permission.' })}
                {select('preferredContact', 'Best way to reach them', ['Phone call', 'Text message', 'Email', 'Call, then text if unavailable'])}
                {field('contactHours', 'Best times to call / typical response time', { hint: 'For example: weekdays 7am–6pm; usually returns calls within an hour.' })}
                {field('backupContact', 'Backup contact for urgent job-day issues', { hint: 'Name, role and phone, with their permission. Optional.', multiline: true })}
              </>}
              {step === 2 && <>
                {select('serviceModel', 'What can you provide?', ['Truck and moving crew', 'Truck and driver only', 'Labour only', 'A mix, depending on the job'])}
                {checks('truckAccess', 'How do you access trucks? Select all that apply.', ['Own', 'Lease', 'Rent', 'Labour only'])}
                <div className="grid gap-5 sm:grid-cols-2">{field('truckSizes', 'Truck sizes / types', { hint: 'Example: 16 ft cube, 26 ft with liftgate.' })}{field('truckCount', 'How many trucks can you supply?')}</div>
                {form.truckAccess.some(t => ['Rent', 'Lease'].includes(t)) && field('rentalNotice', 'Rental / lease arrangements and notice needed', { hint: 'Which sizes are reliably available? How much notice do you need?', multiline: true })}
                {field('crewSize', 'Usual and maximum crew size', { required: true, hint: 'Example: normally 2; up to 5 with two days’ notice.' })}
                {field('availability', 'Usual availability and notice needed', { hint: 'Weekdays/weekends, short notice, evenings and seasonal limits.', multiline: true })}
                {checks('specialties', 'Which services can your team handle?', SPECIALTIES)}
                {field('specialtyDetails', 'Specialty experience and limits', { hint: 'For hot tubs, pool tables, machinery, pianos, safes or rigging: describe similar jobs, size/weight limits, equipment and any specialist you use. Required when selecting these services.', multiline: true })}
                {field('equipment', 'Equipment you can bring', { hint: 'Dollies, blankets, straps, liftgate, pallet jack, piano boards, rigging equipment, etc.', multiline: true })}
                {field('restrictions', 'Anything you cannot take on?', { hint: 'Access, weights, stairs, items, truck restrictions or other limits.', multiline: true })}
                {select('pricingModel', 'How do you prefer to price jobs?', ['Fixed price per job', 'Hourly', 'Fixed base plus hourly / extras', 'Open to either fixed or hourly'])}
                {field('rateNotes', 'Usual rates and minimums (optional)', { hint: 'Include crew/truck, minimum hours, travel charges and whether tax is included. Each job’s scope and payment will be agreed separately.', multiline: true })}
              </>}
              {step === 3 && <>
                <div className="flex gap-3 rounded-xl bg-slate-50 p-4 text-sm leading-6"><ShieldCheck className="mt-1 h-5 w-5 shrink-0" /><p>Registration, insurance and photo ID are required for review. Files are stored privately for authorized Saturn staff. Upload PDF, JPG or PNG, up to 4 MB each. Do not send SINs or banking details.</p></div>
                {Object.entries(DOCUMENT_TYPES).map(([kind, label]) => <div key={kind} className="rounded-xl border p-4"><label htmlFor={`upload-${kind}`} className="text-sm font-bold">{label}{kind !== 'additional_insured' && ' *'}</label>{kind === 'identity' && <p className="mt-1 text-xs leading-5 text-slate-500">Photo ID for the owner or representative authorized to work with Saturn.</p>}<ul className="my-2 space-y-1 text-xs text-emerald-800">{invite.documents.filter(d => d.kind === kind).map(d => <li key={d.id} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0" /><span className="break-all">{d.filename} · received, awaiting review</span></li>)}</ul><input id={`upload-${kind}`} type="file" disabled={preview || busy} accept="application/pdf,image/jpeg,image/png" className="block w-full min-w-0 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2" onChange={e => { void upload(kind, e.target.files?.[0]); e.target.value = '' }} /></div>)}
                <div className="grid gap-5 sm:grid-cols-2">{field('insurer', 'Insurance company / broker')}{field('insuranceExpiry', 'Insurance expiry date', { type: 'date' })}</div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><b>Adding Saturn as an additional insured</b><p className="mt-1">{invite.additionalInsuredInstructions || 'Saturn will provide the exact legal name and address for your insurer. You can submit the three baseline documents now; additional-insured evidence will be reviewed before approval.'}</p></div>
                {select('additionalInsured', 'Where are you with this requirement?', ['Evidence uploaded', 'Can arrange it with my insurer', 'Need Saturn’s legal details first', 'Need to discuss with Saturn'])}
              </>}
              {step === 4 && <>
                <p className="text-sm leading-6 text-slate-600">On Saturn jobs, we plan to use Saturn shirts and temporary magnetic truck decals where suitable. Pricing, complaints and scope changes go through Saturn. If the actual job differs from the agreed scope, pause the affected extra work and contact Operations before proceeding.</p>
                {select('branding', 'Can your team work with these expectations?', ['Yes, happy to discuss the details', 'Need to discuss shirts / decals or another requirement'])}
                <p className="text-xs leading-5 text-slate-500">This records your preference. The detailed agreement, branding arrangements and service standards will be reviewed together later.</p>
                {field('questions', 'Anything else we should know?', { multiline: true })}
                <div className="rounded-xl bg-slate-50 p-4 text-sm leading-7"><b>{form.legalBusinessName || 'Your company'}</b><p>{form.homeMarket || 'Base city not entered'} · {form.serviceModel || 'Service model not selected'}</p><p>Dispatch: {form.dispatchName || 'Not entered'} · {form.dispatchPhone || 'Not entered'}</p><p>Trucks: {form.truckAccess.join(', ') || 'Not selected'} · {form.truckSizes || 'Sizes not entered'}</p><p>Services: {form.specialties.join(', ') || 'Not selected'}</p><p>Documents received: {new Set(invite.documents.map(d => d.kind)).size} types</p><p className="mt-2 text-xs text-slate-500">Use the steps above to check or change any answer.</p></div>
                <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={form.confirmed} onChange={e => update('confirmed', e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#071421]" /><span>I am authorized to provide these details and confirm they are accurate. I understand Saturn will review them before approving our company, and each job requires a separate scope and payment agreement.</span></label>
                <div className="rounded-xl border p-4 text-sm"><b>What happens next?</b><p className="mt-2 leading-6 text-slate-600">Document review → agreement & service standards → payment setup → first suitable job. Submitting does not guarantee work or activate your company for dispatch.</p></div>
              </>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><button type="button" disabled={busy || step === 0} onClick={() => setStep(s => s - 1)} className="flex items-center gap-1 rounded-xl px-2 py-3 text-sm font-semibold disabled:opacity-30"><ChevronLeft size={16} />Back</button><button type="submit" disabled={busy || (step === 4 && submitted)} className="flex items-center gap-2 rounded-xl bg-[#071421] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : step === 4 ? submitted ? 'Submitted for review' : 'Submit for review' : 'Save & continue'}<ChevronRight size={16} /></button></div>
              <button type="button" disabled={busy} onClick={() => void save()} className="flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold text-slate-500"><Save size={16} />Save and finish later</button>
            </fieldset>
          </form>
        </>}
      </>}
      <p className="text-center text-xs leading-5 text-slate-500">Saturn Star Movers · Contractor onboarding<br />Keep your personal application link private.</p>
    </div>
  </main>
}
