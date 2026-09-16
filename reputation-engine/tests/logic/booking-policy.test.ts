import { test } from 'node:test'
import assert from 'node:assert/strict'
import {bookingDecision,hasFullQuotePayment} from '../../lib/booking-policy'
import {syncLeadFromQuoteStatus} from '../../lib/sales'
import type {CRMLead,CRMQuote} from '../../lib/types'
const lead:CRMLead={id:'l',name:'Test',stage:'quoted',createdAt:'2026-01-01'}
const quote:CRMQuote={id:'q',leadId:'l',number:'Q1',clientId:'c',status:'accepted',lineItems:[],subtotal:1000,hst:0,total:1000,deposit:250,balance:750,createdAt:'2026-01-01'}
test('Accepted quote without deposit is tentative, not a confirmed sale',()=>{
 assert.equal(syncLeadFromQuoteStatus(lead,quote).stage,'tentative')
 assert.equal(bookingDecision(lead,{...quote,depositPaidAt:'2026-09-16'}).confirmed,false)
 assert.equal(bookingDecision(lead,{...quote,depositPaidAmount:249}).confirmed,false)
})
test('Accepted paid deposit confirms sale without requiring assigned crew',()=>{
 assert.equal(syncLeadFromQuoteStatus(lead,{...quote,depositPaidAmount:250}).stage,'booked')
 assert.equal(bookingDecision(lead,{...quote,status:'sent',depositPaidAmount:250}).confirmed,false)
})
test('Historical commitments and completed jobs survive incomplete financial evidence',()=>{
 for(const stage of ['booked','completed','customer_success'] as const)assert.equal(syncLeadFromQuoteStatus({...lead,stage},quote).stage,stage)
})
test('Zero-deposit commercial terms require explicit staff approval',()=>{
 assert.equal(bookingDecision(lead,{...quote,status:'invoiced',deposit:0}).reason,'commercial_approval_required')
 assert.equal(bookingDecision({...lead,stage:'booked'},{...quote,deposit:0}).confirmed,true)
})
test('Missing quote, partial payment timestamp and default zero balance do not imply fully paid',()=>{
 assert.equal(hasFullQuotePayment({paymentStatus:'pending'},null),false)
 assert.equal(hasFullQuotePayment({paymentStatus:'deposit_received'},{...quote,balance:0,balancePaidAt:'2026-09-16',balancePaidAmount:100}),false)
 assert.equal(hasFullQuotePayment({paymentStatus:'pending'},{...quote,depositPaidAmount:250,balancePaidAmount:750}),true)
})
