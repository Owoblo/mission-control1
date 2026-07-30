export type CallPhase =
  | 'ready'
  | 'incoming'
  | 'dialing'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'consulting'
  | 'ended';

export type ConferenceSession = {
  conferenceName: string;
  customerCallSid: string;
  repCallSid: string;
  targetCallSid?: string | null;
};

export type CallState = {
  phase: CallPhase;
  displayName: string;
  phone: string;
  muted: boolean;
  speaker: boolean;
  held: boolean;
  connectedAt?: number;
  error?: string;
  conference?: ConferenceSession;
  conferenceMode?: 'private' | 'joined';
};

export const initialCallState: CallState = {
  phase: 'ready',
  displayName: '',
  phone: '',
  muted: false,
  speaker: false,
  held: false,
};

export type CallAction =
  | {type: 'INCOMING'; phone: string; displayName?: string}
  | {type: 'DIAL'; phone: string}
  | {type: 'RINGING'}
  | {type: 'CONNECTED'; phone?: string}
  | {type: 'RECONNECTING'}
  | {type: 'RECOVERED'}
  | {type: 'MUTE'; value: boolean}
  | {type: 'SPEAKER'; value: boolean}
  | {type: 'HOLD'; value: boolean}
  | {type: 'CONSULT'; conference: ConferenceSession}
  | {type: 'JOIN_CONFERENCE'}
  | {type: 'RETURN_TO_CUSTOMER'}
  | {type: 'ERROR'; message: string}
  | {type: 'END'};

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case 'INCOMING':
      return {
        ...initialCallState,
        phase: 'incoming',
        phone: action.phone,
        displayName: action.displayName || action.phone || 'Incoming call',
      };
    case 'DIAL':
      return {...initialCallState, phase: 'dialing', phone: action.phone};
    case 'RINGING':
      return {...state, phase: 'ringing'};
    case 'CONNECTED':
      return {
        ...state,
        phase: 'connected',
        phone: action.phone || state.phone,
        connectedAt: state.connectedAt || Date.now(),
        error: undefined,
      };
    case 'RECONNECTING':
      return {...state, phase: 'reconnecting'};
    case 'RECOVERED':
      return {...state, phase: 'connected', error: undefined};
    case 'MUTE':
      return {...state, muted: action.value};
    case 'SPEAKER':
      return {...state, speaker: action.value};
    case 'HOLD':
      return {...state, held: action.value};
    case 'CONSULT':
      return {
        ...state,
        phase: 'consulting',
        held: true,
        conference: action.conference,
        conferenceMode: 'private',
      };
    case 'JOIN_CONFERENCE':
      return {
        ...state,
        phase: 'consulting',
        held: false,
        conferenceMode: 'joined',
        error: undefined,
      };
    case 'RETURN_TO_CUSTOMER':
      return {
        ...state,
        phase: 'connected',
        held: false,
        conference: undefined,
        conferenceMode: undefined,
        error: undefined,
      };
    case 'ERROR':
      return {...state, error: action.message};
    case 'END':
      return {...initialCallState, phase: 'ended'};
    default:
      return state;
  }
}
