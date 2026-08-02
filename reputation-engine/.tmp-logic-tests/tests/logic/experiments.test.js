"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const experiments_1 = require("../../lib/experiments");
const variants = [{ id: 'control', weight: 50 }, { id: 'guided', weight: 50 }];
(0, node_test_1.default)('experiment assignment is stable for the same subject', () => {
    const first = (0, experiments_1.assignExperimentVariant)({ experimentKey: 'estimate-flow-v1', subjectId: 'lead-123', variants });
    const second = (0, experiments_1.assignExperimentVariant)({ experimentKey: 'estimate-flow-v1', subjectId: 'lead-123', variants });
    strict_1.default.equal(first, second);
});
(0, node_test_1.default)('experiment assignment rejects an empty experiment', () => {
    strict_1.default.throws(() => (0, experiments_1.assignExperimentVariant)({ experimentKey: 'empty', subjectId: 'lead', variants: [] }));
});
