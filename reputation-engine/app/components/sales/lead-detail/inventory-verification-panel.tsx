'use client'

import { buildInventoryVerificationSummary } from '@/lib/inventory-verification'
import type { CRMLead, LeadMediaAsset } from '@/lib/types'

type Props = {
  lead: CRMLead
  canEditCurrentLead: boolean
  surveyBusy: boolean
  surveyUrl: string | null
  onRequestVerification: () => void
  onScanCustomerMedia: () => void
}

export function InventoryVerificationPanel({
  lead,
  canEditCurrentLead,
  surveyBusy,
  surveyUrl,
  onRequestVerification,
  onScanCustomerMedia,
}: Props) {
  const customerImageAssets = (lead.mediaAssets || []).filter(
    (asset: LeadMediaAsset) => ['survey', 'rep_upload', 'mms'].includes(asset.source) && asset.kind === 'image'
  )
  const customerVideoAssets = (lead.mediaAssets || []).filter(
    (asset: LeadMediaAsset) => ['survey', 'rep_upload', 'mms'].includes(asset.source) && asset.kind === 'video'
  )
  const totalCustomerMedia = customerImageAssets.length + customerVideoAssets.length
  const surveyCompleted = !!lead.surveyCompletedAt
  const surveyScanned = !!lead.surveyScannedAt
  const verificationSummary = buildInventoryVerificationSummary(lead.inventoryVerification)

  return (
    <>
      <button
        onClick={onRequestVerification}
        disabled={!canEditCurrentLead || surveyBusy}
        className="crm-button w-full justify-center disabled:opacity-60"
        title="Customer can review the inventory, flag what stays behind, and upload missing room photos"
      >
        {surveyBusy ? '⏳ Generating link…'
          : lead.surveyCompletedAt ? '📦 Resend Inventory Verification'
          : lead.surveyRequestedAt ? '📦 Resend Inventory Verification'
          : '📦 Request Inventory Verification'}
      </button>

      {totalCustomerMedia > 0 ? (
        <div className={`rounded-[8px] border px-3 py-3 space-y-2 ${surveyCompleted && !surveyScanned ? 'border-emerald-300 bg-emerald-50' : 'border-[var(--app-line)] bg-[var(--app-bg)]'}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-[var(--app-ink)]">
              📷 {totalCustomerMedia} customer media file{totalCustomerMedia !== 1 ? 's' : ''}
              {customerVideoAssets.length > 0 ? <span className="ml-1 text-[var(--app-muted)]">· {customerVideoAssets.length} video{customerVideoAssets.length !== 1 ? 's' : ''}</span> : null}
              {surveyCompleted ? <span className="ml-1 text-emerald-600">· Survey complete</span> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-white/70 p-2 text-[11px] text-[var(--app-muted)]">
            <div>Moving confirmed: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.goingCount}</span></div>
            <div>Staying behind: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.notGoingCount}</span></div>
            <div>Needs review: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.unsureCount}</span></div>
            <div>Customer-added: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.addedCount}</span></div>
          </div>

          {verificationSummary.addressMismatch ? (
            <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Customer flagged a possible address or unit mismatch. Review the verification notes before pricing.
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-1">
            {customerImageAssets.map((asset, index) => {
              const sourceLabel = asset.source === 'mms' ? 'MMS' : asset.source === 'survey' ? 'Survey' : 'Rep'
              const sourceTone = asset.source === 'mms'
                ? 'bg-sky-100 text-sky-700'
                : asset.source === 'survey'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-800'
              return (
                <a
                  key={asset.id || index}
                  href={asset.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative aspect-square overflow-hidden rounded-[6px] border border-[var(--app-line)]"
                  title={asset.room ? `${asset.room}` : `Photo ${index + 1}`}
                >
                  <img
                    src={asset.url}
                    alt={`Customer photo ${index + 1}`}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${sourceTone}`}>
                    {sourceLabel}
                  </div>
                  {asset.room ? (
                    <div className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[9px] text-white">
                      {asset.room}
                    </div>
                  ) : null}
                </a>
              )
            })}
          </div>

          {customerVideoAssets.length > 0 ? (
            <div className="rounded-[8px] bg-white/70 p-2 text-[11px] text-[var(--app-muted)]">
              <div className="mb-2 font-semibold text-[var(--app-ink)]">Video attachments</div>
              <div className="space-y-1.5">
                {customerVideoAssets.map((asset, index) => {
                  const sourceLabel = asset.source === 'mms' ? 'MMS' : asset.source === 'survey' ? 'Survey' : 'Rep'
                  return (
                    <a
                      key={asset.id || `video-${index}`}
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 hover:border-[var(--app-ink)]"
                    >
                      <span className="truncate pr-3 font-medium text-[var(--app-ink)]">
                        {asset.filename || asset.room || `Video ${index + 1}`}
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                        {sourceLabel}
                      </span>
                    </a>
                  )
                })}
              </div>
            </div>
          ) : null}

          {customerImageAssets.length > 0 ? (
            <button
              onClick={onScanCustomerMedia}
              disabled={surveyBusy}
              className={`w-full rounded-[6px] py-2 text-xs font-semibold transition ${surveyScanned ? 'bg-[var(--app-bg)] text-[var(--app-muted)] border border-[var(--app-line)]' : 'bg-emerald-600 text-white hover:bg-emerald-700'} disabled:opacity-60`}
            >
              {surveyBusy ? '⏳ Scanning…' : surveyScanned ? '✓ Re-scan customer media' : '🔍 Scan customer media into inventory'}
            </button>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-white/70 px-3 py-2 text-[11px] text-[var(--app-muted)]">
              Inventory scanning works from image attachments. Videos are stored here for rep review.
            </div>
          )}

          {surveyScanned ? (
            <div className="text-[10px] text-[var(--app-muted)]">
              Last scanned {new Date(lead.surveyScannedAt as string).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          ) : null}
        </div>
      ) : null}

      {surveyUrl ? (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-2.5 text-[10px] text-[var(--app-muted)]">
          <div className="font-semibold uppercase tracking-[0.16em] text-[var(--app-muted)]">Inventory verification link</div>
          <div className="mt-1 break-all">{surveyUrl}</div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(surveyUrl) }}
              className="font-semibold text-[var(--app-accent)]"
            >
              Copy
            </button>
            <a href={surveyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--app-accent)]">
              Open
            </a>
          </div>
        </div>
      ) : null}
    </>
  )
}
