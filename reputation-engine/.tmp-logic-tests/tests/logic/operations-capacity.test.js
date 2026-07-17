"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const operations_capacity_1 = require("../../lib/operations-capacity");
function makeJob(index, truckCount) {
    const lead = {
        id: `lead_${index}`,
        name: `Lead ${index}`,
        stage: 'booked',
        branch: 'windsor',
        moveDate: '2026-05-24',
        assignedCrew: ['c1', 'c2', 'c3'],
        createdAt: '2026-05-20',
        inventory: [],
        mediaAssets: [],
        callLogs: [],
    };
    const quote = {
        id: `quote_${index}`,
        number: `QT-${index}`,
        clientId: `client_${index}`,
        leadId: lead.id,
        moveDate: '2026-05-24',
        crewSize: 3,
        truckCount,
        status: 'accepted',
        lineItems: [],
        subtotal: 1000,
        hst: 130,
        total: 1130,
        deposit: 200,
        balance: 930,
        createdAt: '2026-05-20',
    };
    return { lead, quote };
}
const jobs = [
    makeJob(1, 2),
    makeJob(2, 2),
    makeJob(3, 2),
];
const snapshot = (0, operations_capacity_1.computeBranchCapacitySnapshot)(jobs, 'windsor', '2026-05-24');
strict_1.default.equal(snapshot.status, 'ready');
strict_1.default.equal(snapshot.trucksUsed, 6);
strict_1.default.equal(snapshot.truckCapacity, 5);
strict_1.default.equal(snapshot.risk, 'high');
const conflicts = (0, operations_capacity_1.listCapacityConflicts)(jobs);
strict_1.default.equal(conflicts.length, 1);
strict_1.default.equal(conflicts[0]?.truckOverage, 1);
const changedMoveDateJob = makeJob(4, 1);
changedMoveDateJob.lead.moveDate = '2026-05-25';
changedMoveDateJob.quote.moveDate = '2026-05-24';
const changedDateSnapshot = (0, operations_capacity_1.computeBranchCapacitySnapshot)([changedMoveDateJob], 'windsor', '2026-05-25');
strict_1.default.equal(changedDateSnapshot.jobsBooked, 1);
const staleQuoteDateSnapshot = (0, operations_capacity_1.computeBranchCapacitySnapshot)([changedMoveDateJob], 'windsor', '2026-05-24');
strict_1.default.equal(staleQuoteDateSnapshot.jobsBooked, 0);
