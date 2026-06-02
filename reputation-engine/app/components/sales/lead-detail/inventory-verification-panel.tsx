'use client'

import { useState } from 'react'
import { buildInventoryVerificationActivity, buildInventoryVerificationSummary } from '@/lib/inventory-verification'
import { PhotoLightbox } from '@/app/components/sales/photo-lightbox'
import type { CRMLead, LeadMediaAsset } from '@/lib/types'

type Props = {
  lead: CRMLead
  canEditCurrentLead: boolean
  surveyBusy: boolean
  surveyUrl: string | null
  onRequestVerification: () => void
  onScanCustomerMedia: () => void
  onGenerateLinkOnly?: () => void
}

export function InventoryVerificationPanel({
  lead,
  canEditCurrentLead,
  surveyBusy,
  surveyUrl,
  onRequestVerification,
  onScanCustomerMedia,
  onGenerateLinkOnly,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  function copyLink() {
    if (!surveyUrl) return
    void navigator.clipboard.writeText(surveyUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

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
  const recentActivity = buildInventoryVerificationActivity(lead).slice(0, 4)

  // Show inventory verification section when: MLS/scan exists, OR customer has already sent photos
  const hasMlsOrScan = !!(lead.supabaseListing || lead.listingScanSnapshot || surveyScanned || totalCustomerMedia > 0 || verificationSummary.goingCount > 0 || verificationSummary.notGoingCount > 0)

  return (
    <>
      {/* ── REQUEST PHOTOS — always visible ───────────────────────── */}
      <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--app-ink)]">📷 Request Photos</div>
          {surveyUrl && (
            <span className={`text-[10px] font-semibold ${surveyCompleted ? 'text-emerald-700' : 'text-amber-700'}`}>
              {surveyCompleted ? 'Customer submitted' : lead.surveyRequestedAt ? 'Link sent' : 'Link ready'}
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--app-muted)] leading-4">
          Send {lead.name ? lead.name.split(' ')[0] : 'the customer'} a link to upload photos of their home — no MLS needed. Helps you price accurately before the estimate.
        </p>

        {surveyUrl ? (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={copyLink}
                className={`flex-1 rounded-[6px] py-2 text-xs font-semibold transition ${copied ? 'bg-emerald-600 text-white' : 'bg-[#1a2744] text-white hover:bg-[#1a2744]/90'}`}
              >
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>
              <a
                href={surveyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[6px] border border-[var(--app-line)] px-3 py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
              >
                Preview
              </a>
              <button
                onClick={onRequestVerification}
                disabled={!canEditCurrentLead || surveyBusy}
                className="rounded-[6px] border border-[var(--app-line)] px-3 py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition disabled:opacity-60"
                title="Resend link via SMS"
              >
                {surveyBusy ? '…' : 'Resend SMS'}
              </button>
            </div>
            <div className="text-[10px] text-[var(--app-muted)] truncate">{surveyUrl}</div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <button
              onClick={onRequestVerification}
              disabled={!canEditCurrentLead || surveyBusy}
              className="flex-1 rounded-[6px] bg-[#1a2744] py-2 text-xs font-semibold text-white hover:bg-[#1a2744]/90 transition disabled:opacity-60"
            >
              {surveyBusy ? '⏳ Generating…' : '📤 Send via SMS'}
            </button>
            {onGenerateLinkOnly && (
              <button
                onClick={onGenerateLinkOnly}
                disabled={!canEditCurrentLead || surveyBusy}
                className="rounded-[6px] border border-[var(--app-line)] px-3 py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition disabled:opacity-60"
              >
                {surveyBusy ? '…' : 'Get Link'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── INVENTORY VERIFICATION — only when MLS/scan exists ────── */}
      {hasMlsOrScan && (
        <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Inventory Verification</div>
          <p className="text-[10px] text-[var(--app-muted)] leading-4">
            Customer confirms the scanned or MLS inventory — flags what&apos;s staying behind, adds missing items.
          </p>

          {totalCustomerMedia > 0 && (
            <div className={`rounded-[8px] border px-3 py-3 space-y-2 ${surveyCompleted && !surveyScanned ? 'border-emerald-300 bg-emerald-50' : 'border-[var(--app-line)] bg-white'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[var(--app-ink)]">
                  {totalCustomerMedia} media file{totalCustomerMedia !== 1 ? 's' : ''}
                  {customerVideoAssets.length > 0 && <span className="ml-1 text-[var(--app-muted)]">· {customerVideoAssets.length} video{customerVideoAssets.length !== 1 ? 's' : ''}</span>}
                  {surveyCompleted && <span className="ml-1 text-emerald-600">· Survey complete</span>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-white/70 p-2 text-[11px] text-[var(--app-muted)]">
                <div>Moving confirmed: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.goingCount}</span></div>
                <div>Staying behind: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.notGoingCount}</span></div>
                <div>Needs review: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.unsureCount}</span></div>
                <div>Customer-added: <span className="font-semibold text-[var(--app-ink)]">{verificationSummary.addedCount}</span></div>
              </div>

              {recentActivity.length > 0 && (
                <div className="rounded-[8px] bg-white/70 p-2 text-[11px] text-[var(--app-muted)]">
                  <div className="mb-2 font-semibold uppercase tracking-[0.12em]">Latest customer edits</div>
                  <div className="space-y-1.5">
                    {recentActivity.map(item => (
                      <div key={item.id} className="rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-[var(--app-ink)]">{item.title}</div>
                          <div className="text-[10px] text-[var(--app-muted)]">
                            {new Date(item.ts).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        </div>
                        <div className="mt-1">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {verificationSummary.addressMismatch && (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  Customer flagged a possible address or unit mismatch. Review before pricing.
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                {customerImageAssets.map((asset, index) => {
                  const sourceLabel = asset.source === 'mms' ? 'MMS' : asset.source === 'survey' ? 'Survey' : 'Rep'
                  const sourceTone = asset.source === 'mms' ? 'bg-sky-100 text-sky-700' : asset.source === 'survey' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                  return (
                    <button key={asset.id || index} type="button" onClick={() => setLightboxIndex(index)}
                      className="group relative aspect-square overflow-hidden rounded-[6px] border border-[var(--app-line)] cursor-zoom-in"
                      title={asset.room || `Photo ${index + 1} — click to enlarge`}
                    >
                      <img src={asset.url} alt={`Customer photo ${index + 1}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                      <div className={`absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${sourceTone}`}>{sourceLabel}</div>
                      {asset.room && <div className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[9px] text-white">{asset.room}</div>}
                    </button>
                  )
                })}
              </div>
              {lightboxIndex !== null && (
                <PhotoLightbox
                  photos={customerImageAssets.map(a => a.url)}
                  labels={customerImageAssets.map(a => [a.room, a.source === 'mms' ? 'MMS' : a.source === 'survey' ? 'Survey' : 'Rep upload'].filter(Boolean).join(' · '))}
                  index={lightboxIndex}
                  onNavigate={setLightboxIndex}
                  onClose={() => setLightboxIndex(null)}
                />
              )}

              {customerVideoAssets.length > 0 && (
                <div className="rounded-[8px] bg-white/70 p-2 text-[11px] text-[var(--app-muted)]">
                  <div className="mb-2 font-semibold text-[var(--app-ink)]">Video attachments</div>
                  <div className="space-y-1.5">
                    {customerVideoAssets.map((asset, index) => (
                      <a key={asset.id || `video-${index}`} href={asset.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-[6px] border border-[var(--app-line)] bg-white px-3 py-2 hover:border-[var(--app-ink)]"
                      >
                        <span className="truncate pr-3 font-medium text-[var(--app-ink)]">{asset.filename || asset.room || `Video ${index + 1}`}</span>
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                          {asset.source === 'mms' ? 'MMS' : asset.source === 'survey' ? 'Survey' : 'Rep'}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {customerImageAssets.length > 0 && (
                <button
                  onClick={onScanCustomerMedia}
                  disabled={surveyBusy}
                  className={`w-full rounded-[6px] py-2 text-xs font-semibold transition disabled:opacity-60 ${surveyScanned ? 'border border-[var(--app-line)] bg-[var(--app-bg)] text-[var(--app-muted)]' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                >
                  {surveyBusy ? '⏳ Scanning…' : surveyScanned ? '✓ Re-scan customer media' : '🔍 Scan into inventory'}
                </button>
              )}

              {surveyScanned && (
                <div className="text-[10px] text-[var(--app-muted)]">
                  Last scanned {new Date(lead.surveyScannedAt as string).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
