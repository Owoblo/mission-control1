"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const video_survey_analysis_1 = require("../../lib/video-survey-analysis");
(0, node_test_1.default)('normalizes common moving inventory aliases', () => {
    strict_1.default.equal((0, video_survey_analysis_1.normalizeVideoInventoryLabel)('Grey Sectional Couch'), 'grey sofa');
    strict_1.default.equal((0, video_survey_analysis_1.normalizeVideoInventoryLabel)('Bedside Table'), 'nightstand');
    strict_1.default.equal((0, video_survey_analysis_1.normalizeVideoInventoryRoom)('Master Bedroom'), 'primary bedroom');
});
(0, node_test_1.default)('clusters repeated sightings in the same room and time window', () => {
    const clustered = (0, video_survey_analysis_1.clusterVideoInventoryCandidates)([
        { id: 'a', room: 'Living Room', itemName: 'Grey couch', quantity: 1, disposition: 'moving', confidence: 0.82, sourceKind: 'video', offsetMs: 10000 },
        { id: 'b', room: 'Family Room', itemName: 'Grey sofa', quantity: 1, disposition: 'moving', confidence: 0.88, sourceKind: 'snapshot', offsetMs: 28000 },
    ]);
    strict_1.default.equal(clustered.length, 1);
    strict_1.default.equal(clustered[0].quantity, 1);
    strict_1.default.ok(clustered[0].duplicateGroupId);
    strict_1.default.ok((clustered[0].duplicateConfidence || 0) >= 0.8);
});
(0, node_test_1.default)('does not merge same item after a distant room pass', () => {
    const clustered = (0, video_survey_analysis_1.clusterVideoInventoryCandidates)([
        { id: 'a', room: 'Bedroom', itemName: 'Nightstand', quantity: 1, disposition: 'moving', confidence: 0.8, sourceKind: 'video', offsetMs: 10000 },
        { id: 'b', room: 'Bedroom', itemName: 'Night stand', quantity: 1, disposition: 'moving', confidence: 0.8, sourceKind: 'video', offsetMs: 180000 },
    ], 60000);
    strict_1.default.equal(clustered.length, 2);
});
(0, node_test_1.default)('does not merge matching furniture from different numbered bedrooms', () => {
    const clustered = (0, video_survey_analysis_1.clusterVideoInventoryCandidates)([
        { id: 'a', room: 'Bedroom 1', itemName: 'Queen bed', quantity: 1, disposition: 'moving', confidence: 0.9, sourceKind: 'video', offsetMs: 10000 },
        { id: 'b', room: 'Bedroom 2', itemName: 'Queen bed', quantity: 1, disposition: 'moving', confidence: 0.9, sourceKind: 'video', offsetMs: 30000 },
    ]);
    strict_1.default.equal(clustered.length, 2);
    strict_1.default.equal((0, video_survey_analysis_1.normalizeVideoInventoryRoom)('Bedroom 2'), 'bedroom 2');
});
(0, node_test_1.default)('contradictory spoken and visual disposition requires review', () => {
    const reconciled = (0, video_survey_analysis_1.reconcileVideoInventorySources)({
        video: [
            { id: 'visual', room: 'Garage', itemName: 'Tool chest', quantity: 1, disposition: 'moving', confidence: 0.86, sourceKind: 'video', offsetMs: 5000 },
        ],
        transcript: [
            { id: 'spoken', room: 'Garage', itemName: 'Tool chest', quantity: 1, disposition: 'staying', confidence: 0.95, sourceKind: 'transcript', offsetMs: 6000 },
        ],
    });
    strict_1.default.equal(reconciled.length, 1);
    strict_1.default.equal(reconciled[0].disposition, 'uncertain');
});
