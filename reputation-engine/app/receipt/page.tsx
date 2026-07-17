'use client'

import Image from 'next/image'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { PaymentRecord } from '@/lib/types'
import type { ReceiptBrand } from '@/lib/receipt-brand'

type ReceiptPayload = {
  receipt: PaymentRecord
  quote: { id: string; number: string; total: number; moveDate?: string; originCity?: string; destCity?: string }
  customer: { name: string }
  brand: ReceiptBrand
}

const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value)
const date = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : 'To be confirmed'

function ReceiptInner() {
  const search = useSearchParams()
  const [data, setData] = useState<ReceiptPayload | null>(null)
  const [error, setError] = useState('')
  const id = search.get('id') || ''
  const token = search.get('token') || ''

  useEffect(() => {
    if (!id || !token) { setError('This receipt link is incomplete.'); return }
    fetch(`/api/public/receipts/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Receipt not found')
        setData(payload)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Receipt not found'))
  }, [id, token])

  if (error) return <main className="flex min-h-screen items-center justify-center bg-[#F7F4ED] p-6"><div className="rounded-[20px] border border-[#E5E7EB] bg-white p-8 text-center text-sm text-[#667085]">{error}</div></main>
  if (!data) return <main className="flex min-h-screen items-center justify-center bg-[#F7F4ED]"><div className="h-10 w-10 animate-pulse rounded-full bg-[#C99700]" /></main>

  const { receipt, quote, customer, brand } = data
  const route = [quote.originCity, quote.destCity].filter(Boolean).join(' → ') || 'Move details on file'
  return (
    <main className="min-h-screen bg-[#F7F4ED] px-4 py-8 text-[#111827] print:bg-white print:p-0">
      <article className="mx-auto max-w-2xl overflow-hidden rounded-[24px] border border-[#E5E7EB] bg-white print:border-0">
        <header className="bg-[#071421] px-6 py-7 sm:px-10 sm:py-9">
          <div className="flex items-start justify-between gap-5">
            <div>
              {brand.logoPath ? <Image src={brand.logoPath} alt={brand.fullName} width={260} height={87} className="h-auto w-[210px] sm:w-[260px]" priority /> : <div className="text-2xl font-extrabold text-white">{brand.fullName}</div>}
              <p className="mt-3 text-xs text-white/60">{brand.tagline}</p>
            </div>
            <div className="rounded-full bg-[#C99700] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#071421]">Payment received</div>
          </div>
        </header>

        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-col justify-between gap-5 border-b border-[#E5E7EB] pb-7 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8A6800]">Official receipt</div>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[#071421]">Thank you, {customer.name.split(' ')[0]}.</h1>
              <p className="mt-2 text-sm leading-6 text-[#667085]">Your payment has been recorded and applied to your move.</p>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-xs text-[#667085]">Receipt number</div>
              <div className="mt-1 font-bold text-[#071421]">{receipt.receiptNumber}</div>
              <div className="mt-1 text-xs text-[#667085]">{date(receipt.paidAt)}</div>
            </div>
          </div>

          <section className="my-7 rounded-[20px] bg-[#F7F4ED] p-5 sm:p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <div><div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Quote</div><div className="mt-1 font-bold text-[#071421]">{quote.number}</div></div>
              <div><div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Move date</div><div className="mt-1 font-bold text-[#071421]">{date(quote.moveDate)}</div></div>
              <div className="sm:col-span-2"><div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Route</div><div className="mt-1 font-bold text-[#071421]">{route}</div></div>
            </div>
          </section>

          <section className="rounded-[20px] border border-[#071421] p-5 sm:p-6">
            <div className="flex items-end justify-between border-b border-[#E5E7EB] pb-5">
              <div><div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">Payment received</div><div className="mt-1 text-sm font-semibold text-[#071421]">{receipt.methodLabel}{receipt.cardLast4 ? ` ···· ${receipt.cardLast4}` : ''}</div></div>
              <div className="text-3xl font-extrabold text-[#071421]">{money(receipt.amount)}</div>
            </div>
            <div className="space-y-3 pt-5 text-sm">
              <div className="flex justify-between text-[#667085]"><span>Move total</span><span>{money(quote.total)}</span></div>
              <div className="flex justify-between text-[#667085]"><span>Total paid to date</span><span>{money(receipt.paidAfterPayment)}</span></div>
              <div className="flex justify-between border-t border-[#E5E7EB] pt-3 font-bold text-[#071421]"><span>Remaining balance</span><span>{money(receipt.balanceAfterPayment)}</span></div>
            </div>
          </section>

          {(receipt.reference || receipt.note) && <section className="mt-6 rounded-[18px] border border-[#E5E7EB] p-5 text-sm text-[#667085]">{receipt.reference && <div><strong className="text-[#111827]">Reference:</strong> {receipt.reference}</div>}{receipt.note && <div className={receipt.reference ? 'mt-2' : ''}><strong className="text-[#111827]">Note:</strong> {receipt.note}</div>}</section>}

          <div className="mt-8 flex flex-wrap gap-3 print:hidden">
            <button onClick={() => window.print()} className="rounded-[12px] bg-[#C99700] px-5 py-3 text-sm font-bold text-[#071421]">Print or save PDF</button>
            <a href={brand.phoneHref} className="rounded-[12px] border border-[#E5E7EB] px-5 py-3 text-sm font-bold text-[#071421]">Questions? {brand.phone}</a>
          </div>
        </div>

        <footer className="border-t border-[#E5E7EB] px-6 py-6 text-center text-xs leading-5 text-[#667085] sm:px-10">{brand.fullName} · {brand.tagline}{brand.website ? <> · <a href={`https://${brand.website}`} className="font-semibold text-[#8A6800]">{brand.website}</a></> : null}</footer>
      </article>
    </main>
  )
}

export default function ReceiptPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#F7F4ED]" />}><ReceiptInner /></Suspense>
}
