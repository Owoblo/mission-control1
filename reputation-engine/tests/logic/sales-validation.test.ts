import assert from 'node:assert/strict'
import { validateLeadPatchPayload } from '../../lib/server/sales-validation'

{
  const updates = validateLeadPatchPayload({
    followUpDate: '2026-05-15',
  })

  assert.equal(updates.followUpDate, '2026-05-15')
}
