"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLeadIdentityPhone = normalizeLeadIdentityPhone;
exports.normalizeLeadIdentityEmail = normalizeLeadIdentityEmail;
exports.compareLeadIdentityPriority = compareLeadIdentityPriority;
exports.sortLeadIdentityMatches = sortLeadIdentityMatches;
exports.leadSharesIdentity = leadSharesIdentity;
exports.findLeadIdentityMatches = findLeadIdentityMatches;
exports.findMatchingActiveLead = findMatchingActiveLead;
exports.chooseCanonicalLead = chooseCanonicalLead;
exports.mergeLeadRecords = mergeLeadRecords;
const sales_1 = require("../sales");
const sales_phones_1 = require("../sales-phones");
const PLACEHOLDER_NAMES = new Set([
    '',
    'unknown caller',
    'new caller',
    'new contact',
    'new lead',
    'new inquiry',
    'caller',
    'contact',
    'unknown lead',
    'unknown',
]);
function normalizeOptionalText(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function normalizeLeadIdentityPhone(value) {
    const normalized = (0, sales_phones_1.normalizePhone)(value);
    return normalized || undefined;
}
function normalizeLeadIdentityEmail(value) {
    const normalized = normalizeOptionalText(value)?.toLowerCase();
    return normalized || undefined;
}
function phoneDigits(value) {
    return (0, sales_phones_1.digitsOnly)(normalizeLeadIdentityPhone(value) || value || '');
}
function phonesMatch(left, right) {
    const leftNormalized = normalizeLeadIdentityPhone(left);
    const rightNormalized = normalizeLeadIdentityPhone(right);
    if (leftNormalized && rightNormalized && leftNormalized === rightNormalized) {
        return true;
    }
    const leftDigits = phoneDigits(left);
    const rightDigits = phoneDigits(right);
    return !!leftDigits && !!rightDigits && (leftDigits === rightDigits ||
        leftDigits.endsWith(rightDigits) ||
        rightDigits.endsWith(leftDigits));
}
function emailsMatch(left, right) {
    const leftNormalized = normalizeLeadIdentityEmail(left);
    const rightNormalized = normalizeLeadIdentityEmail(right);
    return !!leftNormalized && !!rightNormalized && leftNormalized === rightNormalized;
}
function isPlaceholderName(value) {
    return PLACEHOLDER_NAMES.has((value || '').trim().toLowerCase());
}
function leadStagePriority(stage) {
    switch (stage) {
        case 'booked':
            return 90;
        case 'completed':
        case 'customer_success':
            return 85;
        case 'quoted':
            return 80;
        case 'tentative':
            return 75;
        case 'pricing':
            return 65;
        case 'estimate_completed':
            return 60;
        case 'estimate_scheduled':
            return 55;
        case 'contacted':
            return 50;
        case 'nurture':
            return 35;
        case 'new':
            return 30;
        case 'lost':
            return 10;
        default:
            return 20;
    }
}
function leadCompletenessScore(lead) {
    let score = 0;
    if (!isPlaceholderName(lead.name))
        score += 4;
    if (normalizeLeadIdentityPhone(lead.identityPhone || lead.phone))
        score += 3;
    if (normalizeLeadIdentityEmail(lead.identityEmail || lead.email))
        score += 3;
    if (lead.moveDate)
        score += 2;
    if (lead.originAddress || lead.destAddress)
        score += 2;
    if (lead.quoteId || (lead.quoteIds || []).length > 0)
        score += 4;
    return score;
}
function leadRecencyTimestamp(lead) {
    const raw = lead.lastTouchedAt || lead.createdAt || '';
    const timestamp = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
}
function compareLeadIdentityPriority(left, right) {
    const leftClosed = (0, sales_1.isClosedLeadStage)(left.stage);
    const rightClosed = (0, sales_1.isClosedLeadStage)(right.stage);
    if (leftClosed !== rightClosed) {
        return leftClosed ? 1 : -1;
    }
    const leftStagePriority = leadStagePriority(left.stage);
    const rightStagePriority = leadStagePriority(right.stage);
    if (leftStagePriority !== rightStagePriority) {
        return rightStagePriority - leftStagePriority;
    }
    const leftCompleteness = leadCompletenessScore(left);
    const rightCompleteness = leadCompletenessScore(right);
    if (leftCompleteness !== rightCompleteness) {
        return rightCompleteness - leftCompleteness;
    }
    const leftRecency = leadRecencyTimestamp(left);
    const rightRecency = leadRecencyTimestamp(right);
    if (leftRecency !== rightRecency) {
        return rightRecency - leftRecency;
    }
    return left.id.localeCompare(right.id);
}
function sortLeadIdentityMatches(leads) {
    return [...leads].sort(compareLeadIdentityPriority);
}
function isBookedLikeIdentityStage(stage) {
    return stage === 'booked' || stage === 'completed' || stage === 'customer_success';
}
function compareLeadIdentityPriorityIncludingClosed(left, right) {
    const leftBookedLike = isBookedLikeIdentityStage(left.stage);
    const rightBookedLike = isBookedLikeIdentityStage(right.stage);
    if (leftBookedLike !== rightBookedLike) {
        return leftBookedLike ? -1 : 1;
    }
    return compareLeadIdentityPriority(left, right);
}
function leadSharesIdentity(lead, input) {
    if (input.inboundId && lead.inboundId && input.inboundId === lead.inboundId) {
        return true;
    }
    if (phonesMatch(lead.identityPhone || lead.phone, input.phone)) {
        return true;
    }
    return emailsMatch(lead.identityEmail || lead.email, input.email);
}
function findLeadIdentityMatches(leads, input) {
    const matches = leads.filter(lead => {
        if (!input.includeClosed && (0, sales_1.isClosedLeadStage)(lead.stage)) {
            return false;
        }
        return leadSharesIdentity(lead, input);
    });
    return input.includeClosed
        ? [...matches].sort(compareLeadIdentityPriorityIncludingClosed)
        : sortLeadIdentityMatches(matches);
}
function findMatchingActiveLead(leads, phone, email, inboundId) {
    return findLeadIdentityMatches(leads, {
        phone,
        email,
        inboundId,
        includeClosed: false,
    })[0] || null;
}
function chooseCanonicalLead(leads) {
    return sortLeadIdentityMatches(leads)[0] || null;
}
function choosePreferredText(primary, duplicate) {
    return normalizeOptionalText(primary) || normalizeOptionalText(duplicate);
}
function choosePreferredName(primary, duplicate) {
    if (!isPlaceholderName(primary)) {
        return normalizeOptionalText(primary) || normalizeOptionalText(duplicate) || 'Unknown Lead';
    }
    return normalizeOptionalText(duplicate) || normalizeOptionalText(primary) || 'Unknown Lead';
}
function chooseEarlierDate(left, right) {
    const values = [left, right].filter((value) => !!normalizeOptionalText(value));
    if (values.length === 0)
        return undefined;
    return [...values].sort()[0];
}
function chooseLatestDate(left, right) {
    const values = [left, right].filter((value) => !!normalizeOptionalText(value));
    if (values.length === 0)
        return undefined;
    return [...values].sort().pop();
}
function mergeDistinctText(primary, duplicate, separator = '\n\n') {
    const normalizedPrimary = normalizeOptionalText(primary);
    const normalizedDuplicate = normalizeOptionalText(duplicate);
    if (!normalizedPrimary)
        return normalizedDuplicate;
    if (!normalizedDuplicate)
        return normalizedPrimary;
    if (normalizedPrimary === normalizedDuplicate)
        return normalizedPrimary;
    if (normalizedPrimary.includes(normalizedDuplicate))
        return normalizedPrimary;
    if (normalizedDuplicate.includes(normalizedPrimary))
        return normalizedDuplicate;
    return `${normalizedPrimary}${separator}${normalizedDuplicate}`;
}
function mergeStringArrays(primary, duplicate) {
    const next = Array.from(new Set([...(primary || []), ...(duplicate || [])].filter(Boolean)));
    return next.length > 0 ? next : undefined;
}
function dedupeByKey(items, getKey) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
        const key = getKey(item);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        output.push(item);
    }
    return output;
}
function mergeLeadRecords(primary, duplicate, options = {}) {
    const mergedAt = options.mergedAt || new Date().toISOString();
    const mergedQuoteIds = mergeStringArrays(mergeStringArrays(primary.quoteIds, primary.quoteId ? [primary.quoteId] : []), mergeStringArrays(duplicate.quoteIds, duplicate.quoteId ? [duplicate.quoteId] : []));
    const mergedInventory = dedupeByKey([...(primary.inventory || []), ...(duplicate.inventory || [])], item => item.id || `${item.room || ''}:${item.name || ''}:${item.qty || 0}:${item.cubicFeet || 0}`);
    const mergedMediaAssets = dedupeByKey([...(primary.mediaAssets || []), ...(duplicate.mediaAssets || [])], asset => asset.id || `${asset.url}:${asset.filename || ''}:${asset.uploadedAt || ''}`);
    const mergedCallLogs = dedupeByKey([...(primary.callLogs || []), ...(duplicate.callLogs || [])], entry => entry.callSid || entry.recordingSid || entry.id || `${entry.type}:${entry.date}:${entry.notes || ''}`);
    const mergedAttributionSignals = dedupeByKey([...(primary.attributionSignals || []), ...(duplicate.attributionSignals || [])], signal => signal.id || `${signal.channel}:${signal.detail || ''}:${signal.influence}`);
    const mergedMoveRelationships = dedupeByKey([...(primary.moveRelationships || []), ...(duplicate.moveRelationships || [])], relationship => relationship.id || `${relationship.contactId || relationship.name}:${relationship.role}`);
    return (0, sales_1.normalizeLead)({
        ...duplicate,
        ...primary,
        id: primary.id,
        name: choosePreferredName(primary.name, duplicate.name),
        phone: choosePreferredText(primary.phone, duplicate.phone),
        email: choosePreferredText(primary.email, duplicate.email)?.toLowerCase(),
        identityPhone: normalizeLeadIdentityPhone(primary.identityPhone || primary.phone || duplicate.identityPhone || duplicate.phone),
        identityEmail: normalizeLeadIdentityEmail(primary.identityEmail || primary.email || duplicate.identityEmail || duplicate.email),
        inboundId: primary.inboundId || duplicate.inboundId,
        inboundMessage: mergeDistinctText(primary.inboundMessage, duplicate.inboundMessage),
        opportunityContext: primary.opportunityContext || duplicate.opportunityContext,
        attributionSignals: mergedAttributionSignals.length ? mergedAttributionSignals : undefined,
        moveRelationships: mergedMoveRelationships.length ? mergedMoveRelationships : undefined,
        source: primary.source || duplicate.source,
        referralCustomerName: choosePreferredText(primary.referralCustomerName, duplicate.referralCustomerName),
        partnerReferralContactId: choosePreferredText(primary.partnerReferralContactId, duplicate.partnerReferralContactId),
        partnerReferralName: choosePreferredText(primary.partnerReferralName, duplicate.partnerReferralName),
        partnerReferralCompany: choosePreferredText(primary.partnerReferralCompany, duplicate.partnerReferralCompany),
        partnerReferralCategory: choosePreferredText(primary.partnerReferralCategory, duplicate.partnerReferralCategory),
        partnerReferralEmail: choosePreferredText(primary.partnerReferralEmail, duplicate.partnerReferralEmail),
        partnerReferralPhone: choosePreferredText(primary.partnerReferralPhone, duplicate.partnerReferralPhone),
        partnerReferralLinkedAt: choosePreferredText(primary.partnerReferralLinkedAt, duplicate.partnerReferralLinkedAt),
        relationshipContactId: choosePreferredText(primary.relationshipContactId, duplicate.relationshipContactId),
        relationshipContactName: choosePreferredText(primary.relationshipContactName, duplicate.relationshipContactName),
        relationshipContactCompany: choosePreferredText(primary.relationshipContactCompany, duplicate.relationshipContactCompany),
        relationshipContactCategory: choosePreferredText(primary.relationshipContactCategory, duplicate.relationshipContactCategory),
        relationshipContactLinkedAt: choosePreferredText(primary.relationshipContactLinkedAt, duplicate.relationshipContactLinkedAt),
        relationshipContactReason: primary.relationshipContactReason || duplicate.relationshipContactReason,
        moveDate: primary.moveDate || duplicate.moveDate,
        moveDateFlexible: primary.moveDateFlexible ?? duplicate.moveDateFlexible,
        moveDateFlexibleReason: choosePreferredText(primary.moveDateFlexibleReason, duplicate.moveDateFlexibleReason),
        moveType: primary.moveType || duplicate.moveType,
        propertyBedrooms: primary.propertyBedrooms || duplicate.propertyBedrooms,
        propertyType: primary.propertyType || duplicate.propertyType,
        originStairFlights: primary.originStairFlights ?? duplicate.originStairFlights,
        destStairFlights: primary.destStairFlights ?? duplicate.destStairFlights,
        originElevatorAccess: primary.originElevatorAccess ?? duplicate.originElevatorAccess,
        destElevatorAccess: primary.destElevatorAccess ?? duplicate.destElevatorAccess,
        quoteType: primary.quoteType || duplicate.quoteType,
        additionalStops: primary.additionalStops ?? duplicate.additionalStops,
        originAddress: choosePreferredText(primary.originAddress, duplicate.originAddress),
        originCity: choosePreferredText(primary.originCity, duplicate.originCity),
        originAccess: choosePreferredText(primary.originAccess, duplicate.originAccess),
        destAddress: choosePreferredText(primary.destAddress, duplicate.destAddress),
        destCity: choosePreferredText(primary.destCity, duplicate.destCity),
        destAccess: choosePreferredText(primary.destAccess, duplicate.destAccess),
        parkingNotes: mergeDistinctText(primary.parkingNotes, duplicate.parkingNotes),
        supabaseListing: primary.supabaseListing || duplicate.supabaseListing || null,
        listingScanSnapshot: primary.listingScanSnapshot || duplicate.listingScanSnapshot || null,
        realtorName: choosePreferredText(primary.realtorName, duplicate.realtorName),
        realtorEmail: choosePreferredText(primary.realtorEmail, duplicate.realtorEmail)?.toLowerCase(),
        realtorPhone: choosePreferredText(primary.realtorPhone, duplicate.realtorPhone),
        realtorBrokerage: choosePreferredText(primary.realtorBrokerage, duplicate.realtorBrokerage),
        realtorWebsite: choosePreferredText(primary.realtorWebsite, duplicate.realtorWebsite),
        realtorContactId: choosePreferredText(primary.realtorContactId, duplicate.realtorContactId),
        realtorContactKind: primary.realtorContactKind || duplicate.realtorContactKind,
        realtorLookupStatus: primary.realtorLookupStatus || duplicate.realtorLookupStatus,
        realtorLookupConfidence: primary.realtorLookupConfidence || duplicate.realtorLookupConfidence,
        realtorWarmth: primary.realtorWarmth || duplicate.realtorWarmth,
        realtorOutreachStatus: primary.realtorOutreachStatus || duplicate.realtorOutreachStatus,
        realtorEnrichedAt: chooseLatestDate(primary.realtorEnrichedAt, duplicate.realtorEnrichedAt),
        realtorOutreachStartedAt: chooseEarlierDate(primary.realtorOutreachStartedAt, duplicate.realtorOutreachStartedAt),
        realtorLastTouchAt: chooseLatestDate(primary.realtorLastTouchAt, duplicate.realtorLastTouchAt),
        moveReason: choosePreferredText(primary.moveReason, duplicate.moveReason),
        customerPriority: primary.customerPriority || duplicate.customerPriority,
        notes: mergeDistinctText(primary.notes, duplicate.notes),
        followUpDate: chooseEarlierDate(primary.followUpDate, duplicate.followUpDate),
        followUpNote: mergeDistinctText(primary.followUpNote, duplicate.followUpNote),
        surveyToken: primary.surveyToken || duplicate.surveyToken,
        surveyTokenExpiresAt: chooseLatestDate(primary.surveyTokenExpiresAt, duplicate.surveyTokenExpiresAt),
        surveyRequestedAt: chooseEarlierDate(primary.surveyRequestedAt, duplicate.surveyRequestedAt),
        surveyCompletedAt: chooseLatestDate(primary.surveyCompletedAt, duplicate.surveyCompletedAt),
        surveyPhotoCount: Math.max(primary.surveyPhotoCount || 0, duplicate.surveyPhotoCount || 0) || undefined,
        surveyScannedAt: chooseLatestDate(primary.surveyScannedAt, duplicate.surveyScannedAt),
        inventoryVerification: primary.inventoryVerification || duplicate.inventoryVerification,
        quoteId: primary.quoteId || duplicate.quoteId || mergedQuoteIds?.[0],
        quoteIds: mergedQuoteIds,
        sourceLeadId: primary.sourceLeadId || duplicate.sourceLeadId,
        sourceLeadName: choosePreferredText(primary.sourceLeadName, duplicate.sourceLeadName),
        sourceLeadMoveDate: primary.sourceLeadMoveDate || duplicate.sourceLeadMoveDate,
        sourceLeadQuoteId: primary.sourceLeadQuoteId || duplicate.sourceLeadQuoteId,
        opportunityAddress: choosePreferredText(primary.opportunityAddress, duplicate.opportunityAddress),
        opportunityCity: choosePreferredText(primary.opportunityCity, duplicate.opportunityCity),
        opportunityDetectedAt: chooseEarlierDate(primary.opportunityDetectedAt, duplicate.opportunityDetectedAt),
        destinationOpportunityLeadId: primary.destinationOpportunityLeadId || duplicate.destinationOpportunityLeadId,
        destinationOpportunityStatus: primary.destinationOpportunityStatus || duplicate.destinationOpportunityStatus,
        destinationOpportunityLastCheckedAt: chooseLatestDate(primary.destinationOpportunityLastCheckedAt, duplicate.destinationOpportunityLastCheckedAt),
        leadScore: Math.max(primary.leadScore || 0, duplicate.leadScore || 0) || undefined,
        firstResponseAt: chooseEarlierDate(primary.firstResponseAt, duplicate.firstResponseAt),
        lastInboundAt: chooseLatestDate(primary.lastInboundAt, duplicate.lastInboundAt),
        lastOutboundAt: chooseLatestDate(primary.lastOutboundAt, duplicate.lastOutboundAt),
        lastHumanOutboundAt: chooseLatestDate(primary.lastHumanOutboundAt, duplicate.lastHumanOutboundAt),
        lastAutomationOutboundAt: chooseLatestDate(primary.lastAutomationOutboundAt, duplicate.lastAutomationOutboundAt),
        automationSettings: primary.automationSettings || duplicate.automationSettings,
        automationStatus: primary.automationStatus || duplicate.automationStatus,
        automationPausedUntil: chooseLatestDate(primary.automationPausedUntil, duplicate.automationPausedUntil),
        automationPauseReason: choosePreferredText(primary.automationPauseReason, duplicate.automationPauseReason),
        automationHandoffAt: chooseLatestDate(primary.automationHandoffAt, duplicate.automationHandoffAt),
        automationHandoffReason: choosePreferredText(primary.automationHandoffReason, duplicate.automationHandoffReason),
        automationLastJobAt: chooseLatestDate(primary.automationLastJobAt, duplicate.automationLastJobAt),
        lastMissedCallAt: chooseLatestDate(primary.lastMissedCallAt, duplicate.lastMissedCallAt),
        lastMissedCallAutoReplyAt: chooseLatestDate(primary.lastMissedCallAutoReplyAt, duplicate.lastMissedCallAutoReplyAt),
        lastVoicemailAt: chooseLatestDate(primary.lastVoicemailAt, duplicate.lastVoicemailAt),
        automatedQuoteSentAt: chooseLatestDate(primary.automatedQuoteSentAt, duplicate.automatedQuoteSentAt),
        automatedQuoteId: primary.automatedQuoteId || duplicate.automatedQuoteId,
        automatedQuoteChannel: primary.automatedQuoteChannel || duplicate.automatedQuoteChannel,
        lastAutoEnrichmentAt: chooseLatestDate(primary.lastAutoEnrichmentAt, duplicate.lastAutoEnrichmentAt),
        qualificationState: primary.qualificationState || duplicate.qualificationState,
        inboxState: primary.inboxState || duplicate.inboxState,
        directMailAttributed: primary.directMailAttributed || duplicate.directMailAttributed,
        inventory: mergedInventory,
        mediaAssets: mergedMediaAssets,
        totalItems: Math.max(primary.totalItems || 0, duplicate.totalItems || 0) || undefined,
        totalCubicFeet: Math.max(primary.totalCubicFeet || 0, duplicate.totalCubicFeet || 0) || undefined,
        totalWeightLbs: Math.max(primary.totalWeightLbs || 0, duplicate.totalWeightLbs || 0) || undefined,
        roomBreakdown: Object.keys(primary.roomBreakdown || {}).length > 0 ? primary.roomBreakdown : duplicate.roomBreakdown,
        callLogs: mergedCallLogs,
        jobFactors: primary.jobFactors || duplicate.jobFactors,
        intelligence: primary.intelligence || duplicate.intelligence,
        lostReason: primary.lostReason || duplicate.lostReason,
        lostNotes: mergeDistinctText(primary.lostNotes, duplicate.lostNotes),
        lostAt: chooseEarlierDate(primary.lostAt, duplicate.lostAt),
        contextFlag: primary.contextFlag || duplicate.contextFlag,
        assignedRep: primary.assignedRep || duplicate.assignedRep,
        assignedRepName: primary.assignedRepName || duplicate.assignedRepName || duplicate.assignedRep,
        assignedRepUserId: primary.assignedRepUserId || duplicate.assignedRepUserId,
        leadOwnerStatus: primary.leadOwnerStatus || duplicate.leadOwnerStatus,
        ownedAt: chooseEarlierDate(primary.ownedAt, duplicate.ownedAt),
        lastTouchedByUserId: primary.lastTouchedByUserId || duplicate.lastTouchedByUserId,
        lastTouchedByName: primary.lastTouchedByName || duplicate.lastTouchedByName,
        lastTouchedAt: chooseLatestDate(primary.lastTouchedAt, duplicate.lastTouchedAt) || mergedAt,
        assignedCrew: mergeStringArrays(primary.assignedCrew, duplicate.assignedCrew),
        crewNote: mergeDistinctText(primary.crewNote, duplicate.crewNote),
        crewHours: dedupeByKey([...(primary.crewHours || []), ...(duplicate.crewHours || [])], entry => `${entry.userId || ''}:${entry.name || ''}:${entry.hours || 0}`),
        crewPayouts: dedupeByKey([...(primary.crewPayouts || []), ...(duplicate.crewPayouts || [])], entry => entry.id || `${entry.userId || ''}:${entry.workerName || ''}:${entry.submittedAt || ''}`),
        truckReservationStatus: primary.truckReservationStatus || duplicate.truckReservationStatus,
        truckVendor: primary.truckVendor || duplicate.truckVendor,
        truckSize: choosePreferredText(primary.truckSize, duplicate.truckSize),
        truckCountConfirmed: primary.truckCountConfirmed ?? duplicate.truckCountConfirmed,
        truckPickupLocation: choosePreferredText(primary.truckPickupLocation, duplicate.truckPickupLocation),
        truckPickupTime: choosePreferredText(primary.truckPickupTime, duplicate.truckPickupTime),
        truckReturnLocation: choosePreferredText(primary.truckReturnLocation, duplicate.truckReturnLocation),
        truckReservationNumber: choosePreferredText(primary.truckReservationNumber, duplicate.truckReservationNumber),
        truckReservationNotes: mergeDistinctText(primary.truckReservationNotes, duplicate.truckReservationNotes),
        truckReservationBookedAt: chooseEarlierDate(primary.truckReservationBookedAt, duplicate.truckReservationBookedAt),
        truckReservationBookedBy: choosePreferredText(primary.truckReservationBookedBy, duplicate.truckReservationBookedBy),
        opsChecklist: primary.opsChecklist || duplicate.opsChecklist,
        estimateDate: primary.estimateDate || duplicate.estimateDate,
        estimateTime: primary.estimateTime || duplicate.estimateTime,
        consultationTriggerReason: choosePreferredText(primary.consultationTriggerReason, duplicate.consultationTriggerReason),
        consultationAssignedManagerName: primary.consultationAssignedManagerName || duplicate.consultationAssignedManagerName,
        consultationAssignedManagerId: primary.consultationAssignedManagerId || duplicate.consultationAssignedManagerId,
        consultationCustomerConcern: mergeDistinctText(primary.consultationCustomerConcern, duplicate.consultationCustomerConcern),
        consultationPreVisitBrief: mergeDistinctText(primary.consultationPreVisitBrief, duplicate.consultationPreVisitBrief),
        consultationStatus: primary.consultationStatus || duplicate.consultationStatus,
        consultationBookedAt: chooseEarlierDate(primary.consultationBookedAt, duplicate.consultationBookedAt),
        bookedAt: chooseEarlierDate(primary.bookedAt, duplicate.bookedAt),
        depositAmount: primary.depositAmount ?? duplicate.depositAmount,
        depositMethod: primary.depositMethod || duplicate.depositMethod,
        depositDate: primary.depositDate || duplicate.depositDate,
        paymentStatus: primary.paymentStatus || duplicate.paymentStatus,
        cancelledAt: chooseEarlierDate(primary.cancelledAt, duplicate.cancelledAt),
        cancelReason: choosePreferredText(primary.cancelReason, duplicate.cancelReason),
        reviewJobId: primary.reviewJobId || duplicate.reviewJobId,
        reviewSentAt: chooseEarlierDate(primary.reviewSentAt, duplicate.reviewSentAt),
        reviewCompletedAt: chooseLatestDate(primary.reviewCompletedAt, duplicate.reviewCompletedAt),
        reviewRating: primary.reviewRating ?? duplicate.reviewRating,
        reviewNotes: mergeDistinctText(primary.reviewNotes, duplicate.reviewNotes),
        mergedIntoLeadId: undefined,
        mergedAt: undefined,
        mergedByUserId: undefined,
        mergedByName: undefined,
        mergedReason: undefined,
        createdAt: chooseEarlierDate(primary.createdAt, duplicate.createdAt) || primary.createdAt,
    });
}
