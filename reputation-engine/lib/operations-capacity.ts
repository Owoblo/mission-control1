import { getQuotedTruckCount } from './operations'
import type { CRMLead, CRMQuote } from './types'

export type CapacityJob = {
  lead: CRMLead
  quote: CRMQuote | null
}

export type BranchCapacityRisk = 'low' | 'medium' | 'high' | 'unknown'

export type BranchCapacitySnapshot = {
  status: 'ready' | 'unavailable'
  jobsBooked: number
  crewUsed: number
  crewCapacity: number
  crewPct: number
  trucksUsed: number
  truckCapacity: number
  truckPct: number
  trucksRemaining: number
  risk: BranchCapacityRisk
  note?: string
}

export type CapacityConflict = {
  date: string
  branch: NonNullable<CRMLead['branch']>
  jobsBooked: number
  crewUsed: number
  crewCapacity: number
  trucksUsed: number
  truckCapacity: number
  crewOverage: number
  truckOverage: number
}

export const BRANCH_CAPACITY_ESTIMATES: Record<NonNullable<CRMLead['branch']>, { crew: number; trucks: number }> = {
  windsor: { crew: 16, trucks: 5 },
  waterloo: { crew: 12, trucks: 4 },
  london: { crew: 10, trucks: 3 },
  ottawa: { crew: 10, trucks: 3 },
}

function pct(value: number, total: number) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

function getJobCrewSize(job: CapacityJob) {
  return Math.max(
    Number(job.quote?.crewSize || 0),
    Number(job.lead.assignedCrew?.length || 0),
    0
  )
}

function getJobMoveDate(job: CapacityJob) {
  return job.lead.moveDate || job.quote?.moveDate
}

function getJobBranch(job: CapacityJob) {
  return job.lead.branch
}

export function computeBranchCapacitySnapshot(
  jobs: CapacityJob[],
  branch: CRMLead['branch'] | undefined,
  date: string
): BranchCapacitySnapshot {
  if (!branch || !BRANCH_CAPACITY_ESTIMATES[branch]) {
    return {
      status: 'unavailable',
      jobsBooked: 0,
      crewUsed: 0,
      crewCapacity: 0,
      crewPct: 0,
      trucksUsed: 0,
      truckCapacity: 0,
      truckPct: 0,
      trucksRemaining: 0,
      risk: 'unknown',
      note: 'Capacity estimate unavailable for this branch.',
    }
  }

  const dayJobs = jobs.filter(job => getJobBranch(job) === branch && getJobMoveDate(job) === date)
  const crewCapacity = BRANCH_CAPACITY_ESTIMATES[branch].crew
  const truckCapacity = BRANCH_CAPACITY_ESTIMATES[branch].trucks
  const crewUsed = dayJobs.reduce((sum, job) => sum + getJobCrewSize(job), 0)
  const trucksUsed = dayJobs.reduce((sum, job) => sum + Number(getQuotedTruckCount(job.lead, job.quote) || 0), 0)
  const trucksRemaining = Math.max(0, truckCapacity - trucksUsed)
  const crewPct = pct(crewUsed, crewCapacity)
  const truckPct = pct(trucksUsed, truckCapacity)

  let risk: BranchCapacityRisk = 'low'
  let note = `${dayJobs.length} job${dayJobs.length === 1 ? '' : 's'} scheduled.`

  if (crewUsed > crewCapacity || trucksUsed > truckCapacity) {
    risk = 'high'
    note = 'Booked work exceeds estimated branch capacity.'
  } else if (crewPct >= 85 || truckPct >= 85 || trucksRemaining <= 1) {
    risk = 'medium'
    note = 'Branch is close to capacity. Confirm truck and crew coverage.'
  }

  return {
    status: 'ready',
    jobsBooked: dayJobs.length,
    crewUsed,
    crewCapacity,
    crewPct,
    trucksUsed,
    truckCapacity,
    truckPct,
    trucksRemaining,
    risk,
    note,
  }
}

export function listCapacityConflicts(jobs: CapacityJob[]) {
  const dates = Array.from(new Set(jobs.map(getJobMoveDate).filter(Boolean))) as string[]
  const conflicts: CapacityConflict[] = []

  for (const date of dates) {
    const branches = Array.from(
      new Set(
        jobs
          .filter(job => getJobMoveDate(job) === date)
          .map(getJobBranch)
          .filter((branch): branch is NonNullable<CRMLead['branch']> => !!branch)
      )
    )

    for (const branch of branches) {
      const snapshot = computeBranchCapacitySnapshot(jobs, branch, date)
      if (snapshot.status !== 'ready') continue
      const crewOverage = Math.max(0, snapshot.crewUsed - snapshot.crewCapacity)
      const truckOverage = Math.max(0, snapshot.trucksUsed - snapshot.truckCapacity)
      if (crewOverage <= 0 && truckOverage <= 0) continue
      conflicts.push({
        date,
        branch,
        jobsBooked: snapshot.jobsBooked,
        crewUsed: snapshot.crewUsed,
        crewCapacity: snapshot.crewCapacity,
        trucksUsed: snapshot.trucksUsed,
        truckCapacity: snapshot.truckCapacity,
        crewOverage,
        truckOverage,
      })
    }
  }

  return conflicts.sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch))
}
