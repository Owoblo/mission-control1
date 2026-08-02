"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = generateId;
exports.reviewCount = reviewCount;
exports.normalizeJob = normalizeJob;
exports.normalizePartner = normalizePartner;
exports.hydratePartnerStats = hydratePartnerStats;
exports.linksSentCount = linksSentCount;
const REVIEW_KEYS = ['google', 'yelp', 'facebook', 'media'];
const ACTIVE_JOB_STATUSES = ['sent', 'feedback-received', 'in-progress', 'complete'];
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function reviewCount(reviews) {
    return Object.values(reviews).filter(Boolean).length;
}
function normalizeJob(input) {
    const reviews = REVIEW_KEYS.reduce((acc, key) => {
        acc[key] = Boolean(input.reviews?.[key]);
        return acc;
    }, {});
    return {
        id: input.id,
        customerName: input.customerName.trim(),
        customerEmail: input.customerEmail.trim(),
        customerPhone: input.customerPhone.trim(),
        moveDate: input.moveDate,
        moveFrom: input.moveFrom.trim(),
        moveTo: input.moveTo.trim(),
        crewLead: input.crewLead.trim(),
        referralPartnerId: input.referralPartnerId || undefined,
        referralPartnerName: input.referralPartnerName || undefined,
        status: input.status ?? 'pending',
        feedbackRating: input.feedbackRating,
        feedbackComment: input.feedbackComment?.trim() || undefined,
        reviews,
        reviewConfirmedAt: input.reviewConfirmedAt ?? {},
        incentiveEarned: Boolean(input.incentiveEarned),
        incentivePaid: Boolean(input.incentivePaid),
        proofSentToPartner: Boolean(input.proofSentToPartner),
        createdAt: input.createdAt,
        reviewSentAt: input.reviewSentAt,
    };
}
function normalizePartner(input) {
    // Historical partner rows can contain database nulls even though the
    // TypeScript model describes these fields as strings. Keep the shared
    // directory available and make incomplete records repairable in the UI
    // instead of failing the entire collection during normalization.
    const text = (value) => typeof value === 'string' ? value.trim() : '';
    return {
        id: text(input.id),
        name: text(input.name) || 'Unnamed partner',
        type: input.type || 'other',
        email: text(input.email),
        phone: text(input.phone) || undefined,
        company: text(input.company) || undefined,
        totalJobsReferred: input.totalJobsReferred ?? 0,
        totalIncentiveOwed: input.totalIncentiveOwed ?? 0,
        createdAt: text(input.createdAt),
    };
}
function hydratePartnerStats(partners, jobs) {
    return partners.map(partner => {
        const referredJobs = jobs.filter(job => job.referralPartnerId === partner.id);
        return {
            ...partner,
            totalJobsReferred: referredJobs.length,
            totalIncentiveOwed: referredJobs.filter(job => job.incentiveEarned && !job.incentivePaid).length,
        };
    });
}
function linksSentCount(jobs) {
    return jobs.filter(job => ACTIVE_JOB_STATUSES.includes(job.status)).length;
}
