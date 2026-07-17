"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sales_1 = require("../../lib/sales");
(0, node_test_1.default)('buildSalesSummary separates active leads from total lead records', () => {
    const leads = [
        {
            id: 'lead_active',
            name: 'Active Lead',
            stage: 'new',
            createdAt: '2026-05-15',
            inventory: [],
            mediaAssets: [],
            callLogs: [],
        },
        {
            id: 'lead_booked',
            name: 'Booked Lead',
            stage: 'booked',
            createdAt: '2026-05-15',
            inventory: [],
            mediaAssets: [],
            callLogs: [],
        },
        {
            id: 'lead_lost',
            name: 'Lost Lead',
            stage: 'lost',
            createdAt: '2026-05-15',
            inventory: [],
            mediaAssets: [],
            callLogs: [],
        },
    ];
    const quotes = [];
    const summary = (0, sales_1.buildSalesSummary)(leads, quotes);
    strict_1.default.equal(summary.totalLeads, 3);
    strict_1.default.equal(summary.activeLeads, 1);
    strict_1.default.equal(summary.bookedLeads, 1);
});
