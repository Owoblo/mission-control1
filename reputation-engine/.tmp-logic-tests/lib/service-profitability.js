"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyServiceLine = classifyServiceLine;
exports.buildServiceProfitabilityPlan = buildServiceProfitabilityPlan;
function currency(value) {
    return Math.round(Math.max(0, value || 0) * 100) / 100;
}
function classifyServiceLine(description) {
    const value = description.toLowerCase();
    if (/\b(?:pack|packs|packed|packing|unpack|unpacks|unpacked|unpacking)\b/.test(value))
        return 'packing';
    if (/\b(box|boxes|tape|paper|material|supply|supplies)\b/.test(value))
        return 'materials';
    if (/\b(storage|locker|container)\b/.test(value))
        return 'storage';
    if (/\b(junk|disposal|dump|remove)\b/.test(value))
        return 'junk';
    if (/\b(clean|cleaning)\b/.test(value))
        return 'cleaning';
    if (/\b(piano|safe|pool table|hot tub|specialty|mount|dismount)\b/.test(value))
        return 'specialty';
    if (/\b(move|moving|delivery|labou?r|truck|crew)\b/.test(value))
        return 'moving';
    return 'custom';
}
function packageFromLine(item, index) {
    const category = classifyServiceLine(item.description || '');
    const revenue = currency(Number(item.amount || 0));
    const scope = [item.details?.trim()].filter(Boolean);
    const needsReview = revenue <= 0 && !/\bcomplimentary|included|credit\b/i.test(item.description || '');
    return {
        id: `line-${index}`,
        category,
        label: item.description || 'Custom service',
        revenue,
        allocatedDirectCost: 0,
        grossMarginPct: 0,
        scope,
        evidence: 'rep_entered',
        needsReview,
        reviewReason: needsReview ? 'This service has no price or explicit inclusion.' : undefined,
    };
}
function buildServiceProfitabilityPlan(input) {
    const packages = input.lineItems.map(packageFromLine);
    const protections = [];
    const factors = input.jobFactors || {};
    const pricing = input.pricingBreakdown;
    const lineCategories = new Set(packages.map(item => item.category));
    const legCategories = new Set((input.legs || []).map(leg => leg.type));
    if ((factors.packingStatus === 'partial' || factors.packingStatus === 'not-started') && !lineCategories.has('packing')) {
        protections.push('Packing is incomplete but no packing labour service is priced.');
    }
    if ((legCategories.has('storage') || legCategories.has('storage_delivery')) && !lineCategories.has('storage')) {
        protections.push('A storage leg exists but storage handling is not visible as a priced service.');
    }
    if (legCategories.has('junk') && !lineCategories.has('junk')) {
        protections.push('A junk-removal leg exists but disposal/handling is not visible as a priced service.');
    }
    if ((factors.hasPiano || factors.hasSafe || factors.hasHotTub || factors.hasPoolTable) && !lineCategories.has('specialty')) {
        protections.push('Specialty inventory is flagged but no specialty handling line is visible.');
    }
    if (!pricing || pricing.pricingStatus === 'provisional') {
        protections.push('Operational pricing is provisional; do not present this as a binding scope.');
    }
    if (pricing?.intelligenceFlags.missingDestination) {
        protections.push('Destination is missing, so travel and unload cost are incomplete.');
    }
    const revenue = currency(input.lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const directCost = currency(pricing?.internalCostEstimate.totalCost || 0);
    const costDriver = {
        moving: 1,
        packing: 0.8,
        storage: 0.45,
        junk: 0.75,
        cleaning: 0.7,
        specialty: 0.65,
        materials: 0.9,
        custom: 0.6,
    };
    const allocationBase = packages.reduce((sum, item) => sum + (item.revenue * costDriver[item.category]), 0);
    for (const item of packages) {
        const weight = item.revenue * costDriver[item.category];
        item.allocatedDirectCost = currency(allocationBase > 0 ? directCost * (weight / allocationBase) : 0);
        item.grossMarginPct = item.revenue > 0
            ? Math.round(((item.revenue - item.allocatedDirectCost) / item.revenue) * 1000) / 10
            : 0;
    }
    const grossProfit = currency(revenue - directCost);
    const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
    const hasUnpricedService = packages.some(item => item.needsReview);
    const status = revenue <= 0 || grossMarginPct < 45 || protections.length >= 3
        ? 'blocked'
        : grossMarginPct < 55 || protections.length > 0 || hasUnpricedService
            ? 'watch'
            : 'healthy';
    if (grossMarginPct < 45 && revenue > 0)
        protections.push('Projected gross margin is below the 45% protection floor.');
    if (hasUnpricedService)
        protections.push('At least one service needs a price or an explicit complimentary/included label.');
    return { packages, revenue, directCost, grossProfit, grossMarginPct, status, protections };
}
