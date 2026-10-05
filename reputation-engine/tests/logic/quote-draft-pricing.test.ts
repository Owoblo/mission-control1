import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveQuoteDraftPricing } from '../../lib/quote-draft-pricing'
import { getQuoteCommercialArithmeticError } from '../../lib/quote-pricing-safety'
import type { CRMQuote } from '../../lib/types'
const quote = { id:'fixture', status:'viewed', lineItems:[{description:'Moving Services — Agreed Rate',amount:1400}], subtotal:1400,hst:182,total:1582,deposit:474.6,balance:1107.4,priceOverrideTotal:1400,discountAmount:0 } as CRMQuote

test('legacy pre-tax override is repaired without changing published customer price',()=>{
 const result=resolveQuoteDraftPricing(quote,quote.lineItems,0,.3,true,true)
 assert.equal(result.hasExplicitPriceRevision,false)
 assert.equal(result.priceOverrideTotal,1582)
 assert.deepEqual(result.totals,{lineItems:quote.lineItems,subtotal:1400,hst:182,total:1582,deposit:474.6,balance:1107.4})
 assert.equal(getQuoteCommercialArithmeticError({...quote,...result.totals,priceOverrideTotal:result.priceOverrideTotal}),null)
})
test('discount after agreed rate changes the final total and remains arithmetically valid',()=>{
 const result=resolveQuoteDraftPricing(quote,quote.lineItems,100,.3,true,true)
 assert.equal(result.hasExplicitPriceRevision,true)
 assert.equal(result.effectiveDiscount,100)
 assert.equal(result.totals.total,1469)
 assert.equal(result.priceOverrideTotal,1469)
 assert.equal(getQuoteCommercialArithmeticError({...quote,...result.totals,discountAmount:100,priceOverrideTotal:result.priceOverrideTotal}),null)
})
test('background recalculation cannot reprice a published quote without explicit revision',()=>{
 const result=resolveQuoteDraftPricing(quote,[{description:'Moving Services',amount:2000}],0,.3,true)
 assert.equal(result.preserveCustomerFacingPricing,true)
 assert.equal(result.totals.total,1582)
})
test('explicit calculated revision clears the previous override',()=>{
 const result=resolveQuoteDraftPricing(quote,[{description:'Moving Services',amount:2000}],0,.3,true,true)
 assert.equal(result.priceOverrideTotal,0)
 assert.equal(result.totals.total,2260)
})
