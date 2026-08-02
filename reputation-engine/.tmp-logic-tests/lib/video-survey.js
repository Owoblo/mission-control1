"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIDEO_SURVEY_TOKEN_TTL_MS = exports.VIDEO_SURVEY_CONSENT_VERSION = void 0;
exports.videoSurveyStatusLabel = videoSurveyStatusLabel;
exports.canJoinVideoSurvey = canJoinVideoSurvey;
exports.statusAfterVideoSurveyCustomerEvent = statusAfterVideoSurveyCustomerEvent;
exports.videoSurveyPresence = videoSurveyPresence;
exports.isVideoSurveyParticipantPresent = isVideoSurveyParticipantPresent;
exports.videoSurveyProcessingStages = videoSurveyProcessingStages;
exports.buildVideoSurveySms = buildVideoSurveySms;
exports.VIDEO_SURVEY_CONSENT_VERSION = '2026-07-24';
exports.VIDEO_SURVEY_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function videoSurveyStatusLabel(status) {
    const labels = {
        draft: 'Draft',
        ready: 'Invitation ready',
        waiting: 'Customer waiting',
        live: 'Walkthrough live',
        reconnecting: 'Reconnecting',
        completed: 'Call complete',
        recording_processing: 'Securing recording',
        analysis_pending: 'AI analysis queued',
        analyzing: 'Analyzing video & audio',
        review_required: 'Inventory ready for review',
        confirmed: 'Confirmed',
        cancelled: 'Cancelled',
        failed: 'Needs attention',
    };
    return labels[status];
}
function canJoinVideoSurvey(status) {
    return ['draft', 'ready', 'waiting', 'live', 'reconnecting'].includes(status);
}
function statusAfterVideoSurveyCustomerEvent(currentStatus, event, representativePresent) {
    if (!canJoinVideoSurvey(currentStatus))
        return undefined;
    if (event === 'customer.joined' || event === 'customer.reconnected') {
        return representativePresent ? 'live' : 'waiting';
    }
    if (event === 'customer.reconnecting' || event === 'customer.left') {
        return 'reconnecting';
    }
    return undefined;
}
function videoSurveyPresence(session) {
    const raw = session.metadata?.presence;
    if (!raw || typeof raw !== 'object')
        return { customer: null, representative: null };
    const presence = raw;
    return {
        customer: presence.customer || null,
        representative: presence.representative || null,
    };
}
function isVideoSurveyParticipantPresent(entry) {
    return entry?.state === 'joined';
}
function videoSurveyProcessingStages(input) {
    const recording = String(input.recordingStatus || '');
    const stage = String(input.analysisStage || '');
    const failed = input.sessionStatus === 'failed' || recording === 'failed' || stage === 'failed';
    const recordingDone = ['uploading', 'uploaded', 'verified', 'transcribed'].includes(recording);
    const uploadDone = ['uploaded', 'verified', 'transcribed'].includes(recording);
    const analysisStarted = ['analyzing_video', 'saving_evidence', 'review_required'].includes(stage) || input.sessionStatus === 'analyzing';
    const inventoryDone = stage === 'review_required' || input.sessionStatus === 'review_required' || input.sessionStatus === 'confirmed';
    const reviewDone = input.sessionStatus === 'confirmed';
    return [
        { key: 'recording', label: 'Recording saved', state: failed && !recordingDone ? 'failed' : recordingDone ? 'complete' : input.sessionStatus === 'recording_processing' ? 'active' : 'pending' },
        { key: 'upload', label: 'Video prepared', state: failed && recordingDone && !uploadDone ? 'failed' : uploadDone ? 'complete' : recordingDone ? 'active' : 'pending' },
        { key: 'video', label: 'Video & audio analyzed', state: failed && uploadDone && !inventoryDone ? 'failed' : inventoryDone ? 'complete' : analysisStarted ? 'active' : 'pending' },
        { key: 'inventory', label: 'Inventory draft prepared', state: failed && analysisStarted && !inventoryDone ? 'failed' : inventoryDone ? 'complete' : stage === 'saving_evidence' ? 'active' : 'pending' },
        { key: 'review', label: 'Human review confirmed', state: reviewDone ? 'complete' : inventoryDone ? 'active' : 'pending' },
    ];
}
function buildVideoSurveySms(input) {
    const firstName = input.firstName?.trim() || 'there';
    const time = input.scheduledAt
        ? ` ${new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(input.scheduledAt))}`
        : '';
    return [
        `Hi ${firstName}, your private Saturn Star video walkthrough${time ? ` is ready for${time}` : ' is ready'}.`,
        '',
        input.url,
        '',
        'Tap the link when you’re ready. No app needed.',
    ].join('\n');
}
