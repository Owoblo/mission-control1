import {
  appendPendingMessage,
  createPendingMessage,
  removePendingMessage,
} from '../src/message-state';

describe('Saturn Star mobile message state', () => {
  it('adds a trimmed outbound message immediately', () => {
    const pending = createPendingMessage(
      '  Thank you, Trudy.  ',
      new Date('2026-07-29T14:00:00.000Z'),
    );
    const messages = appendPendingMessage([], pending);
    expect(messages).toEqual([{
      id: 'pending-1785333600000',
      body: 'Thank you, Trudy.',
      direction: 'outbound',
      created_at: '2026-07-29T14:00:00.000Z',
    }]);
  });

  it('removes only the failed optimistic message before restoring its draft', () => {
    const existing = {
      id: 'real-1',
      body: 'Hello',
      direction: 'inbound' as const,
      created_at: '2026-07-29T13:59:00.000Z',
    };
    const pending = createPendingMessage('Reply', new Date('2026-07-29T14:00:00.000Z'));
    expect(removePendingMessage([existing, pending], pending.id)).toEqual([existing]);
  });
});
