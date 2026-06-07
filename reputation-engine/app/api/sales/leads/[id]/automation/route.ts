import { NextResponse } from 'next/server'
import {
  listAutomationJobsForLead,
  saveAutomationJob,
} from '@/lib/server/sales-automation-repository'
import {
  scheduleQuoteExpiryFollowup,
  scheduleQuoteFollowup,
  scheduleQuoteViewedFollowup,
  scheduleSurveyFollowup,
} from '@/lib/server/sales-automation'
import { recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { canControlAutomation, canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { uid } from '@/lib/sales'
import type { AutomationJobKind, AutomationJobStatus, LeadAutomationSettings } from '@/lib/types'

const DEFAULT_AUTOMATION_SETTINGS: Required<LeadAutomationSettings> = {
  nudgeIfQuoteNotOpened: true,
  nudgeIfSurveyNotCompleted: true,
  nudgeIfQuoteViewedNoResponse: true,
  nudgeBeforeQuoteExpires: true,
}

const JOB_KINDS_BY_SETTING: Record<keyof LeadAutomationSettings, AutomationJobKind[]> = {
  nudgeIfQuoteNotOpened: ['quote_followup'],
  nudgeIfSurveyNotCompleted: ['survey_followup'],
  nudgeIfQuoteViewedNoResponse: ['quote_viewed_followup'],
  nudgeBeforeQuoteExpires: ['quote_expiry_followup'],
}

const LISTABLE_AUTOMATION_KINDS: AutomationJobKind[] = [
  'quote_followup',
  'quote_viewed_followup',
  'quote_expiry_followup',
  'survey_followup',
  'move_reminder',
  'stale_reactivation',
  'lost_feedback',
]

function automationJobLabel(kind: AutomationJobKind) {
  if (kind === 'quote_followup') return 'quote not-opened'
  if (kind === 'quote_viewed_followup') return 'quote-viewed'
  if (kind === 'quote_expiry_followup') return 'quote-expiry'
  if (kind === 'survey_followup') return 'survey'
  if (kind === 'move_reminder') return 'move reminder'
  if (kind === 'stale_reactivation') return 'stale reactivation'
  if (kind === 'lost_feedback') return 'lost feedback'
  return 'automation'
}

function resolveAutomationSettings(settings?: LeadAutomationSettings | null): Required<LeadAutomationSettings> {
  return {
    ...DEFAULT_AUTOMATION_SETTINGS,
    ...(settings || {}),
  }
}

function normalizeSettingsPatch(settings?: LeadAutomationSettings | null) {
  if (!settings) return undefined
  const next: LeadAutomationSettings = {}

  if (Object.prototype.hasOwnProperty.call(settings, 'nudgeIfQuoteNotOpened')) {
    next.nudgeIfQuoteNotOpened = !!settings.nudgeIfQuoteNotOpened
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'nudgeIfSurveyNotCompleted')) {
    next.nudgeIfSurveyNotCompleted = !!settings.nudgeIfSurveyNotCompleted
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'nudgeIfQuoteViewedNoResponse')) {
    next.nudgeIfQuoteViewedNoResponse = !!settings.nudgeIfQuoteViewedNoResponse
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'nudgeBeforeQuoteExpires')) {
    next.nudgeBeforeQuoteExpires = !!settings.nudgeBeforeQuoteExpires
  }

  return next
}

