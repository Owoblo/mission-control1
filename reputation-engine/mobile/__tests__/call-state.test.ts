import {
  callReducer,
  initialCallState,
  type ConferenceSession,
} from '../src/call-state';

describe('Saturn Star mobile call state', () => {
  it('moves an incoming call into a connected call without losing identity', () => {
    const incoming = callReducer(initialCallState, {
      type: 'INCOMING',
      phone: '+15195550100',
      displayName: 'Customer',
    });
    const connected = callReducer(incoming, {type: 'CONNECTED'});

    expect(connected.phase).toBe('connected');
    expect(connected.phone).toBe('+15195550100');
    expect(connected.displayName).toBe('Customer');
    expect(connected.connectedAt).toEqual(expect.any(Number));
  });

  it('preserves call identity during a private transfer consultation', () => {
    const connected = callReducer(
      {...initialCallState, phone: '+15195550100'},
      {type: 'CONNECTED'},
    );
    const conference: ConferenceSession = {
      conferenceName: 'saturn_transfer_CA123',
      customerCallSid: `CA${'1'.repeat(32)}`,
      repCallSid: `CA${'2'.repeat(32)}`,
      targetCallSid: `CA${'3'.repeat(32)}`,
    };
    const consulting = callReducer(connected, {type: 'CONSULT', conference});

    expect(consulting.phase).toBe('consulting');
    expect(consulting.held).toBe(true);
    expect(consulting.phone).toBe('+15195550100');
    expect(consulting.conference).toEqual(conference);
    expect(consulting.conferenceMode).toBe('private');

    const joined = callReducer(consulting, {type: 'JOIN_CONFERENCE'});
    expect(joined.phase).toBe('consulting');
    expect(joined.held).toBe(false);
    expect(joined.conferenceMode).toBe('joined');

    const returned = callReducer(joined, {type: 'RETURN_TO_CUSTOMER'});
    expect(returned.phase).toBe('connected');
    expect(returned.conference).toBeUndefined();
    expect(returned.conferenceMode).toBeUndefined();
  });

  it('clears sensitive active-call state after hangup', () => {
    const active = {
      ...initialCallState,
      phase: 'connected' as const,
      phone: '+15195550100',
      muted: true,
      held: true,
      connectedAt: Date.now(),
    };
    const ended = callReducer(active, {type: 'END'});

    expect(ended.phase).toBe('ended');
    expect(ended.phone).toBe('');
    expect(ended.muted).toBe(false);
    expect(ended.held).toBe(false);
    expect(ended.connectedAt).toBeUndefined();
  });

  it('represents connection recovery clearly', () => {
    const reconnecting = callReducer(
      {...initialCallState, phase: 'connected'},
      {type: 'RECONNECTING'},
    );
    expect(reconnecting.phase).toBe('reconnecting');
    expect(callReducer(reconnecting, {type: 'RECOVERED'}).phase).toBe(
      'connected',
    );
  });
});
