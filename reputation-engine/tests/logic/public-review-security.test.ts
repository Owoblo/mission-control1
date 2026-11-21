import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueReviewCapability, verifyReviewCapability } from '../../lib/server/review-capability'
import { applyPublicReview, publicReview } from '../../lib/public-review'
import type { Job } from '../../lib/types'
const job: Job = { id:'job-test',customerName:'Jane Test',customerEmail:'private@example.test',customerPhone:'private',moveDate:'',moveFrom:'private',moveTo:'private',crewLead:'private',status:'sent',reviews:{google:false,yelp:false,facebook:false,media:false},reviewConfirmedAt:{},incentiveEarned:false,incentivePaid:false,proofSentToPartner:false,createdAt:'2026-01-01' }
test('Review capabilities bind purpose/resource/version/expiry and resist tampering', () => {
  const prior = process.env.AUTH_SECRET;process.env.AUTH_SECRET='test-only-signing-secret-not-production'
  try {
    const now = Date.now();const token = issueReviewCapability(job,now)
    assert.equal(verifyReviewCapability(token,job,now),true)
    assert.equal(verifyReviewCapability(token,{...job,id:'another'},now),false)
    assert.equal(verifyReviewCapability(token,{...job,reviewAccessVersion:1},now),false)
    assert.equal(verifyReviewCapability(token,job,now+31*86400000),false)
    assert.equal(verifyReviewCapability(token+'x',job,now),false)
    assert.equal(verifyReviewCapability('',job,now),false)
  } finally { if(prior===undefined) delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=prior }
})
test('Public review DTO excludes identity, locations, staff and internal notes', () => {
  const result=publicReview({...job,crmLeadId:'internal',customerExperience:{googleStatus:'not_started',yelpAccountStatus:'unknown',yelpStatus:'not_started',videoStatus:'not_started',privateFeedbackStatus:'not_started',notes:'private'}})
  assert.equal(result.customerName,'Jane');assert.equal(JSON.stringify(result).includes('private'),false)
  assert.equal('crmLeadId' in result,false)
})
test('Customer feedback cannot set payout/status or inject unknown platforms/timestamps', () => {
  for(const input of [{incentiveEarned:true},{status:'complete'},{reviewConfirmedAt:{google:'old'}},{reviews:{other:true}},{feedbackRating:6},{feedbackRating:NaN}]) assert.throws(()=>applyPublicReview(job,input))
  const saved=applyPublicReview(job,{feedbackRating:5,reviews:{google:true}},'2026-09-16T00:00:00Z')
  assert.equal(saved.reviewConfirmedAt.google,'2026-09-16T00:00:00Z');assert.equal(saved.incentiveEarned,false)
  assert.equal(applyPublicReview(saved,{reviews:{google:false}}).reviews.google,true)
})
