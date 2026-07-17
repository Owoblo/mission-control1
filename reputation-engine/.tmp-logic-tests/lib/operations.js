"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREW_ROLE_DEFAULT_RATES = exports.CREW_DISPATCH_STATUS_LABELS = exports.CREW_PAYOUT_STATUS_LABELS = exports.CREW_PAYOUT_METHOD_LABELS = exports.CREW_PAYOUT_ROLE_LABELS = exports.TRUCK_VENDOR_LABELS = exports.TRUCK_RESERVATION_STATUS_LABELS = void 0;
exports.isTruckReservationComplete = isTruckReservationComplete;
exports.getQuotedTruckCount = getQuotedTruckCount;
exports.isOneWayTruckPlan = isOneWayTruckPlan;
exports.getTruckPlanLabel = getTruckPlanLabel;
exports.normalizeCrewHours = normalizeCrewHours;
exports.getCrewRoleDefaultRate = getCrewRoleDefaultRate;
exports.computeCrewPayoutAmounts = computeCrewPayoutAmounts;
exports.normalizeCrewPayouts = normalizeCrewPayouts;
exports.deriveOpsChecklist = deriveOpsChecklist;
exports.countCompletedOpsChecklist = countCompletedOpsChecklist;
exports.TRUCK_RESERVATION_STATUS_LABELS = {
    not_needed: 'No truck needed',
    needs_booking: 'Needs booking',
    booking_in_progress: 'Booking in progress',
    reserved: 'Reserved',
    issue: 'Issue / follow-up',
};
exports.TRUCK_VENDOR_LABELS = {
    uhaul: 'U-Haul',
    penske: 'Penske',
    budget: 'Budget',
    enterprise: 'Enterprise',
    other: 'Other',
};
exports.CREW_PAYOUT_ROLE_LABELS = {
    crew_lead: 'Crew Lead',
    driver: 'Driver',
    mover: 'Mover',
    other: 'Other',
};
exports.CREW_PAYOUT_METHOD_LABELS = {
    interac: 'Interac',
    stripe_connect: 'Stripe Connect',
    cash: 'Cash',
    manual: 'Manual',
};
exports.CREW_PAYOUT_STATUS_LABELS = {
    draft: 'Draft',
    submitted: 'Submitted',
    approved: 'Approved',
    paid: 'Paid',
};
exports.CREW_DISPATCH_STATUS_LABELS = {
    pending: 'Pending',
    sent: 'Sent',
    confirmed: 'Confirmed',
    declined: 'Declined',
};
exports.CREW_ROLE_DEFAULT_RATES = {
    crew_lead: 25,
    driver: 22,
    mover: 18,
    other: 18,
};
function isTruckReservationComplete(status) {
    return status === 'reserved';
}
function getQuotedTruckCount(lead, quote) {
    const count = Number(quote?.truckCount || lead?.truckCountConfirmed || 0);
    if (!Number.isFinite(count) || count <= 0)
        return undefined;
    return Math.max(1, Math.round(count));
}
function isOneWayTruckPlan(lead, quote) {
    return (quote?.quoteType === 'long_distance' ||
        quote?.moveType === 'long-distance' ||
        lead?.moveType === 'long-distance');
}
function getTruckPlanLabel(lead, quote) {
    const truckCount = getQuotedTruckCount(lead, quote);
    if (!truckCount)
        return 'No quoted truck requirement yet';
    const truckSize = lead?.truckSize || '26ft';
    const tripType = isOneWayTruckPlan(lead, quote) ? 'One-way' : 'Local return';
    return `${truckCount} x ${truckSize} truck${truckCount === 1 ? '' : 's'} · ${tripType}`;
}
function normalizeCrewHours(entries, assignedCrew) {
    const assigned = new Set((assignedCrew || []).filter(Boolean));
    if (assigned.size === 0)
        return undefined;
    const normalized = (entries || [])
        .filter(entry => entry?.userId && assigned.has(entry.userId))
        .map(entry => ({
        userId: entry.userId,
        name: entry.name?.trim() || undefined,
        role: entry.role?.trim() || undefined,
        hours: Number.isFinite(Number(entry.hours)) ? Number(entry.hours) : undefined,
    }));
    const seen = new Set();
    const unique = normalized.filter(entry => {
        if (seen.has(entry.userId))
            return false;
        seen.add(entry.userId);
        return true;
    });
    return unique.length > 0 ? unique : undefined;
}
function roundCurrency(value) {
    return Math.round(value * 100) / 100;
}
function normalizeOptionalText(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
function getCrewRoleDefaultRate(role) {
    return exports.CREW_ROLE_DEFAULT_RATES[role || 'mover'] || exports.CREW_ROLE_DEFAULT_RATES.mover;
}
function computeCrewPayoutAmounts(entry) {
    const approvedHours = Number(entry.approvedHours || 0);
    const hourlyRate = Number(entry.hourlyRate || 0);
    const reimbursementAmount = Number(entry.reimbursementAmount || 0);
    const laborPay = roundCurrency(Math.max(0, approvedHours) * Math.max(0, hourlyRate));
    const totalPay = roundCurrency(laborPay + Math.max(0, reimbursementAmount));
    return { laborPay, totalPay };
}
function normalizeCrewPayouts(entries) {
    const seen = new Set();
    const normalized = (entries || []).reduce((list, entry) => {
        const id = normalizeOptionalText(entry.id);
        const workerName = normalizeOptionalText(entry.workerName);
        if (!id || !workerName)
            return list;
        const role = entry.role || 'mover';
        const hourlyRate = Number(entry.hourlyRate || getCrewRoleDefaultRate(role));
        const approvedHours = Number(entry.approvedHours || 0);
        const reimbursementAmount = Number(entry.reimbursementAmount || 0);
        const { laborPay } = computeCrewPayoutAmounts({
            approvedHours,
            hourlyRate,
            reimbursementAmount,
        });
        const normalizedEntry = {
            id,
            userId: normalizeOptionalText(entry.userId),
            workerName,
            workerEmail: normalizeOptionalText(entry.workerEmail),
            workerPhone: normalizeOptionalText(entry.workerPhone),
            role,
            hourlyRate: roundCurrency(hourlyRate),
            approvedHours: roundCurrency(approvedHours),
            laborPay,
            reimbursementAmount: reimbursementAmount > 0 ? roundCurrency(reimbursementAmount) : undefined,
            reimbursementNote: normalizeOptionalText(entry.reimbursementNote),
            receiptReference: normalizeOptionalText(entry.receiptReference),
            paymentMethod: entry.paymentMethod || 'interac',
            payoutDestination: normalizeOptionalText(entry.payoutDestination),
            payoutStatus: entry.payoutStatus || 'submitted',
            dispatchStatus: entry.dispatchStatus || 'pending',
            dispatchToken: normalizeOptionalText(entry.dispatchToken),
            dispatchSentAt: normalizeOptionalText(entry.dispatchSentAt),
            dispatchConfirmedAt: normalizeOptionalText(entry.dispatchConfirmedAt),
            dispatchDeclinedAt: normalizeOptionalText(entry.dispatchDeclinedAt),
            submittedAt: normalizeOptionalText(entry.submittedAt) || new Date().toISOString(),
            approvedAt: normalizeOptionalText(entry.approvedAt),
            approvedBy: normalizeOptionalText(entry.approvedBy),
            paidAt: normalizeOptionalText(entry.paidAt),
            paidBy: normalizeOptionalText(entry.paidBy),
            financeNote: normalizeOptionalText(entry.financeNote),
            financeCostId: normalizeOptionalText(entry.financeCostId),
            createdAt: normalizeOptionalText(entry.createdAt) || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        if (seen.has(normalizedEntry.id))
            return list;
        seen.add(normalizedEntry.id);
        list.push(normalizedEntry);
        return list;
    }, []);
    return normalized.length > 0 ? normalized : undefined;
}
function deriveOpsChecklist(lead) {
    const existing = lead.opsChecklist || {};
    return {
        crewAssigned: (lead.assignedCrew?.length ?? 0) > 0 || (lead.crewPayouts?.some(entry => !!entry.workerName) ?? false),
        truckReserved: isTruckReservationComplete(lead.truckReservationStatus),
        accessConfirmed: existing.accessConfirmed ?? Boolean(lead.originAccess || lead.destAccess),
        parkingConfirmed: existing.parkingConfirmed ?? Boolean(lead.parkingNotes),
        toolsReady: existing.toolsReady ?? false,
        jobPacketReady: existing.jobPacketReady ?? false,
        finalWalkthroughComplete: existing.finalWalkthroughComplete ?? false,
    };
}
function countCompletedOpsChecklist(checklist) {
    const values = Object.values(checklist || {});
    return values.filter(Boolean).length;
}
