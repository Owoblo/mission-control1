"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TENTATIVE_REASON_LABELS = void 0;
exports.buildTentativeReservationSms = buildTentativeReservationSms;
exports.buildTentativeReservationUpdate = buildTentativeReservationUpdate;
exports.reconcileTentativeReservation = reconcileTentativeReservation;
exports.TENTATIVE_REASON_LABELS = {
    reviewing_estimate: 'Reviewing the estimate',
    comparing_options: 'Comparing options',
    waiting_for_sale: 'Waiting for the home to sell',
    waiting_for_closing: 'Waiting for closing details',
    partner_decision: 'Deciding with a partner',
    date_uncertain: 'Move date is uncertain',
    other: 'Other',
};
function firstName(name) {
    return (name || 'there').trim().split(/\s+/)[0] || 'there';
}
function readableDate(value) {
    if (!value)
        return '';
    return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}
function buildTentativeReservationSms(input) {
    const name = firstName(input.customerName);
    const moveText = input.moveDate && !input.flexibleDate
        ? `for ${readableDate(input.moveDate)}`
        : 'for your upcoming move';
    return [
        `Hi ${name}, we have noted a tentative reservation ${moveText} while you finalize the details.`,
        `It is a courtesy hold—not a confirmed booking or deposit—and we will check in by ${readableDate(input.decisionDate)} before releasing it.`,
        'If your date, destination, or scope changes, just let us know and we will adjust the plan with you.',
    ].join('\n\n');
}
function buildTentativeReservationUpdate(input) {
    const now = input.now || new Date();
    const decision = new Date(`${input.decisionDate}T23:59:59.999Z`);
    if (Number.isNaN(decision.getTime()) || decision.getTime() < now.getTime()) {
        throw new Error('Tentative reservation needs a future decision date.');
    }
    return {
        stage: 'tentative',
        tentativeReservationStatus: 'active',
        tentativeReservedAt: now.toISOString(),
        tentativeHoldDate: input.moveDate,
        tentativeDecisionDate: input.decisionDate,
        tentativeExpiresAt: decision.toISOString(),
        tentativeReason: input.reason,
        tentativeNotes: input.notes?.trim() || undefined,
        followUpDate: input.decisionDate,
        followUpStatus: 'pending',
        followUpNote: `Tentative reservation decision due — ${exports.TENTATIVE_REASON_LABELS[input.reason]}`,
    };
}
function reconcileTentativeReservation(lead, now = new Date()) {
    if (lead.tentativeReservationStatus !== 'active')
        return { changed: false, lead };
    if (lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success') {
        return {
            changed: true,
            outcome: 'converted',
            lead: { ...lead, tentativeReservationStatus: 'converted' },
        };
    }
    if (lead.stage === 'lost') {
        return {
            changed: true,
            outcome: 'released',
            lead: { ...lead, tentativeReservationStatus: 'released' },
        };
    }
    const expiresAt = lead.tentativeExpiresAt ? new Date(lead.tentativeExpiresAt) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() >= now.getTime()) {
        return { changed: false, lead };
    }
    const today = now.toISOString().slice(0, 10);
    return {
        changed: true,
        outcome: 'expired',
        lead: {
            ...lead,
            stage: 'nurture',
            tentativeReservationStatus: 'expired',
            followUpDate: today,
            followUpStatus: 'pending',
            followUpNote: 'Tentative courtesy hold expired — review availability and contact the customer before promising the date again.',
        },
    };
}
