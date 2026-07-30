import type {ConversationMessage} from './api';

export function createPendingMessage(
  body: string,
  now = new Date(),
): ConversationMessage {
  return {
    id: `pending-${now.getTime()}`,
    body: body.trim(),
    direction: 'outbound',
    created_at: now.toISOString(),
  };
}

export function appendPendingMessage(
  messages: ConversationMessage[],
  pending: ConversationMessage,
) {
  return [...messages, pending];
}

export function removePendingMessage(
  messages: ConversationMessage[],
  pendingId: string,
) {
  return messages.filter(message => message.id !== pendingId);
}
