"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const video_survey_1 = require("../../lib/video-survey");
(0, node_test_1.default)('only pre-call and live survey states can be joined', () => {
    strict_1.default.equal((0, video_survey_1.canJoinVideoSurvey)('ready'), true);
    strict_1.default.equal((0, video_survey_1.canJoinVideoSurvey)('waiting'), true);
    strict_1.default.equal((0, video_survey_1.canJoinVideoSurvey)('live'), true);
    strict_1.default.equal((0, video_survey_1.canJoinVideoSurvey)('recording_processing'), false);
    strict_1.default.equal((0, video_survey_1.canJoinVideoSurvey)('review_required'), false);
    strict_1.default.equal((0, video_survey_1.canJoinVideoSurvey)('confirmed'), false);
});
(0, node_test_1.default)('temporary customer exits remain resumable until explicitly finished', () => {
    strict_1.default.equal((0, video_survey_1.statusAfterVideoSurveyCustomerEvent)('live', 'customer.left', true), 'reconnecting');
    strict_1.default.equal((0, video_survey_1.statusAfterVideoSurveyCustomerEvent)('waiting', 'customer.reconnecting', false), 'reconnecting');
    strict_1.default.equal((0, video_survey_1.statusAfterVideoSurveyCustomerEvent)('reconnecting', 'customer.reconnected', true), 'live');
    strict_1.default.equal((0, video_survey_1.statusAfterVideoSurveyCustomerEvent)('reconnecting', 'customer.reconnected', false), 'waiting');
    strict_1.default.equal((0, video_survey_1.statusAfterVideoSurveyCustomerEvent)('recording_processing', 'customer.left', false), undefined);
});
(0, node_test_1.default)('presence metadata distinguishes joined participants from stale states', () => {
    const presence = (0, video_survey_1.videoSurveyPresence)({
        metadata: {
            presence: {
                customer: { state: 'joined', at: '2026-07-26T18:00:00.000Z' },
                representative: { state: 'left', at: '2026-07-26T18:02:00.000Z' },
            },
        },
    });
    strict_1.default.equal((0, video_survey_1.isVideoSurveyParticipantPresent)(presence.customer), true);
    strict_1.default.equal((0, video_survey_1.isVideoSurveyParticipantPresent)(presence.representative), false);
});
(0, node_test_1.default)('processing stages expose upload, AI, inventory, and human review progress', () => {
    const analyzing = (0, video_survey_1.videoSurveyProcessingStages)({
        sessionStatus: 'analyzing',
        recordingStatus: 'uploaded',
        analysisStage: 'analyzing_video',
        analysisProgress: 40,
    });
    strict_1.default.deepEqual(analyzing.map(stage => stage.state), [
        'complete',
        'complete',
        'active',
        'pending',
        'pending',
    ]);
    const review = (0, video_survey_1.videoSurveyProcessingStages)({
        sessionStatus: 'review_required',
        recordingStatus: 'uploaded',
        analysisStage: 'review_required',
        analysisProgress: 100,
    });
    strict_1.default.deepEqual(review.map(stage => stage.state), [
        'complete',
        'complete',
        'complete',
        'complete',
        'active',
    ]);
});
