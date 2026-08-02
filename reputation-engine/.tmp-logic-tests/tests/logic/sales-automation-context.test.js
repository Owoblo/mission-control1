"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_automation_context_1 = require("../../lib/sales-automation-context");
const sales_automation_qualification_1 = require("../../lib/sales-automation-qualification");
function lead(overrides = {}) {
    return {
        id: 'lead_context_test',
        name: 'Siddarth Kumar',
        stage: 'pricing',
        createdAt: '2026-07-05',
        moveDate: '2026-07-11',
        moveType: 'packing',
        originCity: 'Windsor',
        destCity: 'Windsor',
        originAddress: 'Ontario Street',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
        ...overrides,
    };
}
(0, node_test_1.default)('website form fields map directly into canonical CRM fields without AI', () => {
    const fields = (0, sales_automation_context_1.extractStructuredInboundLeadFields)({
        move_from: '1 Cutting Drive, Elora, Ontario N0B 1S0',
        move_to: '1349 Queen Street, New Dundee, Ontario N0B 2E0',
        move_date: '2026-08-01',
        home_size: '3 bedrooms',
        service_type: 'Local Moving',
        message: 'Stairs,',
    });
    strict_1.default.equal(fields.originAddress, '1 Cutting Drive, Elora, Ontario N0B 1S0');
    strict_1.default.equal(fields.destAddress, '1349 Queen Street, New Dundee, Ontario N0B 2E0');
    strict_1.default.equal(fields.moveDate, '2026-08-01');
    strict_1.default.equal(fields.propertyBedrooms, '3_bedrooms');
    strict_1.default.equal(fields.moveType, 'residential');
    strict_1.default.match(fields.originAccess || '', /Stairs reported/);
});
(0, node_test_1.default)('legacy pipe-delimited website summaries recover route, date, and home size', () => {
    const fields = (0, sales_automation_context_1.extractStructuredInboundLeadFields)({}, 'Service: Local Moving | From: 1 Cutting Drive, Elora, Ontario N0B 1S0 | To: 1349 Queen Street, New Dundee, Ontario N0B 2E0 | Date: 2026-08-01 | Home size: 3 bedrooms | Notes: Stairs,');
    strict_1.default.equal(fields.originAddress, '1 Cutting Drive, Elora, Ontario N0B 1S0');
    strict_1.default.equal(fields.destAddress, '1349 Queen Street, New Dundee, Ontario N0B 2E0');
    strict_1.default.equal(fields.moveDate, '2026-08-01');
    strict_1.default.equal(fields.propertyBedrooms, '3_bedrooms');
});
(0, node_test_1.default)('city-only form locations populate city fields and ignore destination placeholders', () => {
    const fields = (0, sales_automation_context_1.extractStructuredInboundLeadFields)({
        move_from: 'Chatham, Ontario',
        move_to: 'To be confirmed',
    });
    strict_1.default.equal(fields.originCity, 'Chatham, Ontario');
    strict_1.default.equal(fields.originAddress, undefined);
    strict_1.default.equal(fields.destCity, undefined);
    strict_1.default.equal(fields.destAddress, undefined);
});
(0, node_test_1.default)('flexible scheduling replies advance qualification without AI extraction', () => {
    const fields = (0, sales_automation_context_1.extractDeterministicReplyFields)('Date is flexible, asap though, weekend is preferred. Mondays or Fridays work best.');
    strict_1.default.equal(fields.moveDateFlexible, true);
    strict_1.default.match(fields.moveDateFlexibleReason || '', /weekend is preferred/i);
});
(0, node_test_1.default)('inbound context resolver splits two customer addresses and overwrites stale partial pickup', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead(), '225 Wyandotte Street West, Windsor, N9A5X1 to 4755 Walker Road');
    strict_1.default.equal(updated.originAddress, '225 Wyandotte Street West, Windsor, N9A5X1');
    strict_1.default.equal(updated.destAddress, '4755 Walker Road');
    const missing = (0, sales_automation_qualification_1.getAutomationMissingFields)(updated);
    strict_1.default.equal(missing.includes('origin_address'), false);
    strict_1.default.equal(missing.includes('destination_address'), false);
});
(0, node_test_1.default)('inbound context resolver accepts postal-code-complete address without street suffix', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead({ originAddress: '29 Alderton', originCity: 'Leamington' }), 'It is a HOUSE at 29 Alderton, Leamington, N8H 4L6');
    strict_1.default.equal(updated.originAddress, '29 Alderton, Leamington, N8H 4L6');
    strict_1.default.equal((0, sales_automation_qualification_1.getAutomationMissingFields)(updated).includes('origin_address'), false);
});
(0, node_test_1.default)('inbound context resolver captures packing inventory list from SMS', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead({ originAddress: '225 Wyandotte Street West', destAddress: '4755 Walker Road' }), 'Recliner sofa, recliner, chair, coffee, table, side table, tables, television, computer, study table, dishwasher, microwave, study, chair, bicycle, there are some items in the closet also');
    const names = (updated.inventory || []).map(item => item.name);
    strict_1.default.ok(names.includes('Recliner Sofa'));
    strict_1.default.ok(names.includes('Coffee Table'));
    strict_1.default.ok(names.includes('Television'));
    strict_1.default.ok(names.includes('Closet Items'));
    strict_1.default.ok((updated.inventory || []).length >= 10);
    strict_1.default.ok((updated.totalItems || 0) >= 10);
    strict_1.default.match(updated.notes || '', /Customer listed packing\/moving items by SMS/);
});
(0, node_test_1.default)('inventory extractor ignores address-only messages', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)('225 Wyandotte Street West, Windsor to 4755 Walker Road');
    strict_1.default.equal(items.length, 0);
});
(0, node_test_1.default)('customer inventory uses known moving dimensions instead of zero-value placeholders', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)('couch, dining table, four night tables, TV console');
    const knownItems = items.filter(item => ['Couch', 'Dining Table', 'Night Tables', 'Television Console'].includes(item.name || ''));
    strict_1.default.equal(knownItems.length, 4);
    strict_1.default.ok(knownItems.every(item => Number(item.cubicFeet) > 0));
    strict_1.default.ok(knownItems.every(item => Number(item.weightLbs) > 0));
    strict_1.default.equal(knownItems.find(item => item.name === 'Night Tables')?.qty, 4);
});
(0, node_test_1.default)('customer inventory separates adjacent counted items from conversational prose', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)("I can't count boxes yet because nothing is packed. I have three beds two couches, dining table, patio furniture, four night tables, storage furniture midsize. One TV console.");
    const byName = new Map(items.map(item => [item.name, item]));
    strict_1.default.equal(byName.get('Beds')?.qty, 3);
    strict_1.default.equal(byName.get('Couches')?.qty, 2);
    strict_1.default.equal(byName.get('Night Tables')?.qty, 4);
    strict_1.default.equal(byName.get('Television Console')?.qty, 1);
    strict_1.default.ok(items.every(item => Number(item.cubicFeet) > 0));
    strict_1.default.ok(items.every(item => Number(item.weightLbs) > 0));
});
(0, node_test_1.default)('customer inventory separates SMS corrections across rooms and preserves quantities', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)('In the living room, there are 2 end tables, and the lazy boy recliner couch was missed. The bedroom also has an armoire/chest of drawers.');
    const byName = new Map(items.map(item => [item.name, item]));
    strict_1.default.equal(byName.get('End Tables')?.qty, 2);
    strict_1.default.equal(byName.get('Lazy Boy Recliner Couch')?.qty, 1);
    strict_1.default.equal(byName.get('Armoire/Chest Of Drawers')?.qty, 1);
    strict_1.default.equal(items.length, 3);
    strict_1.default.ok(items.every(item => !/\bmissed\b.*\bbedroom\b/i.test(item.name || '')));
});
(0, node_test_1.default)('inbound inventory recomputes totals after a customer correction', () => {
    const updated = (0, sales_automation_context_1.resolveInboundSalesContext)(lead({
        inventory: [{ id: 'existing', name: 'Coffee Table', qty: 1, cubicFeet: 10, weightLbs: 35, room: 'Living Room', included: true }],
        totalCubicFeet: 999,
        totalWeightLbs: 9999,
    }), 'The bedroom has an armoire.');
    strict_1.default.equal(updated.totalCubicFeet, 50);
    strict_1.default.equal(updated.totalWeightLbs, 195);
    strict_1.default.equal(updated.inventory?.find(item => item.name === 'Armoire')?.status, 'needs_confirmation');
    strict_1.default.match(updated.inventory?.find(item => item.name === 'Armoire')?.confirmReason || '', /automatically parsed from customer text/i);
});
(0, node_test_1.default)('customer inventory does not interpret TV dimensions as quantities', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)(`Oak furniture - queen bed+ headboard, dresser, chest of drawers, end table.
56 inch plasma tv + stand
Lazy boy couch and chair, coffee table, end tables
Kitchen table and chairs
Single bed, dresser
Wooden desk (fairly heavy, will be disassembled somewhat)
2 pinball machines (which I might move myself)
Nearly all of the small stuff has already been moved`);
    const television = items.find(item => /television/i.test(item.name || ''));
    const pinball = items.find(item => /pinball/i.test(item.name || ''));
    strict_1.default.equal(television?.qty, 1);
    strict_1.default.match(television?.name || '', /56 Inch Plasma Television/i);
    strict_1.default.equal(pinball?.qty, 2);
    strict_1.default.equal(pinball?.name, 'Pinball Machines');
    strict_1.default.equal(pinball?.cubicFeet, 25);
    strict_1.default.equal(pinball?.weightLbs, 250);
    strict_1.default.equal(pinball?.status, 'needs_confirmation');
    strict_1.default.match(pinball?.confirmReason || '', /confirm whether/i);
    strict_1.default.match(pinball?.notes || '', /might move myself/i);
    strict_1.default.ok(items.every(item => !/Nearly All|Will Be Disassembled/i.test(item.name || '')));
});
(0, node_test_1.default)('customer inventory keeps quoted email bullets separate and ignores prose and measurements', () => {
    const items = (0, sales_automation_context_1.extractCustomerInventoryItems)(`Please see list for added, amended! Many thanks, Mario
> Living Room
> • 1 x 3-seat tufted sofa — Approx. 7 ft length — Fabric upholstery
> • 1 x floor lamp with rectangular shade — Approx. 5 ft tall
> • 1 x round dining table with wood legs — Approx. 4 ft diameter
> • 4 x upholstered dining chairs — Standard dining chair size`);
    strict_1.default.deepEqual(items.map(item => item.qty), [1, 1, 1, 4]);
    strict_1.default.ok(items.some(item => /3[- ]Seat Tufted Sofa/i.test(item.name || '')));
    strict_1.default.ok(items.some(item => /Floor Lamp/i.test(item.name || '')));
    strict_1.default.ok(items.some(item => /Round Dining Table/i.test(item.name || '')));
    strict_1.default.ok(items.some(item => /Upholstered Dining Chairs/i.test(item.name || '')));
    strict_1.default.ok(items.every(item => !/Mario|Many Thanks|Ft Length|Ft Tall/i.test(item.name || '')));
});
