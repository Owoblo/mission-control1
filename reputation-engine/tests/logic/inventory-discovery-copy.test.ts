import assert from 'node:assert/strict'
import {
  buildMlsInventoryConfirmationSms,
  buildPhotoSurveyFallbackMessage,
} from '../../lib/sales-automation-inventory-sms'
import type { CRMLead } from '../../lib/types'

const baseLead = {
  id: 'lead_inventory_discovery',
  name: 'Ezgi',
  stage: 'new',
} as CRMLead

const listingMessage = buildMlsInventoryConfirmationSms({
  ...baseLead,
  inventory: [
    { name: 'Sofa', room: 'Living Room', qty: 1, source: 'mls', cubicFeet: 55, weightLbs: 180 },
    { name: 'Nightstand', room: 'Bedroom 1', qty: 2, source: 'mls', cubicFeet: 8, weightLbs: 25 },
  ],
})

assert.match(listingMessage, /property information available in our system/i)
assert.match(listingMessage, /don't have to list everything from scratch/i)
assert.match(listingMessage, /Living Room: Sofa/i)
assert.match(listingMessage, /Bedroom 1: 2 Nightstand/i)
assert.equal((listingMessage.match(/\?/g) || []).length, 1)
assert.doesNotMatch(listingMessage, /\b(price|quote|estimate|\$)\b/i)

const surveyUrl = 'https://go.quote2move.com/survey/surv_test'
const fallbackMessage = buildPhotoSurveyFallbackMessage(baseLead, surveyUrl)
assert.match(fallbackMessage, /property information in our system/i)
assert.match(fallbackMessage, /completely fine/i)
assert.match(fallbackMessage, /text the main furniture/i)
assert.match(fallbackMessage, /upload a few room photos/i)
assert.match(fallbackMessage, new RegExp(surveyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.equal((fallbackMessage.match(/\?/g) || []).length, 1)
assert.doesNotMatch(fallbackMessage, /\b(price|quote|estimate|\$)\b/i)

console.log('inventory discovery copy tests passed')
