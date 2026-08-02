"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCustomerEmotion = detectCustomerEmotion;
exports.deriveConversationStage = deriveConversationStage;
exports.roleForConversationStage = roleForConversationStage;
exports.questionTopic = questionTopic;
exports.countCustomerQuestions = countCustomerQuestions;
exports.evaluateConversationMessage = evaluateConversationMessage;
exports.nextConversationTopic = nextConversationTopic;
exports.buildConversationMemory = buildConversationMemory;
exports.conversationGuidance = conversationGuidance;
const TOPICS = [
    ['move_date', /\b(what|which).{0,20}\b(date|day)\b|\bwhen.{0,20}\bmove\b/i],
    ['pickup_address', /\b(pickup|origin).{0,25}\b(address|location)\b/i],
    ['dropoff_address', /\b(drop ?off|destination).{0,25}\b(address|location)\b/i],
    ['inventory', /\b(main items|furniture|inventory|what.{0,20}(moving|going with))\b/i],
    ['boxes', /\b(box|boxes|packing materials)\b/i],
    ['inventory_confirmation', /\b(staying behind|missing items|does that cover|all.{0,15}moving)\b/i],
    ['stairs', /\bstairs?\b/i],
    ['elevator', /\belevator\b/i],
    ['parking', /\b(parking|driveway|truck access|long carry)\b/i],
    ['packing_scope', /\b(pack everything|all rooms|specific items|packing yourself)\b/i],
    ['special_handling', /\b(fragile|oversized|disassembly|piano|safe)\b/i],
    ['delivery_channel', /\b(text or email|email or text|best email)\b/i],
    ['booking', /\b(hold|reserve|book|deposit)\b/i],
];
const ACKNOWLEDGMENT = /\b(thanks|thank you|got it|perfect|great|that helps|that'?s completely fine|understood|i have|i've got|no problem|no worries|makes sense)\b/i;
const REASSURANCE = /\b(no need|don't need|completely fine|most people|enough to start|solid starting point|i can help|we'll take it one step|so we can|that gives me|helps us)\b/i;
function detectCustomerEmotion(message) {
    const text = (message || '').trim().toLowerCase();
    if (!text)
        return 'calm';
    if (/\b(stop asking|already told|again\??|this is ridiculous|annoy|frustrat|stupid|wtf)\b/.test(text))
        return 'frustrated';
    if (/\b(overwhelm|too much|so many|confus|don't know where|no idea)\b/.test(text))
        return 'overwhelmed';
    if (/\b(can't give|don't know|not sure|unsure|maybe|i think|haven't.*yet)\b/.test(text))
        return 'uncertain';
    if (/\b(expensive|cheaper|budget|afford|price|cost|how much)\b/.test(text))
        return 'price_anxious';
    if (/\b(asap|urgent|today|tomorrow|last minute|running out of time)\b/.test(text))
        return 'time_pressured';
    if (/^(yes|yep|yeah|sure|perfect|great|okay|ok|let'?s do it|book it)\b/.test(text))
        return 'ready';
    return 'calm';
}
function deriveConversationStage(lead, missingFields = []) {
    if (lead.automationStatus === 'handoff')
        return 'human_handoff';
    if (lead.stage === 'booked' || lead.stage === 'completed')
        return 'booked_support';
    if (lead.stage === 'quoted')
        return 'booking';
    if (missingFields.includes('move_date') || missingFields.some(field => ['origin', 'destination', 'origin_address', 'destination_address'].includes(field))) {
        return missingFields.length >= 3 ? 'welcome' : 'route_date';
    }
    if (missingFields.includes('inventory_confirmation'))
        return 'inventory_confirmation';
    if (missingFields.includes('inventory')) {
        return lead.surveyRequestedAt && !lead.surveyCompletedAt ? 'photo_inventory' : 'inventory_discovery';
    }
    if (missingFields.includes('access'))
        return 'logistics';
    if (missingFields.includes('customer_email'))
        return 'estimate_preparation';
    return 'recommendation';
}
function roleForConversationStage(stage) {
    if (stage === 'booked_support')
        return 'operations_support';
    if (stage === 'booking')
        return 'booking_coordinator';
    if (stage === 'recommendation' || stage === 'estimate_preparation')
        return 'moving_expert';
    return 'moving_advisor';
}
function questionTopic(message) {
    const beforeQuestionMark = (message || '').split('?')[0] || '';
    const question = beforeQuestionMark.split(/[.!]\s*/).filter(Boolean).at(-1) || beforeQuestionMark;
    return TOPICS.find(([, pattern]) => pattern.test(question))?.[0];
}
function countCustomerQuestions(message) {
    const text = message || '';
    const marks = (text.match(/\?/g) || []).length;
    const imperative = /\b(reply with|please (send|text|confirm|provide)|tell me|choose one)\b/gi;
    const requests = (text.match(imperative) || []).length;
    return Math.max(marks, requests);
}
function evaluateConversationMessage(message, memory) {
    const questionCount = countCustomerQuestions(message);
    const topic = questionTopic(message);
    const repeatedQuestion = !!topic && !!memory?.questionsAsked?.includes(topic);
    const bundledQuestion = questionCount > 1 ||
        (/\b(stairs?|elevators?|parking)\b.*\b(stairs?|elevators?|parking)\b/i.test(message) &&
            new Set((message.match(/\b(stairs?|elevators?|parking)\b/gi) || []).map(value => value.toLowerCase())).size > 1) ||
        /\b(and|also)\b.{0,50}\?/i.test(message) && questionCount > 0;
    const violations = [
        ...(questionCount > 1 ? ['more_than_one_question'] : []),
        ...(bundledQuestion ? ['bundled_request'] : []),
        ...(repeatedQuestion ? ['repeated_question'] : []),
        ...(!ACKNOWLEDGMENT.test(message) ? ['missing_acknowledgment'] : []),
        ...(!REASSURANCE.test(message) ? ['missing_reassurance_or_value'] : []),
        ...(/\bjust checking in\b|\bfeel free\b|\bno pressure\b/i.test(message) ? ['passive_or_generic_language'] : []),
    ];
    return {
        score: Math.max(0, 100 - violations.length * 18),
        questionCount,
        hasAcknowledgment: ACKNOWLEDGMENT.test(message),
        hasReassuranceOrValue: REASSURANCE.test(message),
        repeatedQuestion,
        bundledQuestion,
        violations,
    };
}
function nextConversationTopic(missingFields, lead) {
    const first = missingFields[0];
    if (first === 'move_date')
        return 'move_date';
    if (first === 'origin' || first === 'origin_address')
        return 'pickup_address';
    if (first === 'destination' || first === 'destination_address')
        return 'dropoff_address';
    if (first === 'inventory_confirmation')
        return 'inventory_confirmation';
    if (first === 'inventory')
        return lead.moveType === 'packing' ? 'packing_scope' : 'inventory';
    if (first === 'customer_email')
        return 'delivery_channel';
    if (first === 'access') {
        const location = `${lead.originAddress || ''} ${lead.destAddress || ''} ${lead.propertyType || ''}`;
        if (/\b(apt|apartment|condo|unit|suite)\b/i.test(location))
            return 'elevator';
        return 'parking_exception';
    }
    return 'special_handling';
}
function buildConversationMemory(input) {
    const stage = deriveConversationStage(input.lead, input.missingFields);
    const emotion = detectCustomerEmotion(input.inboundMessage);
    const topic = questionTopic(input.outboundMessage);
    const previousQuestions = input.previous?.questionsAsked || [];
    const questionsAsked = topic ? [...previousQuestions, topic].slice(-12) : previousQuestions.slice(-12);
    const correction = /\b(no,?|actually|correction|i meant|not .* but)\b/i.test(input.inboundMessage || '')
        ? (input.inboundMessage || '').trim().slice(0, 240)
        : '';
    const promise = /\b(i'll|we'll|i will|we will)\b[^.?!]*/i.exec(input.outboundMessage || '')?.[0];
    return {
        stage,
        role: roleForConversationStage(stage),
        emotion,
        questionsAsked,
        factsAcknowledged: (input.previous?.factsAcknowledged || []).slice(-8),
        corrections: [...(input.previous?.corrections || []), ...(correction ? [correction] : [])].slice(-8),
        promises: [...(input.previous?.promises || []), ...(promise ? [promise] : [])].slice(-8),
        currentConcern: emotion === 'calm' || emotion === 'ready' ? undefined : emotion,
        nextQuestionTopic: nextConversationTopic(input.missingFields, input.lead),
        turnCount: Number(input.previous?.turnCount || 0) + (input.outboundMessage ? 1 : 0),
        updatedAt: input.now || new Date().toISOString(),
    };
}
function conversationGuidance(memory) {
    const emotionGuidance = {
        calm: 'Be warm, concise, and useful.',
        uncertain: 'Normalize uncertainty and explain why the information already supplied is enough to make progress.',
        overwhelmed: 'Slow down, simplify, and explicitly say you will handle this one step at a time.',
        price_anxious: 'Acknowledge budget sensitivity without discounting or forcing a close; explain what affects the estimate.',
        time_pressured: 'Create calm momentum: state what can be handled now and ask only the highest-value next question.',
        frustrated: 'Acknowledge the correction or frustration, do not defend the system, and do not repeat a question.',
        ready: 'Maintain momentum with one clear choice or next action.',
    };
    return `STAGE: ${memory.stage}
ROLE: ${memory.role}
CUSTOMER EMOTION: ${memory.emotion}
EMOTIONAL RESPONSE: ${emotionGuidance[memory.emotion]}
QUESTIONS ALREADY ASKED: ${memory.questionsAsked.join(', ') || 'none'}
CUSTOMER CORRECTIONS: ${memory.corrections.join(' | ') || 'none'}
PROMISES ALREADY MADE: ${memory.promises.join(' | ') || 'none'}
NEXT QUESTION TOPIC: ${memory.nextQuestionTopic || 'none'}
RESPONSE CONTRACT: acknowledge what the customer just said; add one useful interpretation, reassurance, or recommendation; ask at most one easy question.`;
}
