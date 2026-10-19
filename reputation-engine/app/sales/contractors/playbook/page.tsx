import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { contractorPlaybook } from '@/lib/subcontractor-guide'

export const metadata = { title: 'Subcontractor playbook | Saturn Star OS', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function SubcontractorPlaybookPage() {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  if (!canAccessOperationsWorkspace(session)) return <main className="crm-shell"><h1 className="text-2xl font-bold">Operations access required</h1><p className="mt-3">This playbook is available to owners, managers and operations leads.</p></main>
  return <main className="crm-shell space-y-8"><header><p className="text-xs font-bold uppercase tracking-[.18em] text-[#8C6900]">Operations · Internal working guide</p><h1 className="mt-2 font-display text-3xl font-bold">Subcontractor playbook</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">From first conversation to payment and ongoing review. Owner-approved payment policy: on or before seven calendar days after job completion and receipt of the invoice and required completion records.</p><div className="mt-5 flex flex-wrap gap-3"><Link href="/sales/contractors" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">← Contractor directory</Link><Link href="/work-with-us" target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#071421] px-4 py-2 text-sm font-semibold text-white">Open public overview ↗</Link></div></header><nav aria-label="Playbook sections" className="flex flex-wrap gap-3">{contractorPlaybook.map(s=><a key={s.id} href={'#'+s.id} className="rounded-full border bg-white px-3 py-2 text-xs font-semibold">{s.title}</a>)}</nav><div className="max-w-4xl space-y-6">{contractorPlaybook.map(s=><section key={s.id} id={s.id} className="scroll-mt-24 rounded-2xl border bg-white p-6 sm:p-8"><h2 className="font-display text-xl font-bold">{s.title}</h2><ul className="mt-5 list-disc space-y-4 pl-5 text-sm leading-7 text-slate-600">{s.items.map(item=><li key={item}>{item}</li>)}</ul></section>)}</div><p className="text-xs text-slate-500">Policy approved October 19, 2026. This guide does not approve a contractor, assign a job or initiate a payment.</p></main>
}
