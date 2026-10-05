import type { CRMLead } from './types'
import { lostTransitionError } from './lead-verification'

/** Only server-confirmed transitions may disappear from the follow-up wall. */
export async function saveFollowUpLosses(leads: CRMLead[], patch: Partial<CRMLead>, save: (id: string, patch: Partial<CRMLead>) => Promise<CRMLead>) {
  const saved: CRMLead[] = []
  const failed: Array<{ id: string; name: string; error: string }> = []
  for (let start = 0; start < leads.length; start += 4) {
    await Promise.all(leads.slice(start, start + 4).map(async lead => {
      try {
        if (patch.stage !== 'lost') throw new Error('Choose a loss reason for these leads.')
        const invalid = lostTransitionError(lead, { ...lead, ...patch })
        if (invalid) throw new Error(invalid)
        const result = await save(lead.id, patch)
        if (result.id !== lead.id || result.stage !== 'lost') throw new Error('The server did not confirm this lead as lost. Reload before retrying.')
        saved.push(result)
      } catch (error) {
        failed.push({ id: lead.id, name: lead.name || lead.id, error: error instanceof Error ? error.message : 'Save failed' })
      }
    }))
  }
  return { saved, failed }
}
