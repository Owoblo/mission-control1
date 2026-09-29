import {resolveSuggestedLine, sendConversationMessage, type Conversation} from '../src/api';
const conversation = {id: 'fixture', phone: '+15195550123', line: '+12267732993', workspace: 'sales'} as Conversation;
let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ok: true, json: async () => ({ok: true})});
  globalThis.fetch = fetchMock;
});
test('sales SMS asks the server for customer history instead of reusing the old Windsor thread', async () => {
  await sendConversationMessage('test-token', conversation, 'Fixture');
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.senderMode).toBe('customer_history');
  expect(payload.fromNumber).toBeUndefined();
});
test('an explicitly chosen company line remains a manual override', async () => {
  await sendConversationMessage('test-token', conversation, 'Fixture', [], '+12267806649');
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.fromNumber).toBe('+12267806649');
  expect(payload.senderMode).toBeUndefined();
});
test('unknown customer history fails visibly and never supplies a guessed line', async () => {
  fetchMock.mockResolvedValue({ok: false, status: 422, json: async () => ({error: 'Choose a company number.'})});
  await expect(resolveSuggestedLine('test-token', '+15195550123')).rejects.toThrow('Choose a company number.');
});
