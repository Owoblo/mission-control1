"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adviseDynamicPrice = adviseDynamicPrice;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/**
 * Advisory pricing only. It deliberately uses operational cost/risk signals and
 * never customer identity, inferred wealth, protected traits, or opaque
 * willingness-to-pay scoring.
 */
function adviseDynamicPrice(input) {
    const base = Math.max(0, input.baseAmount);
    let adjustment = 0;
    const reasons = [];
    if ((input.branchCapacityPct || 0) >= 90) {
        adjustment += 0.08;
        reasons.push('Branch capacity is above 90%; protect overtime and backup-crew cost.');
    }
    else if ((input.branchCapacityPct || 0) >= 75) {
        adjustment += 0.04;
        reasons.push('Branch capacity is tightening for the requested date.');
    }
    else if ((input.branchCapacityPct || 0) <= 35 && (input.daysUntilMove || 0) >= 7) {
        adjustment -= 0.03;
        reasons.push('Open capacity can support a modest calendar-fill incentive.');
    }
    if (input.daysUntilMove !== undefined && input.daysUntilMove <= 2) {
        adjustment += 0.06;
        reasons.push('Short-notice move requires dispatch flexibility.');
    }
    const riskAdjustment = { low: 0, medium: 0.03, high: 0.07 };
    adjustment += riskAdjustment[input.routeRisk || 'low'];
    adjustment += riskAdjustment[input.accessRisk || 'low'];
    if (input.routeRisk === 'high')
        reasons.push('Route has elevated operational uncertainty.');
    if (input.accessRisk === 'high')
        reasons.push('Access has elevated labor or delay risk.');
    const complexityAdjustment = {
        standard: 0,
        multi_stop: 0.04,
        storage_staged: 0.06,
        conjoint: 0.05,
        junk_addon: 0.03,
    };
    adjustment += complexityAdjustment[input.complexity || 'standard'];
    if (input.complexity && input.complexity !== 'standard') {
        reasons.push(`Scope includes ${input.complexity.replace(/_/g, ' ')} coordination.`);
    }
    const referralDiscount = clamp(input.referralDiscountPct || 0, 0, 0.15);
    if (referralDiscount > 0) {
        adjustment -= referralDiscount;
        reasons.push(`Transparent referral discount of ${Math.round(referralDiscount * 100)}%.`);
    }
    // Do not let an advisory engine silently swing a quote beyond ±15%.
    adjustment = clamp(adjustment, -0.15, 0.15);
    const scopeConfidence = input.scopeConfidence || 'low';
    const uncertaintyBand = scopeConfidence === 'high' ? 0.03 : scopeConfidence === 'medium' ? 0.07 : 0.12;
    const recommendedAmount = Math.round(base * (1 + adjustment));
    if (scopeConfidence !== 'high') {
        reasons.push('Inventory or access is not fully confirmed; keep this as a range, not a binding price.');
    }
    return {
        recommendedAmount,
        floorAmount: Math.round(recommendedAmount * (1 - uncertaintyBand)),
        ceilingAmount: Math.round(recommendedAmount * (1 + uncertaintyBand)),
        adjustmentPct: Math.round(adjustment * 100),
        confidence: scopeConfidence,
        requiresReview: scopeConfidence === 'low' || Math.abs(adjustment) >= 0.1,
        reasons,
    };
}
