import Link from 'next/link'
import {
  SALES_READ_FIRST_BRANCHES,
  SALES_READ_FIRST_FIRST_SHIFT,
  SALES_READ_FIRST_HIGHLIGHTS,
  SALES_READ_FIRST_IDENTITY,
  SALES_READ_FIRST_NON_NEGOTIABLES,
  SALES_READ_FIRST_PROMISES,
  SALES_READ_FIRST_SERVICE_STANDARD,
} from '@/lib/sales-read-first'

export default function SalesReadFirstPage() {
  return (
    <div className="crm-shell space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-[rgba(15,106,83,0.16)] bg-[linear-gradient(135deg,#ffffff_0%,#f6fbf9_58%,#edf5f2_100%)] px-6 py-7 md:px-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(15,106,83,0.18)] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-accent)]">
          Read First
        </div>
        <h1 className="mt-4 font-display text-[32px] font-semibold tracking-tight text-[var(--app-ink)]">
          What every Saturn Star rep should understand before touching live leads.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">
          This is not the sales academy. This is the business layer: who we are, how we serve, what standard we protect,
          and how reps are expected to think before they ever start improvising on calls.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/sales/academy" className="crm-button-dark">
            Open academy
          </Link>
          <Link href="/sales/leads" className="crm-button">
            Open leads
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        {SALES_READ_FIRST_HIGHLIGHTS.map(card => (
          <div key={card.title} className="crm-panel p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{card.title}</div>
            <div className="mt-3 text-sm leading-6 text-[var(--app-ink)]">{card.body}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
        <div className="space-y-5">
          {SALES_READ_FIRST_IDENTITY.map(section => (
            <div key={section.title} className="crm-panel p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{section.title}</div>
              <div className="mt-4 space-y-3">
                {section.items.map(item => (
                  <div key={item} className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-ink)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="crm-panel p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{SALES_READ_FIRST_NON_NEGOTIABLES.title}</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {SALES_READ_FIRST_NON_NEGOTIABLES.items.map(item => (
                <div key={item} className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-ink)]">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="crm-panel p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Active branches</div>
            <div className="mt-4 space-y-3">
              {SALES_READ_FIRST_BRANCHES.map(branch => (
                <div key={branch.title} className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                  <div className="text-sm font-semibold text-[var(--app-ink)]">{branch.title}</div>
                  <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">{branch.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="crm-panel p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{SALES_READ_FIRST_SERVICE_STANDARD.title}</div>
            <div className="mt-4 space-y-3">
              {SALES_READ_FIRST_SERVICE_STANDARD.items.map(item => (
                <div key={item} className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-ink)]">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr,1fr]">
        <div className="crm-panel p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">Customer promises</div>
          <div className="mt-4 space-y-3">
            {SALES_READ_FIRST_PROMISES.map(card => (
              <div key={card.title} className="rounded-[16px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="text-sm font-semibold text-[var(--app-ink)]">{card.title}</div>
                <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">{card.body}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="crm-panel p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--app-muted)]">{SALES_READ_FIRST_FIRST_SHIFT.title}</div>
          <div className="mt-4 space-y-3">
            {SALES_READ_FIRST_FIRST_SHIFT.items.map(item => (
              <div key={item} className="rounded-[14px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 text-sm leading-6 text-[var(--app-ink)]">
                {item}
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-[18px] border border-[rgba(15,106,83,0.18)] bg-[rgba(15,106,83,0.06)] p-4">
            <div className="text-sm font-semibold text-[var(--app-ink)]">Use this order</div>
            <div className="mt-2 text-sm leading-6 text-[var(--app-muted)]">
              Read First gives the rep the business context. The academy then teaches the call system, tonality, phrase bank, pricing rules,
              scenarios, and coaching drills on top of that foundation.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
