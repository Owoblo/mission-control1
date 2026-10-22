'use client'
import {useState} from 'react'
import type {CRMLead,CRMQuote} from '@/lib/types'
type Operation={id:string;kind:string;state:string;amount_minor:number;currency:string}
export default function PaymentRecoveryPanel({quoteId,onReconciled}:{quoteId:string;onReconciled:(lead:CRMLead,quote:CRMQuote)=>void}) {
 const [rows,setRows]=useState<Operation[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 async function load() {
  setBusy(true)
  try {const r=await fetch(`/api/sales/stripe/payment-operations?quoteId=${encodeURIComponent(quoteId)}`,{cache:'no-store'});const p=await r.json();if(!r.ok)throw new Error(p.error);setRows(p.operations);setMessage(p.operations.length?'':'No saved-card payment operations recorded.')}
  catch(e){setMessage(e instanceof Error?e.message:'Could not load payment operations')}finally{setBusy(false)}
 }
 async function reconcile(op:Operation) {
  setBusy(true)
  try {
   const r=await fetch(`/api/sales/stripe/payment-operations?quoteId=${encodeURIComponent(quoteId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:op.id})})
   const p=await r.json();setMessage(p.message||p.error||(p.ok?'Payment reconciled. No new charge submitted.':'Payment remains unresolved.'))
   if(p.ok&&p.lead&&p.quote){onReconciled(p.lead,p.quote);sessionStorage.removeItem(`ssm:charge-${op.kind}:${quoteId}`)}
   if(p.state==='failed')sessionStorage.removeItem(`ssm:charge-${op.kind}:${quoteId}`)
   if(p.state)setRows(old=>old.map(x=>x.id===op.id?{...x,state:p.state}:x))
  }catch{setMessage('Reconciliation unavailable. Do not charge again.')}finally{setBusy(false)}
 }
 return <section className="rounded-xl border p-3 text-sm"><button type="button" disabled={busy} className="font-semibold underline" onClick={()=>void load()}>Check payment attempts</button>
  {message&&<p className="mt-2" role="status">{message}</p>}
  {rows.map(op=><div key={op.id} className="mt-2 flex items-center justify-between gap-3"><span>{op.kind} · {(op.amount_minor/100).toFixed(2)} {op.currency.toUpperCase()} · {op.state}</span><button type="button" disabled={busy} className="underline" onClick={()=>void reconcile(op)}>Check with Stripe</button></div>)}
 </section>
}