async function cancelJobsForKinds(leadId: string, kinds: AutomationJobKind[], reason: string) {
  if (kinds.length === 0) return
  const jobs = await listAutomationJobsForLead({
    leadId,
    kinds,
    statuses: ['pending', 'running'],
    limit: 100,
  })

  await Promise.all(
    jobs.map(job =>
      saveAutomationJob({
        ...job,
        status: 'cancelled',
        lockedAt: null,
        result: { reason },
        lastError: null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
    )
  )
}

async function syncLeadNudgeSchedules(
  leadId: string,
  settings: Required<LeadAutomationSettings>,
  previousSettings: Required<LeadAutomationSettings>
) {
  const disabledKeys = (Object.keys(JOB_KINDS_BY_SETTING) as Array<keyof LeadAutomationSettings>).filter(
    key => previousSettings[key] && !settings[key]
  )

  for (const key of disabledKeys) {
    await cancelJobsForKinds(leadId, JOB_KINDS_BY_SETTING[key], `Cancelled because ${key} was turned off.`)
  }

  if (settings.nudgeIfQuoteNotOpened) {
    await scheduleQuoteFollowup(leadId).catch(() => null)
  }
  if (settings.nudgeIfQuoteViewedNoResponse) {
    await scheduleQuoteViewedFollowup(leadId).catch(() => null)
  }
  if (settings.nudgeBeforeQuoteExpires) {
    await scheduleQuoteExpiryFollowup(leadId).catch(() => null)
  }
  if (settings.nudgeIfSurveyNotCompleted) {
    await scheduleSurveyFollowup(leadId).catch(() => null)
  }
}

async function listLeadAutomationJobs(leadId: string) {
  return listAutomationJobsForLead({
    leadId,
    kinds: LISTABLE_AUTOMATION_KINDS,
    statuses: ['pending', 'running'],
    limit: 50,
  })
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!canControlAutomation(session, lead)) {
      return NextResponse.json({ error: 'You cannot view automation on a lead you do not own.' }, { status: 403 })
    }

    const jobs = await listLeadAutomationJobs(lead.id)
    return NextResponse.json({
      lead,
      settings: resolveAutomationSettings(lead.automationSettings),
      jobs,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load automation state' },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!canControlAutomation(session, lead)) {
      return NextResponse.json({ error: 'You cannot change automation on a lead you do not own.' }, { status: 403 })
    }

    const body = (await request.json()) as {
      action?: 'cancel_job'
      jobId?: string
      automationStatus?: 'idle' | 'active' | 'paused' | 'handoff' | 'do_not_contact'
      pauseHours?: number
      pauseUntil?: string | null
      pauseReason?: string | null
      handoffReason?: string | null
      clearPause?: boolean
      settings?: LeadAutomationSettings | null
    }

    if (body.action === 'cancel_job' && body.jobId) {
      const jobs = await listLeadAutomationJobs(lead.id)
      const job = jobs.find(item => item.id === body.jobId)
      if (!job) {
        return NextResponse.json({ error: 'Automation job not found for this lead.' }, { status: 404 })
      }

      const cancelled =
        (await saveAutomationJob({
          ...job,
          status: 'cancelled' as AutomationJobStatus,
          lockedAt: null,
          result: {
            ...(job.result || {}),
            reason: `Cancelled by ${session?.name || 'rep'}.`,
          },
          lastError: null,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        })) || job

      await saveFollowUpLog({
        id: uid('fu'),
        leadId: lead.id,
        type: 'note',
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        notes: `Automation update: cancelled scheduled ${automationJobLabel(job.kind)} nudge due ${job.dueAt}.`,
      }).catch(() => {})

      return NextResponse.json({
        lead,
        settings: resolveAutomationSettings(lead.automationSettings),
        job: cancelled,
        jobs: await listLeadAutomationJobs(lead.id),
      })
    }

    const settingsPatch = normalizeSettingsPatch(body.settings)
    const previousSettings = resolveAutomationSettings(lead.automationSettings)
    const nextSettings = settingsPatch
      ? resolveAutomationSettings({
          ...lead.automationSettings,
          ...settingsPatch,
        })
      : previousSettings

    const pauseUntil =
      body.clearPause
        ? undefined
        : body.pauseUntil === null
          ? undefined
          : body.pauseUntil || (body.pauseHours ? new Date(Date.now() + body.pauseHours * 60 * 60 * 1000).toISOString() : lead.automationPausedUntil)

    const next = await saveSalesLead({
      ...lead,
      automationSettings: nextSettings,
      automationStatus: body.automationStatus || lead.automationStatus || 'active',
      automationPausedUntil: pauseUntil,
      automationPauseReason:
        body.clearPause
          ? undefined
          : body.pauseReason === null
            ? undefined
            : body.pauseReason || lead.automationPauseReason,
      automationHandoffAt:
        body.automationStatus === 'handoff'
          ? new Date().toISOString()
          : body.automationStatus
            ? undefined
            : lead.automationHandoffAt,
      automationHandoffReason:
        body.automationStatus === 'handoff'
          ? body.handoffReason || lead.automationHandoffReason
          : body.automationStatus
            ? undefined
            : lead.automationHandoffReason,
    })
    await recordLeadUpdateAudit(lead, next)

    if (settingsPatch) {
      await syncLeadNudgeSchedules(next.id, nextSettings, previousSettings)
      await saveFollowUpLog({
        id: uid('fu'),
        leadId: next.id,
        type: 'note',
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        notes: `Automation settings updated: quote unopened ${nextSettings.nudgeIfQuoteNotOpened ? 'on' : 'off'}, survey ${nextSettings.nudgeIfSurveyNotCompleted ? 'on' : 'off'}, quote viewed ${nextSettings.nudgeIfQuoteViewedNoResponse ? 'on' : 'off'}, quote expiry ${nextSettings.nudgeBeforeQuoteExpires ? 'on' : 'off'}.`,
      }).catch(() => {})
    }

    return NextResponse.json({
      lead: next,
      settings: nextSettings,
      jobs: await listLeadAutomationJobs(next.id),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update automation state' },
      { status: 400 }
    )
  }
}
