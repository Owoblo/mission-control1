"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAnalyticsFilters = resolveAnalyticsFilters;
exports.buildCRMAnalyticsSnapshot = buildCRMAnalyticsSnapshot;
const sales_1 = require("../sales");
const operations_capacity_1 = require("../operations-capacity");
const runtime_1 = require("./runtime");
const service_profitability_1 = require("../service-profitability");
function toDateOnly(value) {
    return (value || '').slice(0, 10);
}
function startOfToday() {
    return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T12:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}
function startOfWeek(date = new Date()) {
    const base = new Date(date);
    const day = base.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    base.setDate(base.getDate() + diff);
    return base.toISOString().slice(0, 10);
}
function startOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}
function startOfYear(date = new Date()) {
    return new Date(date.getFullYear(), 0, 1).toISOString().slice(0, 10);
}
function resolveAnalyticsFilters(searchParams) {
    const range = (searchParams.get('range') || 'month');
    const today = startOfToday();
    const dateFrom = searchParams.get('dateFrom') ||
        (range === 'week' ? startOfWeek() : range === 'ytd' ? startOfYear() : startOfMonth());
    const dateTo = searchParams.get('dateTo') || today;
    return {
        range: range === 'week' || range === 'ytd' ? range : 'month',
        rep: searchParams.get('rep') || undefined,
        source: searchParams.get('source') || undefined,
        branch: searchParams.get('branch') || undefined,
        dateFrom,
        dateTo,
    };
}
function isWithinRange(dateStr, dateFrom, dateTo) {
    if (!dateStr)
        return false;
    const date = toDateOnly(dateStr);
    return date >= dateFrom && date <= dateTo;
}
function matchesLeadFilters(lead, filters) {
    if (filters.source && lead.source !== filters.source)
        return false;
    if (filters.branch && lead.branch !== filters.branch)
        return false;
    if (filters.rep && (0, sales_1.getLeadAssignedRepKey)(lead) !== filters.rep)
        return false;
    return true;
}
function buildTrendBuckets(filters) {
    const buckets = [];
    let cursor = filters.dateFrom;
    while (cursor <= filters.dateTo) {
        buckets.push({
            label: filters.range === 'ytd'
                ? new Date(`${cursor}T12:00:00`).toLocaleDateString('en-CA', { month: 'short' })
                : (0, sales_1.formatDate)(cursor).replace(',', ''),
            leads: 0,
            bookings: 0,
            revenue: 0,
        });
        cursor = filters.range === 'ytd'
            ? new Date(new Date(`${cursor}T12:00:00`).getFullYear(), new Date(`${cursor}T12:00:00`).getMonth() + 1, 1).toISOString().slice(0, 10)
            : addDays(cursor, 1);
    }
    return buckets;
}
function trendBucketIndex(dateStr, filters) {
    if (!dateStr || !isWithinRange(dateStr, filters.dateFrom, filters.dateTo))
        return -1;
    if (filters.range === 'ytd') {
        const monthStart = toDateOnly(dateStr).slice(0, 7);
        return buildTrendBuckets(filters).findIndex(bucket => bucket.label === new Date(`${monthStart}-01T12:00:00`).toLocaleDateString('en-CA', { month: 'short' }));
    }
    const diff = Math.round((new Date(`${toDateOnly(dateStr)}T12:00:00`).getTime() - new Date(`${filters.dateFrom}T12:00:00`).getTime()) / 86400000);
    return diff >= 0 ? diff : -1;
}
function getQuoteForLead(quotesByLead, leadId) {
    const list = quotesByLead.get(leadId) || [];
    return (list.find(quote => quote.status === 'accepted' || quote.status === 'invoiced') ||
        list.find(quote => quote.status === 'viewed' || quote.status === 'sent') ||
        list[0] ||
        null);
}
function monthlyRevenueTarget() {
    const raw = Number((0, runtime_1.readEnv)('SALES_MONTHLY_REVENUE_TARGET') || 0);
    return raw > 0 ? raw : 100000;
}
function normalizeReasonLabel(reason) {
    if (!reason)
        return 'Unspecified';
    return sales_1.LOST_REASONS.find(item => item.id === reason)?.label || reason.replace(/_/g, ' ');
}
function buildCRMAnalyticsSnapshot(leads, quotes, followUps, filters) {
    const scopedLeads = leads.filter(lead => matchesLeadFilters(lead, filters));
    const scopedLeadIds = new Set(scopedLeads.map(lead => lead.id));
    const quotesByLead = new Map();
    for (const quote of quotes) {
        if (!quote.leadId || !scopedLeadIds.has(quote.leadId))
            continue;
        const list = quotesByLead.get(quote.leadId) || [];
        list.push(quote);
        quotesByLead.set(quote.leadId, list);
    }
    const leadsReceived = scopedLeads.filter(lead => isWithinRange(lead.createdAt, filters.dateFrom, filters.dateTo));
    const bookedLeads = scopedLeads.filter(lead => (0, sales_1.isBookedLikeStage)(lead.stage) && isWithinRange(lead.bookedAt || getQuoteForLead(quotesByLead, lead.id)?.acceptedAt, filters.dateFrom, filters.dateTo));
    const tentativeLeads = scopedLeads.filter(lead => lead.stage === 'tentative' && isWithinRange(lead.createdAt, filters.dateFrom, filters.dateTo));
    const reservationLeads = scopedLeads.filter(lead => Boolean(lead.tentativeReservedAt && isWithinRange(lead.tentativeReservedAt, filters.dateFrom, filters.dateTo)));
    const reservationStatusCounts = reservationLeads.reduce((counts, lead) => {
        const status = lead.tentativeReservationStatus || 'unknown';
        counts[status] = (counts[status] || 0) + 1;
        return counts;
    }, {});
    const reservationReasonCounts = reservationLeads.reduce((counts, lead) => {
        const reason = lead.tentativeReason || 'unspecified';
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
    }, {});
    const lostLeads = scopedLeads.filter(lead => lead.stage === 'lost' && isWithinRange(lead.lostAt || lead.createdAt, filters.dateFrom, filters.dateTo));
    const quotesInRange = quotes.filter(quote => quote.leadId && scopedLeadIds.has(quote.leadId) && isWithinRange(quote.createdAt, filters.dateFrom, filters.dateTo));
    const followUpsInRange = followUps.filter(entry => entry.leadId && scopedLeadIds.has(entry.leadId) && isWithinRange(entry.date || entry.createdAt, filters.dateFrom, filters.dateTo));
    const trend = buildTrendBuckets(filters);
    for (const lead of leadsReceived) {
        const index = trendBucketIndex(lead.createdAt, filters);
        if (index >= 0)
            trend[index].leads += 1;
    }
    let confirmedRevenue = 0;
    for (const lead of bookedLeads) {
        const bookingDate = lead.bookedAt || getQuoteForLead(quotesByLead, lead.id)?.acceptedAt;
        const index = trendBucketIndex(bookingDate, filters);
        const bestQuote = getQuoteForLead(quotesByLead, lead.id);
        const total = Number(bestQuote?.total || 0);
        confirmedRevenue += total;
        if (index >= 0) {
            trend[index].bookings += 1;
            trend[index].revenue += total;
        }
    }
    const averageQuoteValue = quotesInRange.length > 0
        ? Math.round(quotesInRange.reduce((sum, quote) => sum + Number(quote.total || 0), 0) / quotesInRange.length)
        : 0;
    const serviceMix = new Map();
    for (const quote of quotesInRange) {
        const booked = quote.status === 'accepted' || quote.status === 'invoiced';
        for (const line of quote.lineItems || []) {
            const category = (0, service_profitability_1.classifyServiceLine)(line.description || '');
            const current = serviceMix.get(category) || {
                quoteIds: new Set(),
                bookedQuoteIds: new Set(),
                quotedRevenue: 0,
                bookedRevenue: 0,
            };
            current.quoteIds.add(quote.id);
            current.quotedRevenue += Number(line.amount || 0);
            if (booked) {
                current.bookedQuoteIds.add(quote.id);
                current.bookedRevenue += Number(line.amount || 0);
            }
            serviceMix.set(category, current);
        }
    }
    const lostReasonCounts = {};
    for (const lead of lostLeads) {
        const reason = lead.lostReason || 'unspecified';
        lostReasonCounts[reason] = (lostReasonCounts[reason] || 0) + 1;
    }
    const followUpEligible = leadsReceived.filter(lead => lead.stage !== 'lost');
    const followUpCompliant = followUpEligible.filter(lead => {
        const responseAt = lead.firstResponseAt || lead.lastHumanOutboundAt;
        if (!responseAt || !lead.createdAt)
            return false;
        const diffHours = (new Date(responseAt).getTime() - new Date(lead.createdAt).getTime()) / 3600000;
        return diffHours >= 0 && diffHours <= 24;
    }).length;
    const followUpComplianceRate = followUpEligible.length > 0
        ? Math.round((followUpCompliant / followUpEligible.length) * 100)
        : 100;
    const branchOptions = Array.from(new Set(scopedLeads.map(lead => lead.branch).filter(Boolean))).map(branch => ({
        id: branch,
        label: branch.replace(/^./, char => char.toUpperCase()),
    }));
    const repOptions = Array.from(new Map(scopedLeads
        .map(lead => [(0, sales_1.getLeadAssignedRepKey)(lead), (0, sales_1.getLeadAssignedRepName)(lead)])
        .filter(([id, name]) => !!id && !!name))).map(([id, name]) => ({ id: id, label: name }));
    const sourceOptions = sales_1.CRM_LEAD_SOURCES
        .filter(source => scopedLeads.some(lead => lead.source === source.id))
        .map(source => ({ id: source.id, label: source.label }));
    const sourceCounts = scopedLeads.reduce((counts, lead) => {
        if (!lead.source)
            return counts;
        counts[lead.source] = (counts[lead.source] || 0) + 1;
        return counts;
    }, {});
    const next30Days = Array.from({ length: 30 }, (_, index) => addDays(startOfToday(), index));
    const futureBookedJobs = scopedLeads
        .filter(lead => (0, sales_1.isBookedLikeStage)(lead.stage))
        .map(lead => ({
        lead,
        quote: getQuoteForLead(quotesByLead, lead.id),
    }))
        .filter(job => {
        const moveDate = job.quote?.moveDate || job.lead.moveDate;
        return !!moveDate && moveDate >= startOfToday() && moveDate <= next30Days[next30Days.length - 1];
    });
    const utilizationBranchIds = filters.branch
        ? [filters.branch]
        : Object.keys(operations_capacity_1.BRANCH_CAPACITY_ESTIMATES);
    const truckUtilizationDays = next30Days.flatMap(date => utilizationBranchIds.map(branch => {
        const snapshot = (0, operations_capacity_1.computeBranchCapacitySnapshot)(futureBookedJobs, branch, date);
        return {
            date,
            branch,
            ...snapshot,
        };
    })).filter(day => day.status === 'ready' && day.jobsBooked > 0);
    const monthlyTarget = monthlyRevenueTarget();
    const monthlyProgressPct = monthlyTarget > 0 ? Math.min(100, Math.round((confirmedRevenue / monthlyTarget) * 100)) : 0;
    return {
        appliedFilters: filters,
        totals: {
            leadsReceived: leadsReceived.length,
            confirmedBookings: bookedLeads.length,
            confirmedRevenue,
            tentativeReservations: tentativeLeads.length,
            lostLeads: lostLeads.length,
            conversionRate: leadsReceived.length > 0 ? Math.round((bookedLeads.length / leadsReceived.length) * 100) : 0,
            averageQuoteValue,
            followUpComplianceRate,
            followUpCompliant,
            followUpEligible: followUpEligible.length,
            monthlyTarget,
            monthlyProgressPct,
        },
        trend,
        reservationFunnel: {
            total: reservationLeads.length,
            active: reservationStatusCounts.active || 0,
            converted: reservationStatusCounts.converted || 0,
            released: reservationStatusCounts.released || 0,
            expired: reservationStatusCounts.expired || 0,
            conversionRate: reservationLeads.length > 0
                ? Math.round(((reservationStatusCounts.converted || 0) / reservationLeads.length) * 100)
                : 0,
            reasons: Object.entries(reservationReasonCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([reason, count]) => ({ reason, label: reason.replace(/_/g, ' '), count })),
        },
        serviceBreakdown: [...serviceMix.entries()]
            .map(([category, values]) => ({
            category,
            label: category.replace(/^./, char => char.toUpperCase()),
            quoteCount: values.quoteIds.size,
            bookedCount: values.bookedQuoteIds.size,
            quotedRevenue: Math.round(values.quotedRevenue * 100) / 100,
            bookedRevenue: Math.round(values.bookedRevenue * 100) / 100,
            conversionRate: values.quoteIds.size > 0 ? Math.round((values.bookedQuoteIds.size / values.quoteIds.size) * 100) : 0,
        }))
            .sort((a, b) => b.quotedRevenue - a.quotedRevenue),
        sourceBreakdown: Object.entries(sourceCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([source, count]) => ({
            source,
            label: (0, sales_1.getLeadSourceLabel)(source),
            count,
        })),
        lostReasons: Object.entries(lostReasonCounts)
            .sort(([, a], [, b]) => b - a)
            .map(([reason, count]) => ({
            reason,
            label: normalizeReasonLabel(reason),
            count,
        })),
        activityBreakdown: Object.entries(followUpsInRange.reduce((counts, entry) => {
            counts[entry.type] = (counts[entry.type] || 0) + 1;
            return counts;
        }, {}))
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => ({ type, count })),
        truckUtilizationDays,
        branchBreakdown: sales_1.SALES_BRANCHES.map(b => {
            const branchLeads = scopedLeads.filter(l => l.branch === b.id);
            const received = branchLeads.filter(l => isWithinRange(l.createdAt, filters.dateFrom, filters.dateTo)).length;
            const booked = branchLeads.filter(l => (0, sales_1.isBookedLikeStage)(l.stage) && isWithinRange(l.bookedAt || getQuoteForLead(quotesByLead, l.id)?.acceptedAt, filters.dateFrom, filters.dateTo)).length;
            const lost = branchLeads.filter(l => l.stage === 'lost' && isWithinRange(l.lostAt || l.createdAt, filters.dateFrom, filters.dateTo)).length;
            return { branch: b.id, label: b.label, received, booked, lost, conversionRate: received > 0 ? Math.round((booked / received) * 100) : 0 };
        }).filter(b => b.received > 0 || b.booked > 0).sort((a, b) => b.received - a.received),
        filters: {
            repOptions,
            sourceOptions,
            branchOptions,
        },
    };
}
