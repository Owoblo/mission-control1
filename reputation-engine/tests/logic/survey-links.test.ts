import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PHOTO_SURVEY_LINK_TTL_DAYS,
  isPhotoSurveyLinkExpired,
  photoSurveyLinkExpiresAt,
} from '../../lib/survey-links'

test('photo survey links remain active for 30 days', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z')
  assert.equal(photoSurveyLinkExpiresAt(now), '2026-09-13T12:00:00.000Z')
  assert.equal(PHOTO_SURVEY_LINK_TTL_DAYS, 30)
})

test('expired photo survey timestamps are rejected while legacy links remain usable', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z')
  assert.equal(isPhotoSurveyLinkExpired('2026-08-14T11:59:59.999Z', now), true)
  assert.equal(isPhotoSurveyLinkExpired('2026-08-14T12:00:00.000Z', now), true)
  assert.equal(isPhotoSurveyLinkExpired('2026-08-14T12:00:00.001Z', now), false)
  assert.equal(isPhotoSurveyLinkExpired(undefined, now), false)
})
