"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhone = normalizePhone;
exports.normalizeEmail = normalizeEmail;
exports.validateMoveType = validateMoveType;
exports.validateLeadPayload = validateLeadPayload;
exports.validateLeadPatchPayload = validateLeadPatchPayload;
const MOVE_TYPES = new Set([
    'residential',
    'long-distance',
    'commercial',
    'senior',
    'labor-only',
    'packing',
]);
const SALES_BRANCHES = new Set([
    'windsor',
    'waterloo',
    'london',
    'ottawa',
]);
const SALES_LEAD_STAGES = new Set([
    'new',
    'contacted',
    'estimate_scheduled',
    'estimate_completed',
    'pricing',
    'quoted',
    'tentative',
    'nurture',
    'booked',
    'completed',
    'customer_success',
    'lost',
]);
const LEAD_KINDS = new Set([
    'customer',
    'realtor_opportunity',
]);
const LEAD_CONTACT_ROLES = new Set([
    'customer',
    'realtor',
]);
const QUOTE_TYPES = new Set([
    'standard',
    'labor_only',
    'packing_only',
    'long_distance',
    'storage',
]);
const PROPERTY_BEDROOMS = new Set([
    'studio',
    '1_bedroom',
    '2_bedrooms',
    '3_bedrooms',
    '4_bedrooms',
    '5_plus',
]);
const PROPERTY_TYPES = new Set([
    'apartment',
    'condo',
    'townhouse',
    'detached_house',
    'commercial',
    'storage_unit',
]);
const REALTOR_LOOKUP_STATUSES = new Set([
    'not_checked',
    'matched',
    'partial',
    'missing',
]);
const REALTOR_WARMTH_VALUES = new Set([
    'warm',
    'cold',
    'unknown',
]);
const REALTOR_OUTREACH_STATUSES = new Set([
    'not_started',
    'queued',
    'sent',
    'responded',
    'closed',
]);
const DESTINATION_OPPORTUNITY_STATUSES = new Set([
    'outside_area',
    'no_match',
    'generated',
    'linked_existing',
]);
const AUTOMATION_STATUSES = new Set([
    'idle',
    'active',
    'paused',
    'handoff',
    'do_not_contact',
]);
const LEAD_OWNER_STATUSES = new Set([
    'unassigned',
    'assigned',
    'reassigned',
    'handoff',
]);
const TRUCK_RESERVATION_STATUSES = new Set([
    'not_needed',
    'needs_booking',
    'booking_in_progress',
    'reserved',
    'issue',
]);
const TRUCK_VENDORS = new Set([
    'uhaul',
    'penske',
    'budget',
    'enterprise',
    'other',
]);
const PAYMENT_STATUSES = new Set([
    'pending',
    'deposit_received',
    'paid_in_full',
]);
const FOLLOW_UP_STATUSES = new Set([
    'pending',
    'following_up',
    'followed_up',
    'no_response',
]);
const CONSULTATION_STATUSES = new Set([
    'booked',
    'in_progress',
    'completed',
]);
const OPTIONAL_TEXT_FIELDS = [
    'source',
    'sourceDetail',
    'referralCustomerName',
    'partnerReferralContactId',
    'partnerReferralName',
    'partnerReferralCompany',
    'partnerReferralCategory',
    'partnerReferralEmail',
    'partnerReferralPhone',
    'partnerReferralLinkedAt',
    'relationshipContactId',
    'relationshipContactName',
    'relationshipContactCompany',
    'relationshipContactCategory',
    'relationshipContactLinkedAt',
    'relationshipContactReason',
    'identityPhone',
    'identityEmail',
    'followUpDate',
    'moveDateFlexibleReason',
    'originAddress',
    'originCity',
    'originAccess',
    'destAddress',
    'destCity',
    'destAccess',
    'parkingNotes',
    'realtorName',
    'realtorEmail',
    'realtorPhone',
    'realtorBrokerage',
    'realtorWebsite',
    'realtorContactId',
    'realtorEnrichedAt',
    'realtorOutreachStartedAt',
    'realtorLastTouchAt',
    'moveReason',
    'customerPriority',
    'notes',
    'followUpNote',
    'followUpStatus',
    'surveyToken',
    'surveyTokenExpiresAt',
    'surveyRequestedAt',
    'surveyCompletedAt',
    'surveyScannedAt',
    'quoteId',
    'sourceLeadId',
    'sourceLeadName',
    'sourceLeadMoveDate',
    'sourceLeadQuoteId',
    'opportunityAddress',
    'opportunityCity',
    'opportunityDetectedAt',
    'destinationOpportunityLeadId',
    'destinationOpportunityLastCheckedAt',
    'firstResponseAt',
    'lastInboundAt',
    'lastOutboundAt',
    'lastHumanOutboundAt',
    'lastAutomationOutboundAt',
    'automationPausedUntil',
    'automationPauseReason',
    'automationHandoffAt',
    'automationHandoffReason',
    'automationLastJobAt',
    'lastMissedCallAt',
    'lastMissedCallAutoReplyAt',
    'lastVoicemailAt',
    'automatedQuoteSentAt',
    'automatedQuoteId',
    'automatedQuoteChannel',
    'lastAutoEnrichmentAt',
    'lostReason',
    'lostNotes',
    'lostAt',
    'contextFlag',
    'assignedRep',
    'assignedRepName',
    'assignedRepUserId',
    'ownedAt',
    'lastTouchedByUserId',
    'lastTouchedByName',
    'lastTouchedAt',
    'crewNote',
    'truckSize',
    'truckPickupLocation',
    'truckPickupTime',
    'truckReturnLocation',
    'truckReservationNumber',
    'truckReservationNotes',
    'truckReservationBookedAt',
    'truckReservationBookedBy',
    'estimateDate',
    'estimateTime',
    'consultationTriggerReason',
    'consultationAssignedManagerName',
    'consultationAssignedManagerId',
    'consultationCustomerConcern',
    'consultationPreVisitBrief',
    'consultationBookedAt',
    'bookedAt',
    'depositMethod',
    'depositDate',
    'cancelledAt',
    'cancelReason',
    'reviewJobId',
    'reviewSentAt',
    'reviewCompletedAt',
    'reviewNotes',
    'mergedIntoLeadId',
    'mergedAt',
    'mergedByUserId',
    'mergedByName',
    'mergedReason',
];
const BOOLEAN_FIELDS = [
    'moveDateFlexible',
    'directMailAttributed',
    'originElevatorAccess',
    'destElevatorAccess',
];
const NUMERIC_FIELDS = [
    'additionalStops',
    'originStairFlights',
    'destStairFlights',
    'surveyPhotoCount',
    'leadScore',
    'totalItems',
    'totalCubicFeet',
    'totalWeightLbs',
    'truckCountConfirmed',
    'depositAmount',
    'reviewRating',
];
const STRING_ARRAY_FIELDS = [
    'quoteIds',
    'assignedCrew',
    'removedInventoryItemKeys',
];
const ARRAY_FIELDS = [
    'inventory',
    'mediaAssets',
    'callLogs',
    'crewHours',
    'crewPayouts',
    'attributionSignals',
    'moveRelationships',
];
const OBJECT_FIELDS = [
    'attribution',
    'supabaseListing',
    'listingScanSnapshot',
    'automationSettings',
    'qualificationState',
    'inboxState',
    'inventoryVerification',
    'roomBreakdown',
    'jobFactors',
    'intelligence',
    'opsChecklist',
    'opportunityContext',
];
const ALLOWED_LEAD_PATCH_FIELDS = new Set([
    'name',
    'phone',
    'email',
    'stage',
    'branch',
    'leadKind',
    'primaryContactRole',
    'moveDate',
    'moveType',
    'propertyBedrooms',
    'propertyType',
    'quoteType',
    'realtorLookupStatus',
    'realtorWarmth',
    'realtorOutreachStatus',
    'destinationOpportunityStatus',
    'automationStatus',
    'leadOwnerStatus',
    'truckReservationStatus',
    'truckVendor',
    'paymentStatus',
    'consultationStatus',
    ...OPTIONAL_TEXT_FIELDS,
    ...BOOLEAN_FIELDS,
    ...NUMERIC_FIELDS,
    ...STRING_ARRAY_FIELDS,
    ...ARRAY_FIELDS,
    ...OBJECT_FIELDS,
]);
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function normalizeOptionalText(value) {
    if (value == null)
        return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function normalizePhone(value) {
    return normalizeOptionalText(value);
}
function normalizeEmail(value) {
    const trimmed = normalizeOptionalText(value);
    return trimmed ? trimmed.toLowerCase() : undefined;
}
function validateDateLike(value, field) {
    if (Number.isNaN(new Date(value).getTime())) {
        throw new Error(`Invalid ${field}`);
    }
    return value;
}
function validateFiniteNumber(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid ${field}`);
    }
    return value;
}
function validateBoolean(value, field) {
    if (typeof value !== 'boolean') {
        throw new Error(`Invalid ${field}`);
    }
    return value;
}
function validateEnum(value, field, values) {
    if (typeof value !== 'string' || !values.has(value)) {
        throw new Error(`Invalid ${field}`);
    }
    return value;
}
const MOVE_TYPE_ALIASES = {
    'long distance': 'long-distance',
    'long-distance move': 'long-distance',
    'long distance move': 'long-distance',
    'longdistance': 'long-distance',
    'labor only': 'labor-only',
    'labour-only': 'labor-only',
    'labour only': 'labor-only',
    'packing only': 'packing',
    'pack only': 'packing',
    'senior move': 'senior',
    'senior living': 'senior',
    'residential move': 'residential',
    'commercial move': 'commercial',
};
function validateMoveType(value) {
    if (!value)
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (MOVE_TYPE_ALIASES[normalized])
        return MOVE_TYPE_ALIASES[normalized];
    return validateEnum(normalized, 'move type', MOVE_TYPES);
}
function validateLeadPayload(payload) {
    if (!payload.name?.trim()) {
        throw new Error('Lead name is required');
    }
    const phone = normalizePhone(payload.phone);
    const email = normalizeEmail(payload.email);
    if (!phone && !email) {
        throw new Error('At least a phone or email is required');
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Invalid email address');
    }
    if (payload.moveDate) {
        validateDateLike(payload.moveDate, 'move date');
    }
    if (payload.followUpDate) {
        validateDateLike(payload.followUpDate, 'follow-up date');
    }
    return {
        name: payload.name.trim(),
        phone,
        email,
        moveType: validateMoveType(payload.moveType),
    };
}
function validateLeadPatchPayload(payload) {
    if (!isPlainObject(payload)) {
        throw new Error('Lead update payload must be an object');
    }
    const updates = {};
    const unsafeUpdates = updates;
    for (const [rawKey, rawValue] of Object.entries(payload)) {
        if (!ALLOWED_LEAD_PATCH_FIELDS.has(rawKey)) {
            throw new Error(`Unsupported lead field: ${rawKey}`);
        }
        const key = rawKey;
        if (key === 'name') {
            const value = normalizeOptionalText(typeof rawValue === 'string' ? rawValue : undefined);
            if (!value)
                throw new Error('Lead name cannot be empty');
            updates.name = value;
            continue;
        }
        if (key === 'phone') {
            updates.phone = rawValue == null ? undefined : normalizePhone(String(rawValue));
            continue;
        }
        if (key === 'email') {
            const email = rawValue == null ? undefined : normalizeEmail(String(rawValue));
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error('Invalid email address');
            }
            updates.email = email;
            continue;
        }
        if (key === 'moveType') {
            updates.moveType = rawValue == null ? undefined : validateMoveType(String(rawValue));
            continue;
        }
        if (key === 'stage') {
            updates.stage = validateEnum(rawValue, 'lead stage', SALES_LEAD_STAGES);
            continue;
        }
        if (key === 'branch') {
            updates.branch = rawValue == null ? undefined : validateEnum(rawValue, 'branch', SALES_BRANCHES);
            continue;
        }
        if (key === 'leadKind') {
            updates.leadKind = rawValue == null ? undefined : validateEnum(rawValue, 'lead kind', LEAD_KINDS);
            continue;
        }
        if (key === 'primaryContactRole') {
            updates.primaryContactRole = rawValue == null ? undefined : validateEnum(rawValue, 'primary contact role', LEAD_CONTACT_ROLES);
            continue;
        }
        if (key === 'quoteType') {
            updates.quoteType = rawValue == null ? undefined : validateEnum(rawValue, 'quote type', QUOTE_TYPES);
            continue;
        }
        if (key === 'propertyBedrooms') {
            updates.propertyBedrooms = rawValue == null ? undefined : validateEnum(rawValue, 'property bedrooms', PROPERTY_BEDROOMS);
            continue;
        }
        if (key === 'propertyType') {
            updates.propertyType = rawValue == null ? undefined : validateEnum(rawValue, 'property type', PROPERTY_TYPES);
            continue;
        }
        if (key === 'realtorLookupStatus') {
            updates.realtorLookupStatus = rawValue == null ? undefined : validateEnum(rawValue, 'realtor lookup status', REALTOR_LOOKUP_STATUSES);
            continue;
        }
        if (key === 'realtorWarmth') {
            updates.realtorWarmth = rawValue == null ? undefined : validateEnum(rawValue, 'realtor warmth', REALTOR_WARMTH_VALUES);
            continue;
        }
        if (key === 'realtorOutreachStatus') {
            updates.realtorOutreachStatus = rawValue == null ? undefined : validateEnum(rawValue, 'realtor outreach status', REALTOR_OUTREACH_STATUSES);
            continue;
        }
        if (key === 'destinationOpportunityStatus') {
            updates.destinationOpportunityStatus = rawValue == null ? undefined : validateEnum(rawValue, 'destination opportunity status', DESTINATION_OPPORTUNITY_STATUSES);
            continue;
        }
        if (key === 'automationStatus') {
            updates.automationStatus = rawValue == null ? undefined : validateEnum(rawValue, 'automation status', AUTOMATION_STATUSES);
            continue;
        }
        if (key === 'leadOwnerStatus') {
            updates.leadOwnerStatus = rawValue == null ? undefined : validateEnum(rawValue, 'lead owner status', LEAD_OWNER_STATUSES);
            continue;
        }
        if (key === 'truckReservationStatus') {
            updates.truckReservationStatus = rawValue == null ? undefined : validateEnum(rawValue, 'truck reservation status', TRUCK_RESERVATION_STATUSES);
            continue;
        }
        if (key === 'truckVendor') {
            updates.truckVendor = rawValue == null ? undefined : validateEnum(rawValue, 'truck vendor', TRUCK_VENDORS);
            continue;
        }
        if (key === 'paymentStatus') {
            updates.paymentStatus = rawValue == null ? undefined : validateEnum(rawValue, 'payment status', PAYMENT_STATUSES);
            continue;
        }
        if (key === 'followUpStatus') {
            updates.followUpStatus = rawValue == null ? undefined : validateEnum(rawValue, 'follow-up status', FOLLOW_UP_STATUSES);
            continue;
        }
        if (key === 'consultationStatus') {
            updates.consultationStatus = rawValue == null ? undefined : validateEnum(rawValue, 'consultation status', CONSULTATION_STATUSES);
            continue;
        }
        if (key === 'moveDate' || key === 'followUpDate') {
            const value = normalizeOptionalText(typeof rawValue === 'string' ? rawValue : undefined);
            unsafeUpdates[rawKey] = value ? validateDateLike(value, key === 'moveDate' ? 'move date' : 'follow-up date') : undefined;
            continue;
        }
        if (OPTIONAL_TEXT_FIELDS.includes(rawKey)) {
            if (rawValue == null) {
                unsafeUpdates[rawKey] = undefined;
                continue;
            }
            if (typeof rawValue !== 'string') {
                throw new Error(`Invalid ${rawKey}`);
            }
            unsafeUpdates[rawKey] = normalizeOptionalText(rawValue);
            continue;
        }
        if (BOOLEAN_FIELDS.includes(rawKey)) {
            unsafeUpdates[rawKey] = rawValue == null ? undefined : validateBoolean(rawValue, rawKey);
            continue;
        }
        if (NUMERIC_FIELDS.includes(rawKey)) {
            unsafeUpdates[rawKey] = rawValue == null ? undefined : validateFiniteNumber(rawValue, rawKey);
            continue;
        }
        if (STRING_ARRAY_FIELDS.includes(rawKey)) {
            if (rawValue == null) {
                unsafeUpdates[rawKey] = undefined;
                continue;
            }
            if (!Array.isArray(rawValue) || rawValue.some(item => typeof item !== 'string')) {
                throw new Error(`Invalid ${rawKey}`);
            }
            unsafeUpdates[rawKey] = rawValue.map(item => item.trim()).filter(Boolean);
            continue;
        }
        if (ARRAY_FIELDS.includes(rawKey)) {
            if (rawValue == null) {
                unsafeUpdates[rawKey] = undefined;
                continue;
            }
            if (!Array.isArray(rawValue)) {
                throw new Error(`Invalid ${rawKey}`);
            }
            unsafeUpdates[rawKey] = rawValue;
            continue;
        }
        if (OBJECT_FIELDS.includes(rawKey)) {
            if (rawValue == null) {
                unsafeUpdates[rawKey] = undefined;
                continue;
            }
            if (!isPlainObject(rawValue)) {
                throw new Error(`Invalid ${rawKey}`);
            }
            if (rawKey === 'roomBreakdown') {
                const roomBreakdown = Object.fromEntries(Object.entries(rawValue).map(([room, value]) => [room.trim(), validateFiniteNumber(value, `roomBreakdown.${room}`)]));
                updates.roomBreakdown = roomBreakdown;
                continue;
            }
            unsafeUpdates[rawKey] = rawValue;
            continue;
        }
    }
    return updates;
}
