import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyPartnershipEmail, currentEmailReply, emailText, extractEmailReferralContacts } from '../../lib/partnership-email-replies'
test('offered not-interested reply phrase suppresses without swallowing qualified replies or quoted copy', () => {
 for (const body of ['No thanks', 'No thank you.', 'Not interested', 'Not interested. Thanks!', 'No thanks, not interested.', 'No thanks\n\n--\nJane Smith\nExample Company', 'No thanks.\n\nKind regards,\nJane Smith', 'No thanks\nSent from my iPhone', 'Not interested\n\nOn October 27, John wrote:\nWould you like a card?']) {
  assert.equal(classifyPartnershipEmail('Re: local moving support', body), 'opt_out')
 }
 assert.equal(classifyPartnershipEmail('Re: local moving support', 'Not interested in junk removal, but please send moving details.'), 'reply')
 assert.equal(classifyPartnershipEmail('Re: local moving support', 'No thanks to a meeting, but please send the card.'), 'reply')
 assert.equal(classifyPartnershipEmail('Re: local moving support', 'No thanks\nBut please send moving details.\n\nRegards,\nJane Smith'), 'reply')
 assert.equal(classifyPartnershipEmail('Re: local moving support', 'Please send your card.\n\nFrom: John\nReply not interested and I will stop.'), 'reply')
})
test('ticket acknowledgment excludes original inquiry and is not a human referral', () => {
 const body='****AUTOMATIC RESPONSE********\nYour inquiry has been successfully submitted.\n - ————— ORIGINAL INQUIRY BELOW —————\nWho would be the best person to speak with?\nPlease unsubscribe me.'
 assert.equal(currentEmailReply(body).includes('best person'),false)
 assert.equal(classifyPartnershipEmail('Thank you for your inquiry [Ticket#631457]',body),'automatic_reply')
})
test('City routing reply is not mistaken for an opt-out in quoted sender footer', () => {
 const body=emailText('<div>Hello,</div><div>You can reach out to Facility Department.</div><div>From: John</div><div>If you prefer no further emails, unsubscribe me.</div>')
 assert.equal(classifyPartnershipEmail('RE: Moving support for your team',body),'handoff')
 assert.equal(currentEmailReply(body).includes('unsubscribe'),false)
})
test('Innomation confirmation is automatic even though it names a human reviewer', () => {
 assert.equal(classifyPartnershipEmail('Your email requires verification verify#123','Your message will need to be MANUALLY REVIEWED by Leslie once verified.'),'verification')
})
test('delivery failures, absence messages, human replies and explicit opt-outs remain distinct', () => {
 assert.equal(classifyPartnershipEmail('Undeliverable: Moving support','Recipient not found'),'delivery_failure')
 assert.equal(classifyPartnershipEmail('Automatic reply: Moving support','Away until Monday'),'automatic_reply')
 assert.equal(classifyPartnershipEmail('Re: Moving support','Please remove me from this list.'),'opt_out')
 assert.equal(classifyPartnershipEmail('Re: Moving support','Thanks, please send your details.'),'reply')
})

test('verification acknowledgment awaits review instead of triggering another confirmation', () => {
 assert.equal(classifyPartnershipEmail('Your message has been added to the review inbox', 'Your verification was received. White Listed PENDING Review by Leslie. No other action is needed.'), 'verification_pending_review')
})

test('named urgent contact is captured with its restriction and normalized phone', () => {
 const rows=extractEmailReferralContacts('If the message is URGENT, please call Leslie Pillon immediately at (519) 965-2299. No other action is needed.')
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Leslie Pillon');assert.equal(rows[0].phone,'+15199652299');assert.equal(rows[0].urgentOnly,true)
 assert.equal(extractEmailReferralContacts('Contact Facility Department for more information.').length,0)
})
