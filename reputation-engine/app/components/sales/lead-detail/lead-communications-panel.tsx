'use client'

import type { ReactNode, RefObject } from 'react'
import {
  getSaturnBranchLabel,
  getSaturnBusinessNumberFromSmsMessage,
} from '@/lib/sales-phones'
import type { CRMLead } from '@/lib/types'

export interface LeadEmailMessage {
  id: string
  from: string
  to: string
  subject: string
  body: string
  direction: 'inbound' | 'outbound'
  sentAt: string
  leadId?: string | null
}

export interface LeadSmsMessage {
  id: string
  from_number: string
  to_number: string
  body: string
  direction: 'inbound' | 'outbound'
  lead_id: string | null
  created_at: string
  twilio_sid?: string | null
}

type CommunicationsTab = 'timeline' | 'emails' | 'sms'

type Props = {
  lead: CRMLead
  activeTab: CommunicationsTab
  canHandleCommunication: boolean
  timeline: ReactNode
  emailThread: {
    messages: LeadEmailMessage[]
    loading: boolean
  }
  smsThread: {
    messages: LeadSmsMessage[]
    loading: boolean
    sending: boolean
    input: string
    channel: 'sms' | 'whatsapp'
    preferredBranchLabel: string
    areaRef: RefObject<HTMLDivElement>
  }
  composer: {
    open: boolean
    channel: 'sms' | 'email'
    subject: string
    body: string
    busy: boolean
    smartComposeBusy: boolean
  }
  onTabChange: (tab: CommunicationsTab) => void
  onOpenComposer: (channel: 'sms' | 'email') => void
  onComposerChannelChange: (channel: 'sms' | 'email') => void
  onComposerSubjectChange: (value: string) => void
  onComposerBodyChange: (value: string, options?: { userEdited?: boolean }) => void
  onRequestSmartCompose: (channel: 'sms' | 'email') => void
  onSendComposer: () => void
  onCloseComposer: () => void
  onSmsSync: () => void
  onSmsInputChange: (value: string) => void
  onSmsChannelChange: (channel: 'sms' | 'whatsapp') => void
  onSmsSend: () => void
}

