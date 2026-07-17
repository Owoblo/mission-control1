"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNonBindingQuote = isNonBindingQuote;
exports.getQuotePaidSoFar = getQuotePaidSoFar;
exports.recalculateQuoteFromActuals = recalculateQuoteFromActuals;
function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}
function appendInternalNote(existing, nextLine) {
    const trimmed = (existing || '').trim();
    if (!trimmed)
        return nextLine;
    if (trimmed.includes(nextLine))
        return trimmed;
    return `${trimmed}\n${nextLine}`;
}
function getQuoteBillingModel(quote) {
    if (quote.billingModel)
        return quote.billingModel;
    if (quote.number.startsWith('FL-'))
        return 'hourly_minimum';
    return isNonBindingQuote(quote) ? 'hourly_actuals' : 'binding';
}
function getQuoteHourlyRate(quote) {
    const explicit = roundMoney(Number(quote.hourlyRateOverride || 0));
    if (explicit > 0)
        return explicit;
    const estimatedHours = Number(quote.estimatedHours || 0);
    if (!Number.isFinite(estimatedHours) || estimatedHours <= 0)
        return 0;
    return roundMoney(Number(quote.subtotal || 0) / estimatedHours);
}
function getMinimumBillableHours(quote) {
    const explicit = Number(quote.minimumBillableHours || 0);
    if (Number.isFinite(explicit) && explicit > 0)
        return explicit;
    if (quote.number.startsWith('FL-'))
        return Math.max(3, Number(quote.estimatedHours || 0) || 3);
    return 0;
}
function isNonBindingQuote(quote) {
    const haystack = [
        quote.number,
        quote.internalNotes,
        ...quote.lineItems.flatMap(item => [item.description, item.details]),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes('not a binding estimate') || quote.number.startsWith('FL-');
}
function getQuotePaidSoFar(quote, lead) {
    const depositPaid = Math.max(Number(quote.depositPaidAmount || 0), lead?.paymentStatus && lead.paymentStatus !== 'pending' ? Number(lead.depositAmount || 0) : 0);
    const balancePaid = Math.max(Number(quote.balancePaidAmount || 0), 0);
    const recordedPayments = (quote.paymentRecords || []).reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0);
    const legacyTotal = depositPaid + balancePaid;
    return {
        depositPaid: roundMoney(depositPaid),
        balancePaid: roundMoney(balancePaid),
        totalPaid: roundMoney(Math.max(legacyTotal, recordedPayments)),
    };
}
function recalculateQuoteFromActuals(quote, input) {
    const actualHours = Number(input.actualHours || 0);
    const estimatedHours = Number(quote.estimatedHours || 0);
    if (!Number.isFinite(actualHours) || actualHours <= 0 || !Number.isFinite(estimatedHours) || estimatedHours <= 0) {
        return null;
    }
    const hourlyRate = getQuoteHourlyRate(quote);
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0)
        return null;
    const billingModel = getQuoteBillingModel(quote);
    const nonBinding = billingModel === 'hourly_actuals' || billingModel === 'hourly_minimum';
    const minimumBillableHours = getMinimumBillableHours(quote);
    const justification = (input.justification || '').trim();
    const actualSubtotal = roundMoney(hourlyRate * actualHours);
    const minimumHoursSubtotal = minimumBillableHours > 0 ? roundMoney(hourlyRate * minimumBillableHours) : actualSubtotal;
    const minimumBilledHours = minimumBillableHours > 0 ? Math.max(actualHours, minimumBillableHours) : actualHours;
    const minimumAdjustedSubtotal = roundMoney(hourlyRate * minimumBilledHours);
    let nextSubtotal = roundMoney(quote.subtotal || 0);
    let adjustmentMode = 'none';
    if (billingModel === 'hourly_minimum') {
        nextSubtotal = Math.max(minimumHoursSubtotal, minimumAdjustedSubtotal);
        adjustmentMode = 'hourly_minimum';
    }
    else if (billingModel === 'hourly_actuals') {
        nextSubtotal = actualSubtotal;
        adjustmentMode = 'non_binding_actuals';
    }
    else if (actualSubtotal > nextSubtotal) {
        if (!justification) {
            return {
                requiresJustification: true,
                hourlyRate,
                actualSubtotal,
                nonBinding,
            };
        }
        nextSubtotal = actualSubtotal;
        adjustmentMode = 'binding_override';
    }
    const hst = roundMoney(nextSubtotal * 0.13);
    const total = roundMoney(nextSubtotal + hst);
    const paid = getQuotePaidSoFar(quote, input.lead);
    const balance = Math.max(0, roundMoney(total - paid.totalPaid));
    const notePrefix = adjustmentMode === 'hourly_minimum'
        ? `Actuals synced from completed move. ${minimumBillableHours}h minimum applied.`
        : nonBinding
            ? 'Actuals synced from completed move.'
            : adjustmentMode === 'binding_override'
                ? 'Binding estimate override approved from completed move.'
                : 'Actuals recorded for completed move.';
    const hoursNote = adjustmentMode === 'hourly_minimum' && minimumBilledHours !== actualHours
        ? `${actualHours}h worked, billed ${minimumBilledHours}h`
        : `${actualHours}h`;
    const note = `${notePrefix} ${hoursNote} at ${hourlyRate.toFixed(2)}/hr${justification ? ` — ${justification}` : ''}`;
    const updatedQuote = {
        ...quote,
        crewSize: input.actualCrew || quote.crewSize,
        subtotal: nextSubtotal,
        hst,
        total,
        balance,
        priceOverrideTotal: adjustmentMode === 'binding_override' ? total : quote.priceOverrideTotal,
        priceOverrideReason: adjustmentMode === 'binding_override' ? justification : quote.priceOverrideReason,
        internalNotes: appendInternalNote(quote.internalNotes, note),
    };
    return {
        requiresJustification: false,
        quote: updatedQuote,
        hourlyRate,
        actualSubtotal,
        adjustmentMode,
        nonBinding,
        paymentStatus: balance <= 0 ? 'paid_in_full' : paid.totalPaid > 0 ? 'deposit_received' : 'pending',
    };
}
