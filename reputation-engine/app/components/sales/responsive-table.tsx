import type { ReactNode } from 'react'

/**
 * ONE responsive table for the CRM (Saturn design vision, Sept 2026).
 *
 * Real <table> on desktop; stacked label/value cards on mobile.
 * Every column stays reachable on mobile — stacked, never dropped,
 * never trapped in a horizontal scroll.
 *
 * Usage:
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'branch', header: 'Branch', render: row => <strong>{row.label}</strong> },
 *       { key: 'leads', header: 'Leads', align: 'right', render: row => row.received },
 *     ]}
 *     rows={data}
 *     rowKey={row => row.id}
 *   />
 */
export type ResponsiveTableColumn<Row> = {
  key: string
  header: string
  align?: 'left' | 'right' | 'center'
  /** Label shown above the value on mobile cards. Defaults to header. */
  mobileLabel?: string
  render: (row: Row) => ReactNode
}

const ALIGN: Record<string, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export function ResponsiveTable<Row>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'No data.',
  className = '',
}: {
  columns: ResponsiveTableColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  emptyMessage?: string
  className?: string
}) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-[var(--app-muted)]">{emptyMessage}</div>
  }
  return (
    <div className={className}>
      {/* Desktop: real table */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-[var(--app-line)]">
            {columns.map(col => (
              <th
                key={col.key}
                className={`pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] ${ALIGN[col.align || 'left']}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--app-line)]">
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)}>
              {columns.map(col => (
                <td key={col.key} className={`py-2.5 text-[var(--app-ink)] ${ALIGN[col.align || 'left']}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked cards, every column reachable */}
      <div className="divide-y divide-[var(--app-line)] md:hidden">
        {rows.map((row, i) => (
          <dl key={rowKey(row, i)} className="grid grid-cols-2 gap-x-4 gap-y-2 py-3">
            {columns.map(col => (
              <div key={col.key} className={col.align === 'right' ? 'text-right' : ''}>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                  {col.mobileLabel || col.header}
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--app-ink)]">{col.render(row)}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  )
}

/** Semantic value coloring on the constitution palette (replaces emerald/rose/amber one-offs). */
export function toneValue(kind: 'positive' | 'negative' | 'warning' | 'neutral', strong = false): string {
  const base =
    kind === 'positive' ? 'text-[#0F6A53]' : kind === 'negative' ? 'text-[#B42318]' : kind === 'warning' ? 'text-[#92400E]' : 'text-[var(--app-ink)]'
  return strong ? `${base} font-semibold` : base
}