export function LeadCommunicationsPanel({
  lead,
  activeTab,
  canHandleCommunication,
  timeline,
  emailThread,
  smsThread,
  composer,
  onTabChange,
  onOpenComposer,
  onComposerChannelChange,
  onComposerSubjectChange,
  onComposerBodyChange,
  onRequestSmartCompose,
  onSendComposer,
  onCloseComposer,
  onSmsSync,
  onSmsInputChange,
  onSmsChannelChange,
  onSmsSend,
}: Props) {
  const inboundEmailCount = emailThread.messages.length
  const inboundSmsCount = smsThread.messages.filter(message => message.direction === 'inbound').length
  const lastInboundEmail = emailThread.messages.find(message => message.direction === 'inbound')
  const defaultEmailSubject = lastInboundEmail
    ? `Re: ${lastInboundEmail.subject}`
    : 'Following up — Saturn Star Moving'

  return (
    <>
      <div className="flex items-center gap-1 border-b border-[var(--app-line)] bg-[var(--app-panel)] px-4 pt-3">
        <button
          onClick={() => onTabChange('timeline')}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'timeline' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
        >
          Timeline
        </button>
        {lead.email ? (
          <button
            onClick={() => onTabChange('emails')}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'emails' ? 'border-[var(--app-accent)] text-[var(--app-accent)]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
          >
            Emails
            {inboundEmailCount > 0 ? (
              <span className="rounded-full bg-[rgba(34,72,56,0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-accent)]">
                {inboundEmailCount}
              </span>
            ) : null}
          </button>
        ) : null}
        {lead.phone ? (
          <button
            onClick={() => onTabChange('sms')}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-medium transition ${activeTab === 'sms' ? 'border-[#f5a623] text-[#f5a623]' : 'border-transparent text-[var(--app-muted)] hover:text-[var(--app-ink)]'}`}
          >
            💬 SMS
            {inboundSmsCount > 0 ? (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: '#f5a623' }}>
                {inboundSmsCount}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {activeTab === 'timeline' ? timeline : null}

      {activeTab === 'emails' ? (
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
            <div>
              <div className="text-sm font-semibold text-[var(--app-ink)]">Email Thread</div>
              <div className="text-xs text-[var(--app-muted)]">{lead.email}</div>
            </div>
            <button
              onClick={() => onOpenComposer('email')}
              className="crm-button-dark text-xs"
            >
              ✉️ Compose
            </button>
          </div>

          {emailThread.loading ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--app-muted)]">Loading emails…</div>
          ) : emailThread.messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="text-3xl">✉️</div>
              <div className="text-sm font-medium text-[var(--app-ink)]">No emails yet</div>
              <div className="text-xs text-[var(--app-muted)]">Emails sent and received from {lead.email} will appear here.</div>
              <button onClick={() => onOpenComposer('email')} className="crm-button-dark mt-1 text-xs">Send First Email</button>
            </div>
          ) : (
            <div className="flex-1 divide-y divide-[var(--app-line)] overflow-y-auto">
              {emailThread.messages.map((message, index) => (
                <div key={message.id} className={`px-5 py-4 ${message.direction === 'inbound' ? 'bg-[rgba(245,166,35,0.04)]' : 'bg-[var(--app-panel)]'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${message.direction === 'inbound' ? 'bg-[var(--app-ink)]' : 'bg-[var(--app-accent)]'}`}>
                      {message.direction === 'inbound' ? (lead.name?.slice(0, 1) || message.from.slice(0, 1)).toUpperCase() : 'S'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--app-ink)]">
                            {message.direction === 'inbound' ? (lead.name || message.from) : 'Saturn Star Movers'}
                          </span>
                          {index === 0 && message.direction === 'inbound' ? (
                            <span className="rounded-[4px] border border-[var(--app-warm)] bg-[rgba(245,166,35,0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--app-warm)]">New</span>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-[var(--app-muted)]">
                          {new Date(message.sentAt).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--app-muted)]">{message.subject}</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--app-ink)]">{message.body}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="shrink-0 space-y-2 border-t border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
            <input
              value={composer.channel === 'email' ? composer.subject : defaultEmailSubject}
              onChange={event => {
                onComposerChannelChange('email')
                onComposerSubjectChange(event.target.value)
              }}
              onFocus={() => {
                onComposerChannelChange('email')
                if (!composer.subject) {
                  onComposerSubjectChange(defaultEmailSubject)
                }
              }}
              className="w-full rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-ink)] focus:border-[var(--app-accent)] focus:outline-none"
              placeholder="Subject…"
              disabled={!canHandleCommunication}
            />
            <textarea
              value={composer.channel === 'email' ? composer.body : ''}
              onChange={event => {
                onComposerChannelChange('email')
                onComposerBodyChange(event.target.value, { userEdited: true })
              }}
              onFocus={() => {
                const shouldDraft = composer.channel !== 'email' && !composer.body
                onComposerChannelChange('email')
                if (shouldDraft) {
                  onRequestSmartCompose('email')
                }
              }}
              className="w-full resize-none rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-ink)] focus:border-[var(--app-accent)] focus:outline-none"
              placeholder="Write a reply…"
              rows={3}
              disabled={!canHandleCommunication}
            />
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  onComposerChannelChange('email')
                  onRequestSmartCompose('email')
                }}
                disabled={!canHandleCommunication || composer.smartComposeBusy}
                className="text-xs text-[var(--app-muted)] hover:text-[var(--app-accent)] disabled:opacity-40"
              >
                {composer.smartComposeBusy ? '✨ Drafting…' : '✨ AI Draft'}
              </button>
              <button
                onClick={() => {
                  onComposerChannelChange('email')
                  onSendComposer()
                }}
                disabled={!canHandleCommunication || composer.busy || !composer.body.trim() || composer.channel !== 'email'}
                className="rounded-[8px] bg-[var(--app-ink)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {composer.busy ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'sms' ? (
        <div className="flex h-full flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--app-line)] bg-[var(--app-panel)] px-5 py-3">
            <div>
              <div className="text-sm font-semibold" style={{ color: '#1a2744' }}>SMS Conversation</div>
              <div className="text-xs text-[var(--app-muted)]">
                {lead.phone}
                {smsThread.preferredBranchLabel ? ` • replying as ${smsThread.preferredBranchLabel}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onSmsSync}
                className="rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-1.5 text-xs text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
                disabled={smsThread.loading}
              >
                {smsThread.loading ? '…' : '↺ Sync'}
              </button>
              <button
                onClick={() => onOpenComposer('sms')}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ background: '#1a2744' }}
              >
                ✨ AI Draft
              </button>
            </div>
          </div>

          <div ref={smsThread.areaRef} className="flex-1 overflow-y-auto px-4 py-4" style={{ background: '#f9fafb' }}>
            {smsThread.loading && smsThread.messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--app-muted)]">Loading messages…</div>
            ) : smsThread.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="text-4xl">💬</div>
                <div className="text-sm font-semibold" style={{ color: '#1a2744' }}>No messages yet</div>
                <div className="text-xs text-[var(--app-muted)]">Send the first message to {lead.name || lead.phone} below.</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {smsThread.messages.map(message => {
                  const isOutbound = message.direction === 'outbound'
                  const branchLabel = getSaturnBranchLabel(getSaturnBusinessNumberFromSmsMessage(message))
                  const isWhatsApp = message.twilio_sid?.startsWith('WA') ?? false

                  return (
                    <div key={message.id} className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
                      <div
                        className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
                        style={isOutbound
                          ? { background: isWhatsApp ? '#25D366' : '#1a2744', color: 'white', borderBottomRightRadius: '4px' }
                          : { background: 'white', color: '#1a2744', border: '1px solid #e5e7eb', borderBottomLeftRadius: '4px' }}
                      >
                        {message.body}
                      </div>
                      <div className="mt-0.5 px-1 text-[10px] text-[var(--app-muted)]">
                        {isWhatsApp ? <span className="mr-1 text-[#25D366]">WhatsApp ·</span> : null}
                        {new Date(message.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        {branchLabel ? ` • ${branchLabel}` : ''}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              {smsThread.preferredBranchLabel ? (
                <div className="text-xs text-[var(--app-muted)]">
                  From <span className="font-semibold text-[var(--app-ink)]">{smsThread.preferredBranchLabel}</span>
                </div>
              ) : <div />}
              <div className="flex items-center gap-1 rounded-lg border border-[var(--app-line)] bg-[var(--app-bg)] p-0.5">
                <button
                  type="button"
                  onClick={() => onSmsChannelChange('sms')}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${smsThread.channel === 'sms' ? 'bg-[#1a2744] text-white' : 'text-[var(--app-muted)]'}`}
                >
                  SMS
                </button>
                <button
                  type="button"
                  onClick={() => onSmsChannelChange('whatsapp')}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${smsThread.channel === 'whatsapp' ? 'bg-[#25D366] text-white' : 'text-[var(--app-muted)]'}`}
                >
                  WhatsApp
                </button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={smsThread.input}
                onChange={event => onSmsInputChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    if (!smsThread.sending && smsThread.input.trim() && lead.phone) {
                      onSmsSend()
                    }
                  }
                }}
                placeholder={`Message ${lead.name?.split(' ')[0] || lead.phone}…`}
                rows={1}
                disabled={!canHandleCommunication || smsThread.sending}
                className="flex-1 resize-none rounded-xl border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm text-[var(--app-ink)] placeholder:text-[var(--app-muted)] focus:outline-none focus:ring-1"
                style={{ maxHeight: '120px', overflowY: 'auto', ['--tw-ring-color' as string]: '#f5a623' }}
                onInput={event => {
                  const field = event.currentTarget
                  field.style.height = 'auto'
                  field.style.height = `${field.scrollHeight}px`
                }}
              />
              <button
                disabled={!canHandleCommunication || smsThread.sending || !smsThread.input.trim()}
                onClick={onSmsSend}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-40"
                style={{ background: smsThread.sending ? '#ccc' : '#f5a623' }}
              >
                {smsThread.sending ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
                )}
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-[var(--app-muted)]">Enter to send · Shift+Enter for new line · ✨ AI Draft for a smart opener</div>
          </div>
        </div>
      ) : null}

      {composer.open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 md:items-center md:p-4">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-[14px] border border-[var(--app-line)] bg-[var(--app-panel)] shadow-2xl md:max-w-2xl md:rounded-[10px]">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-4 md:px-5">
              <div>
                <div className="crm-label">{composer.channel === 'sms' ? 'SMS Composer' : 'Email Composer'}</div>
                <div className="mt-1 text-sm text-[var(--app-muted)]">
                  Sending to {composer.channel === 'sms' ? lead.phone || 'No phone' : lead.email || 'No email'}
                </div>
              </div>
              <button onClick={onCloseComposer} className="crm-button">Close</button>
            </div>
            <div className="space-y-4 px-4 py-5 md:px-5">
              {composer.channel === 'email' ? (
                <input
                  value={composer.subject}
                  onChange={event => onComposerSubjectChange(event.target.value)}
                  disabled={!canHandleCommunication}
                  className="crm-input"
                  placeholder="Email subject"
                />
              ) : null}
              <textarea
                value={composer.body}
                onChange={event => onComposerBodyChange(event.target.value, { userEdited: true })}
                disabled={!canHandleCommunication}
                className={`crm-input min-h-56 transition-opacity ${composer.smartComposeBusy ? 'opacity-50' : 'opacity-100'}`}
                placeholder={composer.channel === 'sms' ? 'Type your SMS...' : 'Type your email...'}
              />
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-[var(--app-line)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
              <button
                onClick={() => onRequestSmartCompose(composer.channel)}
                disabled={!canHandleCommunication || composer.smartComposeBusy}
                className="text-sm text-[var(--app-muted)] transition-colors hover:text-[var(--app-accent)] disabled:opacity-40"
              >
                {composer.smartComposeBusy ? '✨ AI drafting...' : '✨ Regenerate'}
              </button>
              <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center">
                <button onClick={onCloseComposer} className="crm-button w-full md:w-auto">Cancel</button>
                <button onClick={onSendComposer} disabled={!canHandleCommunication || composer.busy || !composer.body.trim()} className="crm-button-dark disabled:opacity-60">
                  {composer.busy ? 'Sending...' : composer.channel === 'sms' ? 'Send SMS' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
