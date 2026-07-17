"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const crm_analytics_1 = require("../../lib/server/crm-analytics");
const leads = [
    {
        id: 'lead_a',
        name: 'Booked Lead',
        stage: 'booked',
        source: 'google_online_search',
        branch: 'windsor',
        assignedRepName: 'John',
        assignedRepUserId: 'rep_1',
        createdAt: '2026-05-01',
        bookedAt: '2026-05-04',
        firstResponseAt: '2026-05-01T12:00:00.000Z',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
    },
    {
        id: 'lead_b',
        name: 'Tentative Lead',
        stage: 'tentative',
        source: 'customer_referral',
        branch: 'windsor',
        assignedRepName: 'John',
        assignedRepUserId: 'rep_1',
        createdAt: '2026-05-03',
        firstResponseAt: '2026-05-05T12:00:00.000Z',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
    },
    {
        id: 'lead_c',
        name: 'Lost Lead',
        stage: 'lost',
        source: 'customer_referral',
        branch: 'windsor',
        assignedRepName: 'Mary',
        assignedRepUserId: 'rep_2',
        createdAt: '2026-05-02',
        lostAt: '2026-05-06',
        lostReason: 'price',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
    },
];
const quotes = [
    {
        id: 'quote_a',
        number: 'QT-A',
        clientId: 'client_a',
        leadId: 'lead_a',
        moveDate: '2026-05-24',
        crewSize: 3,
        truckCount: 1,
        status: 'accepted',
        lineItems: [],
        subtotal: 2000,
        hst: 260,
        total: 2260,
        deposit: 400,
        balance: 1860,
        createdAt: '2026-05-02',
        acceptedAt: '2026-05-04T15:00:00.000Z',
    },
];
const snapshot = (0, crm_analytics_1.buildCRMAnalyticsSnapshot)(leads, quotes, [], {
    range: 'month',
    dateFrom: '2026-05-01',
    dateTo: '2026-05-31',
});
strict_1.default.equal(snapshot.totals.leadsReceived, 3);
strict_1.default.equal(snapshot.totals.confirmedBookings, 1);
strict_1.default.equal(snapshot.totals.tentativeReservations, 1);
strict_1.default.equal(snapshot.totals.lostLeads, 1);
strict_1.default.equal(snapshot.totals.confirmedRevenue, 2260);
strict_1.default.equal(snapshot.totals.averageQuoteValue, 2260);
strict_1.default.equal(snapshot.totals.followUpComplianceRate, 50);
strict_1.default.equal(snapshot.lostReasons[0]?.reason, 'price');
strict_1.default.equal(snapshot.filters.repOptions.length, 2);
