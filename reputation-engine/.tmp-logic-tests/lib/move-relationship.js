"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATTRIBUTION_CHANNELS = exports.MOVE_RELATIONSHIP_CATEGORY_BY_ROLE = exports.MOVE_RELATIONSHIP_ROLE_LABELS = exports.OPPORTUNITY_POSITION_LABELS = void 0;
exports.opportunityHealthLabel = opportunityHealthLabel;
exports.moveRelationshipLifecycleGaps = moveRelationshipLifecycleGaps;
exports.isMoveRelationshipLifecycleComplete = isMoveRelationshipLifecycleComplete;
exports.normalizeAttributionSignals = normalizeAttributionSignals;
exports.normalizeMoveRelationships = normalizeMoveRelationships;
exports.OPPORTUNITY_POSITION_LABELS = {
    discovery: 'Discovery underway',
    collecting_inventory: 'Collecting inventory or photos',
    estimate_in_progress: 'Estimate in progress',
    reviewing_estimate: 'Reviewing the estimate',
    comparing_options: 'Comparing options',
    internal_decision: 'Decision with spouse or team',
    date_uncertain: 'Move date uncertain',
    ready_to_book: 'Ready to book',
    deposit_promised: 'Deposit promised',
    temporarily_unresponsive: 'Temporarily unresponsive',
    long_term_nurture: 'Long-term nurture',
};
exports.MOVE_RELATIONSHIP_ROLE_LABELS = {
    referring_realtor: 'Referring realtor',
    listing_realtor: 'Listing realtor',
    buyer_realtor: 'Buyer’s realtor',
    brokerage: 'Brokerage',
    property_manager: 'Property manager',
    building_manager: 'Building / maintenance manager',
    mortgage_broker: 'Mortgage broker',
    lender: 'Lender',
    employer: 'Employer',
    storage_facility: 'Storage facility',
    retirement_residence: 'Retirement residence',
    insurance: 'Insurance representative',
    customer_referrer: 'Customer / personal referrer',
    other: 'Other connection',
};
exports.MOVE_RELATIONSHIP_CATEGORY_BY_ROLE = {
    referring_realtor: 'realtor',
    listing_realtor: 'realtor',
    buyer_realtor: 'realtor',
    brokerage: 'brokerage',
    property_manager: 'property_manager',
    building_manager: 'maintenance_manager',
    mortgage_broker: 'mortgage_broker',
    lender: 'mortgage_broker',
    employer: 'corporate',
    storage_facility: 'storage_facility',
    retirement_residence: 'senior_living',
    insurance: 'insurance',
    customer_referrer: 'personal_referrer',
    other: 'other',
};
exports.ATTRIBUTION_CHANNELS = [
    'Direct mail',
    'Google search',
    'Google Business Profile',
    'Realtor referral',
    'Partnership referral',
    'Customer referral',
    'Instagram',
    'Facebook',
    'Website',
    'Repeat customer',
    'Phone / walk-in',
    'Other',
];
function opportunityHealthLabel(context) {
    if (!context)
        return 'Needs context';
    if (!context.nextAction?.trim() || !context.nextActionDueAt)
        return 'Needs next step';
    if (new Date(context.nextActionDueAt).getTime() < Date.now())
        return 'Action overdue';
    if (context.bookingConfidence >= 75)
        return 'Strong opportunity';
    if (context.bookingConfidence >= 40)
        return 'Developing opportunity';
    return 'Early opportunity';
}
function moveRelationshipLifecycleGaps(input) {
    const gaps = [];
    if (!input.context?.position)
        gaps.push('customer position');
    if (!input.context?.summary?.trim())
        gaps.push('sales summary');
    if (!input.context?.nextAction?.trim() || !input.context?.nextActionDueAt)
        gaps.push('owned next step');
    if (!input.primarySource?.trim() && !input.signals?.length)
        gaps.push('acquisition evidence');
    if (input.context?.relationshipReviewStatus !== 'complete')
        gaps.push('relationship review');
    return gaps;
}
function isMoveRelationshipLifecycleComplete(input) {
    return moveRelationshipLifecycleGaps(input).length === 0;
}
function normalizeAttributionSignals(signals) {
    const seen = new Set();
    return (signals || []).filter(signal => {
        const key = `${signal.channel.trim().toLowerCase()}|${(signal.detail || '').trim().toLowerCase()}|${signal.influence}`;
        if (!signal.channel.trim() || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function normalizeMoveRelationships(relationships) {
    const seen = new Set();
    return (relationships || []).filter(relationship => {
        const key = relationship.contactId
            ? `${relationship.contactId}|${relationship.role}|${relationship.addressConnection || 'move'}`
            : `${relationship.name.trim().toLowerCase()}|${(relationship.company || '').trim().toLowerCase()}|${relationship.role}|${relationship.addressConnection || 'move'}`;
        if (!relationship.name.trim() || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
