'use client'

import type { ReactNode } from 'react'
import { RecordingPlayer } from '@/app/components/sales/recording-player'

type MoveReadiness = 'hot' | 'warm' | 'cold'

interface TranscriptLine {
  time?: string
  speaker?: string
  text: string
}

interface CallInsightPanelProps {
  title?: string
  callLabel?: string
  callerName?: string
  timestamp?: string
  duration?: string | null
  branchLabel?: string
  recordingUrl?: string | null
  recordingSid?: string | null
  recordingUnavailable?: boolean
  recordingUnavailableReason?: string | null
  transcript?: string | null
  summary?: string | null
  moveReadiness?: MoveReadiness
  processingMessage?: string
  actions?: ReactNode
  className?: string
}

function cleanBullet(value: string) {
  return value.replace(/^[-*•\d.)\s]+/, '').trim()
}

function summaryBullets(summary?: string | null) {
  if (!summary) return []
  const lineBullets = summary
    .split(/\n+/)
    .map(cleanBullet)
    .filter(Boolean)
  if (lineBullets.length > 1) return lineBullets.slice(0, 5)
  return summary
    .split(/(?<=[.!?])\s+/)
    .map(cleanBullet)
    .filter(Boolean)
    .slice(0, 5)
}

function parseTranscript(transcript?: string | null): TranscriptLine[] {
  if (!transcript) return []
  return transcript
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(?:(\d{1,2}:)?\d{1,2}:\d{2}\s+)?([^:]{2,44}):\s+(.+)$/)
      if (!match) return { text: line }
      const timeMatch = line.match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+/)
      return {
        time: timeMatch?.[1],
        speaker: match[2]?.trim(),
        text: match[3]?.trim() || line,
      }
    })
    .slice(0, 80)
}

function readinessBadge(readiness?: MoveReadiness) {
  if (readiness === 'hot') return 'Hot'
  if (readiness === 'warm') return 'Warm'
  if (readiness === 'cold') return 'Cold'
  return null
}

export function CallInsightPanel({
  title = 'Call Intelligence',
  callLabel = 'Call ended',
  callerName = 'Customer',
  timestamp,
  duration,
  branchLabel,
  recordingUrl,
  recordingSid,
  recordingUnavailable,
  recordingUnavailableReason,
  transcript,
  summary,
  moveReadiness,
  processingMessage,
  actions,
  className = '',
}: CallInsightPanelProps) {
  const bullets = summaryBullets(summary)
  const transcriptLines = parseTranscript(transcript)
  const hasRecording = Boolean(recordingUrl || recordingSid)
  const badge = readinessBadge(moveReadiness)
  const details = [callerName, timestamp, duration, branchLabel].filter(Boolean).join(' · ')

  return (
    <div className={`rounded-[10px] border border-[var(--app-line)] bg-white p-4 shadow-sm ${className}`}>
      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <div className="rounded-[10px] bg-[var(--app-bg)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-lg shadow-sm">☎</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-[var(--app-ink)]">{callLabel}</div>
                  {badge ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      moveReadiness === 'hot'
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : moveReadiness === 'warm'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}>
                      {badge}
                    </span>
                  ) : null}
                </div>
                {details ? <div className="mt-1 text-xs leading-5 text-[var(--app-muted)]">{details}</div> : null}
                {hasRecording ? (
                  <div className="mt-3">
                    <RecordingPlayer recordingUrl={recordingUrl} recordingSid={recordingSid} />
                  </div>
                ) : recordingUnavailable ? (
                  <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    {recordingUnavailableReason || 'No playable recording is available for this call.'}
                  </div>
                ) : processingMessage ? (
                  <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs leading-5 text-[var(--app-muted)]">
                    {processingMessage}
                  </div>
                ) : null}
              </div>
              {actions ? <div className="shrink-0">{actions}</div> : null}
            </div>
          </div>

          <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="crm-label">{title}</div>
              <span className="text-[10px] font-semibold text-violet-500">Powered by Saturn Star AI</span>
            </div>
            {bullets.length ? (
              <ul className="mt-3 space-y-2 text-sm leading-6 text-stone-800">
                {bullets.map((line, index) => (
                  <li key={`${line}-${index}`} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm leading-6 text-[var(--app-muted)]">
                {processingMessage || 'No AI summary is available yet.'}
              </p>
            )}

          </div>
        </div>

        <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="crm-label">Transcript</div>
            <span className="text-[10px] font-semibold text-[var(--app-muted)]">{transcriptLines.length ? `${transcriptLines.length} lines` : 'Pending'}</span>
          </div>
          {transcriptLines.length ? (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {transcriptLines.map((line, index) => (
                <div key={`${line.text}-${index}`} className="grid grid-cols-[52px_1fr] gap-3 text-sm leading-6">
                  <div className="text-xs font-medium tabular-nums text-[var(--app-muted)]">{line.time || ''}</div>
                  <div>
                    {line.speaker ? <span className="font-semibold text-[var(--app-ink)]">{line.speaker}: </span> : null}
                    <span className="text-stone-700">{line.text}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[8px] border border-dashed border-[var(--app-line)] bg-white px-4 py-6 text-sm leading-6 text-[var(--app-muted)]">
              {processingMessage || 'Transcript will appear here when processing is complete.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
