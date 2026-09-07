import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AudioDevice,
  Call,
  CallInvite,
  Voice,
} from '@twilio/voice-react-native-sdk';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  acceptNextQueuedCall,
  clearMobileCaches,
  controlConference,
  DirectoryEntry,
  loadDirectory,
  loadCallQueue,
  loadMe,
  loadMobileContacts,
  loadMobileCalls,
  loadPhoneLines,
  loadVoiceToken,
  logMobileCall,
  MobileContact,
  MobileCallLog,
  PhoneLine,
  peekMobileCalls,
  peekMobileContacts,
  postMobileEvent,
  postMobilePresence,
  prefetchPhoneTabs,
  resolveSuggestedLine,
  signIn,
  StaffUser,
} from './src/api';
import { MessagesScreen } from './src/messages-screen';
import { callReducer, initialCallState } from './src/call-state';
import { clearSession, readSession, saveSession } from './src/storage';
import { colors } from './src/theme';

const voice = new Voice();
// PushKit must be initialized at application launch so iOS can surface a VoIP
// push even when it relaunches the app from a terminated state.
let pushRegistryInitializationError: unknown = null;
const pushRegistryReady = Platform.OS === 'ios'
  ? voice.initializePushRegistry().catch(error => {
      // Attach the rejection handler immediately. Authentication can take long
      // enough that an early PushKit failure would otherwise become an
      // unhandled promise rejection before register() awaits this promise.
      pushRegistryInitializationError = error;
    })
  : Promise.resolve();
const TOKEN_REFRESH_MS = 45 * 60 * 1000;
const brandIcon = require('./src/assets/saturn-star-icon.png');
const CALL_DISPOSITIONS = [
  ['follow_up', 'Follow up'],
  ['quote_requested', 'Quote requested'],
  ['booked', 'Booked'],
  ['not_interested', 'Not interested'],
  ['wrong_number', 'Wrong number'],
  ['no_answer', 'No answer'],
  ['resolved', 'Resolved'],
] as const;

function friendlyError(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(
    2,
    '0',
  )}`;
}

function dateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDialTarget(value: string) {
  const clean = value.trim();
  const digits = clean.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return clean.startsWith('+') ? `+${digits}` : `+${digits}`;
}

function App() {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<StaffUser | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await readSession();
      if (!stored) {
        setBooting(false);
        return;
      }
      try {
        const session = await loadMe(stored);
        setToken(stored);
        setUser(session.user);
      } catch {
        await clearSession();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  if (booting) return <LaunchScreen />;
  if (!token || !user) {
    return (
      <LoginScreen
        onAuthenticated={async result => {
          await saveSession(result.token);
          setToken(result.token);
          setUser(result.user);
        }}
      />
    );
  }

  return (
    <PhoneScreen
      token={token}
      user={user}
      onSignOut={async () => {
        await clearSession();
        clearMobileCaches(token);
        setToken(null);
        setUser(null);
      }}
    />
  );
}

function LaunchScreen() {
  return (
    <View style={styles.launch}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <Image source={brandIcon} style={styles.logoMark} />
      <Text style={styles.launchTitle}>Saturn Star</Text>
      <Text style={styles.launchSubtitle}>Company phone</Text>
      <ActivityIndicator color={colors.gold} style={styles.launchSpinner} />
    </View>
  );
}

function LoginScreen({
  onAuthenticated,
}: {
  onAuthenticated: (result: { token: string; user: StaffUser }) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await signIn(email.trim(), password));
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.loginPage}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.ivory} />
      <SafeAreaView style={styles.loginSafe}>
        <View style={styles.loginBrand}>
          <Image
            source={brandIcon}
            style={[styles.logoMark, styles.loginLogo]}
          />
          <Text style={styles.loginTitle}>Saturn Star Phone</Text>
          <Text style={styles.loginCopy}>
            Your company line, customer context and call controls—together.
          </Text>
        </View>
        <View style={styles.loginCard}>
          <Text style={styles.fieldLabel}>WORK EMAIL (TEAM MEMBERS)</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@starmovers.ca"
            placeholderTextColor="#9AA2AE"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>PASSWORD</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder="Your CRM password"
            placeholderTextColor="#9AA2AE"
            style={styles.input}
          />
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !password}
            onPress={submit}
            style={({ pressed }) => [
              styles.primaryButton,
              (busy || !password) && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryButtonText}>Sign in securely</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function PhoneScreen({
  token,
  user,
  onSignOut,
}: {
  token: string;
  user: StaffUser;
  onSignOut: () => void;
}) {
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const [voiceToken, setVoiceToken] = useState('');
  const [voiceIdentity, setVoiceIdentity] = useState('');
  const [registered, setRegistered] = useState(false);
  const [number, setNumber] = useState('');
  const [dialName, setDialName] = useState('');
  const [note, setNote] = useState('');
  const [wrapUp, setWrapUp] = useState<null | {
    callSid?: string;
    phone: string;
    displayName?: string;
    direction: 'inbound' | 'outbound';
    durationSeconds: number;
    answered: boolean;
  }>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [queueSize, setQueueSize] = useState(0);
  const [acceptingQueue, setAcceptingQueue] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [status, setStatus] = useState('Connecting company line…');
  const [activeTab, setActiveTab] = useState<'phone' | 'recents' | 'messages' | 'contacts'>(
    'phone',
  );
  const [lines, setLines] = useState<PhoneLine[]>([]);
  const [selectedLine, setSelectedLine] = useState('');
  const [lineMode, setLineMode] = useState<'automatic' | 'manual'>('automatic');
  const callRef = useRef<Call | null>(null);
  const inviteRef = useRef<CallInvite | null>(null);
  const noteRef = useRef('');
  const connectedAtRef = useRef<number | null>(null);
  const callDirectionRef = useRef<'inbound' | 'outbound'>('outbound');
  const internalCallRef = useRef(false);
  const callDisplayNameRef = useRef('');
  const loggedCallSidsRef = useRef(new Set<string>());
  const registrationPromiseRef = useRef<Promise<void> | null>(null);
  const presenceSessionIdRef = useRef(
    `ios-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    noteRef.current = note;
  }, [note]);

  useEffect(() => {
    callDisplayNameRef.current = state.displayName;
  }, [state.displayName]);

  useEffect(() => {
    // Voice registration always wins the startup race. Warm secondary tabs
    // only after the phone is ready to receive calls.
    if (!registered) return;
    const timer = setTimeout(() => {
      prefetchPhoneTabs(
        token,
        user.role === 'owner' || user.role === 'partnership_manager',
      ).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [registered, token, user.role]);

  useEffect(() => {
    if (!registered) return;
    let cancelled = false;
    const refreshDirectory = () =>
      loadDirectory(token)
        .then(result => {
          if (!cancelled) setDirectory(result.entries);
        })
        .catch(() => undefined);
    refreshDirectory();
    const timer = setInterval(refreshDirectory, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [registered, token]);

  const persistCall = useCallback(
    async (call: Call, fallbackPhone = '') => {
      const internalAddress = [call.getFrom(), call.getTo(), fallbackPhone]
        .some(value => String(value || '').toLowerCase().startsWith('client:saturn-rep-'));
      if (internalCallRef.current || internalAddress) {
        internalCallRef.current = false;
        connectedAtRef.current = null;
        setNote('');
        return;
      }
      const sid = call.getSid() || '';
      const dedupeKey =
        sid ||
        `${callDirectionRef.current}:${fallbackPhone}:${
          connectedAtRef.current || 0
        }`;
      if (loggedCallSidsRef.current.has(dedupeKey)) return;
      loggedCallSidsRef.current.add(dedupeKey);
      const connectedAt = connectedAtRef.current;
      const durationSeconds = connectedAt
        ? Math.max(0, Math.floor((Date.now() - connectedAt) / 1000))
        : 0;
      const phone = call.getFrom() || call.getTo() || fallbackPhone;
      try {
        await logMobileCall(token, {
          phone,
          direction: callDirectionRef.current,
          durationSeconds,
          callSid: sid || undefined,
          // The selected pill is only authoritative for an outbound call. For
          // inbound calls Twilio's signed callback records the actual number
          // that the customer dialled.
          branchNumber:
            callDirectionRef.current === 'outbound'
              ? selectedLine || undefined
              : undefined,
          notes: noteRef.current.trim() || undefined,
          answered: Boolean(connectedAt),
        });
        setWrapUp({
          callSid: sid || undefined,
          phone,
          displayName: callDisplayNameRef.current || undefined,
          direction: callDirectionRef.current,
          durationSeconds,
          answered: Boolean(connectedAt),
        });
        setNote('');
      } catch (error) {
        setStatus(`Call saved without notes: ${friendlyError(error)}`);
      } finally {
        connectedAtRef.current = null;
      }
    },
    [selectedLine, token],
  );

  const register = useCallback(async () => {
    if (registrationPromiseRef.current) {
      return registrationPromiseRef.current;
    }

    const registration = (async () => {
      const emitRegistration = (
        event: 'device_registering' | 'device_registered' | 'token_refresh_failed',
        extra?: Record<string, unknown>,
      ) => postMobileEvent(token, {
        event,
        timestamp: new Date().toISOString(),
        sessionId: presenceSessionIdRef.current,
        identity: null,
        deviceState: 'registering',
        platform: 'mobile',
        os: `iOS ${Platform.Version}`,
        online: true,
        extra,
      }).catch(() => undefined);
      emitRegistration('device_registering');
      if (Platform.OS === 'android') {
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        if (Number(Platform.Version) >= 33) {
          permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        }
        const results = await PermissionsAndroid.requestMultiple(permissions);
        if (
          results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !==
          PermissionsAndroid.RESULTS.GRANTED
        ) {
          throw new Error('Microphone access is required for company calls');
        }
      }
      const [result, lineResult] = await Promise.all([
        loadVoiceToken(token),
        loadPhoneLines(token),
      ]);
      setVoiceToken(result.token);
      setVoiceIdentity(result.identity);
      setLines(lineResult.lines);
      setSelectedLine(current =>
        current && lineResult.lines.some(line => line.number === current)
          ? current
          : lineResult.lines[0]?.number || '',
      );
      await pushRegistryReady;
      if (pushRegistryInitializationError) {
        throw pushRegistryInitializationError;
      }
      await voice.setIncomingCallContactHandleTemplate(
        'Saturn Star • ${DisplayName}',
      );
      if (!result.pushConfigured) {
        throw new Error('Production incoming-call push is not configured');
      }
      // Keep the existing APNs binding alive across ordinary launches. Twilio
      // push registrations remain valid for up to a year and should only be
      // unregistered when a user intentionally changes identity.
      await voice.register(result.token);
      dispatch({ type: 'CLEAR_ERROR' });
      setRegistered(true);
      setStatus('Ready for company calls');
      postMobileEvent(token, {
        event: 'device_registered',
        timestamp: new Date().toISOString(),
        sessionId: presenceSessionIdRef.current,
        identity: result.identity,
        deviceState: 'ready',
        platform: 'mobile',
        os: `iOS ${Platform.Version}`,
        online: true,
        extra: { pushConfigured: result.pushConfigured },
      }).catch(() => undefined);
    })();

    registrationPromiseRef.current = registration;
    try {
      await registration;
    } catch (error) {
      postMobileEvent(token, {
        event: 'token_refresh_failed',
        timestamp: new Date().toISOString(),
        sessionId: presenceSessionIdRef.current,
        identity: null,
        deviceState: 'registration_failed',
        errorMessage: friendlyError(error),
        platform: 'mobile',
        os: `iOS ${Platform.Version}`,
        online: true,
      }).catch(() => undefined);
      throw error;
    } finally {
      if (registrationPromiseRef.current === registration) {
        registrationPromiseRef.current = null;
      }
    }
  }, [token]);

  const attachCall = useCallback(
    (call: Call, fallbackPhone = '') => {
      callRef.current = call;
      const phone = call.getFrom() || call.getTo() || fallbackPhone;
      call.on(Call.Event.Ringing, () => dispatch({ type: 'RINGING' }));
      call.on(Call.Event.Connected, () => {
        connectedAtRef.current = Date.now();
        dispatch({ type: 'CONNECTED', phone });
      });
      call.on(Call.Event.Reconnecting, () =>
        dispatch({ type: 'RECONNECTING' }),
      );
      call.on(Call.Event.Reconnected, () => dispatch({ type: 'RECOVERED' }));
      call.on(Call.Event.ConnectFailure, error =>
        dispatch({ type: 'ERROR', message: friendlyError(error) }),
      );
      call.on(Call.Event.Disconnected, error => {
        persistCall(call, phone).catch(() => undefined);
        callRef.current = null;
        if (error) dispatch({ type: 'ERROR', message: friendlyError(error) });
        dispatch({ type: 'END' });
      });
    },
    [persistCall],
  );

  useEffect(() => {
    if (lineMode !== 'automatic') return;
    const target = normalizeDialTarget(number);
    if (target.replace(/\D/g, '').length < 10) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      resolveSuggestedLine(token, target)
        .then(result => {
          if (
            !cancelled &&
            lines.some(line => line.number === result.line.number)
          ) {
            setSelectedLine(result.line.number);
          }
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lineMode, lines, number, token]);

  useEffect(() => {
    const onInvite = (invite: CallInvite) => {
      // Snapshot native-backed invite values while the invite is valid. A
      // cancellation releases the native invite, so its getters must not be
      // called from the Cancelled handler afterward.
      const callSid = invite.getCallSid();
      const from = invite.getFrom();
      const parameters = invite.getCustomParameters();
      const displayName =
        parameters.DisplayName || parameters.CustomerName || from;
      internalCallRef.current = parameters.CallType === 'internal';
      callDirectionRef.current = 'inbound';
      inviteRef.current = invite;
      postMobileEvent(token, {
        event: 'incoming_call_received',
        timestamp: new Date().toISOString(),
        sessionId: presenceSessionIdRef.current,
        identity: voiceIdentity || null,
        callSid,
        callDirection: 'inbound',
        phoneNumber: from,
        deviceState: AppState.currentState,
        platform: 'mobile',
        os: `iOS ${Platform.Version}`,
        online: true,
      }).catch(() => undefined);
      dispatch({
        type: 'INCOMING',
        phone: from,
        displayName,
      });
      invite.on(CallInvite.Event.Cancelled, () => {
        postMobileEvent(token, {
          event: 'call_cancelled',
          timestamp: new Date().toISOString(),
          sessionId: presenceSessionIdRef.current,
          identity: voiceIdentity || null,
          callSid,
          callDirection: 'inbound',
          phoneNumber: from,
          deviceState: AppState.currentState,
          platform: 'mobile',
          os: `iOS ${Platform.Version}`,
          online: true,
        }).catch(() => undefined);
        inviteRef.current = null;
        dispatch({ type: 'END' });
      });
      invite.on(CallInvite.Event.Accepted, call => {
        inviteRef.current = null;
        attachCall(call, from);
      });
    };
    const onVoiceError = (error: unknown) => {
      if (/registration in progress/i.test(friendlyError(error))) return;
      setStatus('Company line needs attention');
      dispatch({ type: 'ERROR', message: friendlyError(error) });
    };
    const onRegistered = () => {
      dispatch({ type: 'CLEAR_ERROR' });
      setRegistered(true);
      setStatus('Ready for company calls');
    };
    const onUnregistered = () => setRegistered(false);
    voice.on(Voice.Event.CallInvite, onInvite);
    voice.on(Voice.Event.Registered, onRegistered);
    voice.on(Voice.Event.Unregistered, onUnregistered);
    voice.on(Voice.Event.Error, onVoiceError);
    register().catch(onVoiceError);
    const refresh = setInterval(
      () => register().catch(onVoiceError),
      TOKEN_REFRESH_MS,
    );
    const appSubscription = AppState.addEventListener('change', next => {
      if (next === 'active') register().catch(onVoiceError);
    });
    return () => {
      clearInterval(refresh);
      appSubscription.remove();
      voice.removeListener(Voice.Event.CallInvite, onInvite);
      voice.removeListener(Voice.Event.Registered, onRegistered);
      voice.removeListener(Voice.Event.Unregistered, onUnregistered);
      voice.removeListener(Voice.Event.Error, onVoiceError);
    };
  }, [attachCall, register, token, voiceIdentity]);

  useEffect(() => {
    if (!voiceIdentity) return;
    const presenceState = !registered
      ? 'registering'
      : state.phase === 'incoming'
      ? 'incoming'
      : ['dialing', 'ringing', 'connected', 'reconnecting', 'consulting'].includes(
          state.phase,
        )
      ? 'busy'
      : 'ready';
    const send = () =>
      postMobilePresence(token, {
        state: presenceState,
        timestamp: new Date().toISOString(),
        sessionId: presenceSessionIdRef.current,
        identity: voiceIdentity,
        deviceState: registered ? state.phase : 'registering',
        platform: 'mobile',
        os: `iOS ${Platform.Version}`,
        online: true,
      }).catch(() => undefined);
    send();
    const timer = setInterval(send, 30_000);
    return () => clearInterval(timer);
  }, [registered, state.phase, token, voiceIdentity]);

  useEffect(() => {
    if (!state.connectedAt) {
      setSeconds(0);
      return;
    }
    const update = () =>
      setSeconds(
        Math.max(0, Math.floor((Date.now() - state.connectedAt!) / 1000)),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [state.connectedAt]);

  const isActive = [
    'dialing',
    'ringing',
    'connected',
    'reconnecting',
    'consulting',
  ].includes(state.phase);

  useEffect(() => {
    if (!registered || isActive || state.phase === 'incoming') return;
    let cancelled = false;
    const refreshQueue = () =>
      loadCallQueue(token)
        .then(result => {
          if (!cancelled) setQueueSize(result.size);
        })
        .catch(() => undefined);
    refreshQueue();
    const timer = setInterval(refreshQueue, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isActive, registered, state.phase, token]);

  async function placeCall() {
    const target = normalizeDialTarget(number);
    if (!target || !voiceToken) return;
    setBusy(true);
    callDirectionRef.current = 'outbound';
    internalCallRef.current = false;
    connectedAtRef.current = null;
    setNote('');
    dispatch({ type: 'DIAL', phone: target, displayName: dialName });
    try {
      const call = await voice.connect(voiceToken, {
        params: {
          To: target,
          ...(lineMode === 'manual' && selectedLine
            ? { PreferredFromNumber: selectedLine }
            : {}),
        },
        contactHandle: target,
        notificationDisplayName: dialName || 'Saturn Star call',
      });
      attachCall(call, target);
    } catch (error) {
      dispatch({ type: 'ERROR', message: friendlyError(error) });
      dispatch({ type: 'END' });
    } finally {
      setBusy(false);
    }
  }

  async function placeInternalCall(entry: DirectoryEntry) {
    if (!voiceToken || entry.status === 'busy') return;
    setBusy(true);
    callDirectionRef.current = 'outbound';
    internalCallRef.current = true;
    connectedAtRef.current = null;
    setNote('');
    dispatch({ type: 'DIAL', phone: entry.target, displayName: entry.label });
    try {
      const call = await voice.connect(voiceToken, {
        params: {
          To: entry.target,
          InternalCallerName: user.name,
        },
        contactHandle: entry.target,
        notificationDisplayName: entry.label,
      });
      attachCall(call, entry.target);
    } catch (error) {
      internalCallRef.current = false;
      dispatch({ type: 'ERROR', message: friendlyError(error) });
      dispatch({ type: 'END' });
    } finally {
      setBusy(false);
    }
  }

  async function acceptQueuedCall() {
    if (!voiceIdentity || acceptingQueue) return;
    setAcceptingQueue(true);
    try {
      const result = await acceptNextQueuedCall(token, voiceIdentity);
      if (!result.ok) throw new Error(result.message || 'The caller is no longer waiting');
      setQueueSize(current => Math.max(0, current - 1));
      setStatus('Connecting the next waiting caller…');
    } catch (error) {
      setStatus(friendlyError(error));
      loadCallQueue(token).then(result => setQueueSize(result.size)).catch(() => undefined);
    } finally {
      setAcceptingQueue(false);
    }
  }

  async function answer() {
    if (!inviteRef.current) return;
    setBusy(true);
    try {
      await inviteRef.current.accept();
    } catch (error) {
      dispatch({ type: 'ERROR', message: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function hangUp() {
    if (inviteRef.current) {
      await inviteRef.current.reject().catch(() => undefined);
      inviteRef.current = null;
    }
    const activeCall = callRef.current;
    if (activeCall) await persistCall(activeCall, state.phone);
    await activeCall?.disconnect().catch(() => undefined);
    callRef.current = null;
    dispatch({ type: 'END' });
  }

  async function toggleMute() {
    const value = !state.muted;
    await callRef.current?.mute(value);
    dispatch({ type: 'MUTE', value });
  }

  async function toggleSpeaker() {
    const next = !state.speaker;
    const { audioDevices } = await voice.getAudioDevices();
    const desired = audioDevices.find(
      device =>
        device.type ===
        (next ? AudioDevice.Type.Speaker : AudioDevice.Type.Earpiece),
    );
    if (desired) await desired.select();
    else if (Platform.OS === 'ios') await voice.showAvRoutePickerView();
    dispatch({ type: 'SPEAKER', value: next });
  }

  async function toggleHold() {
    const value = !state.held;
    await callRef.current?.hold(value);
    dispatch({ type: 'HOLD', value });
  }

  async function openTransfer() {
    setBusy(true);
    try {
      const result = await loadDirectory(token);
      setDirectory(result.entries);
      setShowTransfer(true);
    } catch (error) {
      dispatch({ type: 'ERROR', message: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function beginConsult(entry: DirectoryEntry) {
    const sid = callRef.current?.getSid();
    if (!sid) {
      dispatch({
        type: 'ERROR',
        message: 'The active call is not ready to transfer yet.',
      });
      return;
    }
    setBusy(true);
    try {
      const result = await controlConference(token, {
        action: 'start',
        activeCallSid: sid,
        addTarget: entry.target,
      });
      if (
        !result.conferenceName ||
        !result.customerCallSid ||
        !result.repCallSid
      ) {
        throw new Error('Transfer room did not initialize correctly');
      }
      dispatch({
        type: 'CONSULT',
        conference: {
          conferenceName: result.conferenceName,
          customerCallSid: result.customerCallSid,
          repCallSid: result.repCallSid,
          targetCallSid: result.targetCallSid,
        },
      });
      setShowTransfer(false);
    } catch (error) {
      dispatch({ type: 'ERROR', message: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function conferenceAction(action: 'join' | 'complete' | 'return') {
    const session = state.conference;
    if (!session) return;
    setBusy(true);
    try {
      await controlConference(token, { action, ...session });
      if (action === 'complete') {
        callRef.current = null;
        dispatch({ type: 'END' });
      } else if (action === 'join') {
        dispatch({ type: 'JOIN_CONFERENCE' });
      } else {
        dispatch({ type: 'RETURN_TO_CUSTOMER' });
      }
    } catch (error) {
      dispatch({ type: 'ERROR', message: friendlyError(error) });
    } finally {
      setBusy(false);
    }
  }

  if (state.phase === 'incoming') {
    return (
      <IncomingCallScreen
        state={state}
        busy={busy}
        onAnswer={answer}
        onDecline={hangUp}
      />
    );
  }

  if (wrapUp) {
    return (
      <CallWrapUpScreen
        call={wrapUp}
        token={token}
        onDone={() => setWrapUp(null)}
      />
    );
  }

  if (isActive) {
    return (
      <ActiveCallScreen
        state={state}
        duration={formatDuration(seconds)}
        note={note}
        setNote={setNote}
        busy={busy}
        showKeypad={showKeypad}
        setShowKeypad={setShowKeypad}
        onDigit={digit => callRef.current?.sendDigits(digit)}
        onMute={toggleMute}
        onSpeaker={toggleSpeaker}
        onHold={toggleHold}
        onTransfer={openTransfer}
        onHangUp={hangUp}
        onConferenceAction={conferenceAction}
        transferModal={
          <TransferModal
            visible={showTransfer}
            entries={directory}
            onClose={() => setShowTransfer(false)}
            onSelect={beginConsult}
          />
        }
      />
    );
  }

  if (activeTab === 'messages') {
    return (
      <View style={styles.page}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <MessagesScreen
          token={token}
          canAccessPartnership={
            user.role === 'owner' || user.role === 'partnership_manager'
          }
          onOpenDialer={(phone, line) => {
            if (phone) setNumber(phone);
            setDialName('');
            if (line && lines.some(item => item.number === line)) {
              setSelectedLine(line);
              setLineMode('manual');
            } else {
              setLineMode('automatic');
            }
            setActiveTab('phone');
          }}
        />
        <BottomNavigation active={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  if (activeTab === 'recents') {
    return (
      <View style={styles.page}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <RecentsScreen
          token={token}
          onCall={(phone, name) => {
            setNumber(phone);
            setDialName(name);
            setLineMode('automatic');
            setActiveTab('phone');
          }}
        />
        <BottomNavigation active={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  if (activeTab === 'contacts') {
    return (
      <View style={styles.page}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <ContactsScreen
          token={token}
          onCall={(phone, name, line) => {
            setNumber(phone);
            setDialName(name);
            if (line) {
              setSelectedLine(line);
              setLineMode('manual');
            } else {
              setLineMode('automatic');
            }
            setActiveTab('phone');
          }}
        />
        <BottomNavigation active={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.ivory} />
      <View style={styles.homeHeader}>
        <View>
          <Text style={styles.eyebrow}>SATURN STAR PHONE</Text>
          <Text style={styles.homeTitle}>
            Good day, {user.name.split(' ')[0]}
          </Text>
        </View>
        <Pressable onPress={onSignOut} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.homeContent}>
        <View style={styles.statusCard}>
          <View style={[styles.statusDot, registered && styles.statusDotOn]} />
          <View style={styles.flex}>
            <Text style={styles.statusTitle}>{status}</Text>
            <Text style={styles.statusCopy}>
              {registered
                ? 'Incoming calls can ring this phone, even when the app is in the background.'
                : 'Reconnecting securely to the company line.'}
            </Text>
          </View>
        </View>
        {queueSize > 0 && (
          <View style={styles.queueCard}>
            <View style={styles.flex}>
              <Text style={styles.queueTitle}>
                {queueSize} {queueSize === 1 ? 'caller' : 'callers'} waiting
              </Text>
              <Text style={styles.queueCopy}>Take the longest-waiting company call.</Text>
            </View>
            <Pressable
              disabled={acceptingQueue}
              onPress={acceptQueuedCall}
              style={[styles.queueButton, acceptingQueue && styles.buttonDisabled]}
            >
              {acceptingQueue ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.queueButtonText}>Take next</Text>
              )}
            </Pressable>
          </View>
        )}
        {directory.some(entry => entry.kind !== 'sip') && (
          <>
            <Text style={styles.sectionLabel}>TEAM LINE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.teamLineRow}
            >
              {directory
                .filter(entry => entry.kind !== 'sip')
                .map(entry => (
                  <Pressable
                    key={entry.id}
                    disabled={busy || entry.status === 'busy'}
                    onPress={() => placeInternalCall(entry)}
                    style={({ pressed }) => [
                      styles.teamLineCard,
                      entry.status === 'busy' && styles.directoryRowBusy,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.teamLineAvatar}>
                      <Text style={styles.directoryInitial}>
                        {entry.label[0]?.toUpperCase() || '?'}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={styles.teamLineName}>
                      {entry.label}
                    </Text>
                    <Text style={[
                      styles.teamLineStatus,
                      entry.status === 'available' && styles.teamLineStatusReady,
                    ]}>
                      {entry.status === 'available'
                        ? 'Available'
                        : entry.status === 'busy'
                        ? 'On a call'
                        : 'Call anyway'}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </>
        )}
        <Text style={styles.sectionLabel}>NEW CALL</Text>
        <View style={styles.dialCard}>
          {lines.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.callerIdRow}
            >
              <Pressable
                onPress={() => setLineMode('automatic')}
                style={[
                  styles.callerIdPill,
                  lineMode === 'automatic' && styles.callerIdPillSelected,
                ]}
              >
                <Text
                  style={[
                    styles.callerIdLabel,
                    lineMode === 'automatic' && styles.callerIdLabelSelected,
                  ]}
                >
                  Auto ·{' '}
                  {lines.find(line => line.number === selectedLine)?.label ||
                    'Closest'}
                </Text>
              </Pressable>
              {lines.map(line => (
                <Pressable
                  key={line.number}
                  onPress={() => {
                    setSelectedLine(line.number);
                    setLineMode('manual');
                  }}
                  style={[
                    styles.callerIdPill,
                    lineMode === 'manual' &&
                      selectedLine === line.number &&
                      styles.callerIdPillSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.callerIdLabel,
                      lineMode === 'manual' &&
                        selectedLine === line.number &&
                        styles.callerIdLabelSelected,
                    ]}
                  >
                    {line.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <View style={styles.numberEntryRow}>
            <TextInput
              value={number}
              onChangeText={value => {
                setNumber(value);
                setDialName('');
              }}
              keyboardType="phone-pad"
              placeholder="Name or phone number"
              placeholderTextColor="#8A94A3"
              style={styles.numberInput}
            />
            {!!number && (
              <Pressable
                accessibilityLabel="Delete last digit"
                accessibilityHint="Press and hold to clear the number"
                onPress={() => {
                  setNumber(current => current.slice(0, -1));
                  setDialName('');
                }}
                onLongPress={() => {
                  setNumber('');
                  setDialName('');
                }}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.backspaceButton,
                  pressed && styles.keyPressed,
                ]}
              >
                <Icon name="backspace-outline" size={27} color={colors.muted} />
              </Pressable>
            )}
          </View>
          <Keypad
            onDigit={digit => {
              setNumber(current => `${current}${digit}`);
              setDialName('');
            }}
          />
          {!!state.error && <Text style={styles.errorText}>{state.error}</Text>}
          <Pressable
            disabled={!registered || !normalizeDialTarget(number) || busy}
            onPress={placeCall}
            style={({ pressed }) => [
              styles.callButton,
              (!registered || !normalizeDialTarget(number) || busy) &&
                styles.buttonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.callButtonText}>
              Call from {lineMode === 'automatic' ? 'Auto · ' : ''}
              {lines.find(line => line.number === selectedLine)?.label ||
                'Saturn Star'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.promiseCard}>
          <Text style={styles.promiseTitle}>
            One company line. Full context.
          </Text>
          <Text style={styles.promiseCopy}>
            Calls, recordings and transfers remain attached to Saturn Star—not a
            rep’s personal phone.
          </Text>
        </View>
      </ScrollView>
      <BottomNavigation active={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}

function ContactsScreen({
  token,
  onCall,
}: {
  token: string;
  onCall: (phone: string, name: string, line?: string) => void;
}) {
  const cachedContacts = peekMobileContacts(token);
  const [entries, setEntries] = useState<MobileContact[]>(
    cachedContacts?.contacts || [],
  );
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(!cachedContacts);
  const [selectedContact, setSelectedContact] = useState<MobileContact | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        const cached = peekMobileContacts(token, query);
        if (cached) {
          setEntries(cached.contacts);
          setLoading(false);
        } else {
          setLoading(true);
        }
        loadMobileContacts(token, query)
          .then(result => {
            if (!cancelled) setEntries(result.contacts);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, token]);

  if (selectedContact) {
    return (
      <SafeAreaView style={styles.contactsPage}>
        <View style={styles.contactDetailHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to contacts" onPress={() => setSelectedContact(null)} style={styles.contactDetailBack}>
            <Icon name="chevron-back" size={24} color={colors.navy} />
            <Text style={styles.contactDetailBackText}>Contacts</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.contactDetailContent}>
          <View style={styles.contactDetailAvatar}>
            <Text style={styles.contactDetailAvatarText}>{selectedContact.name[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.contactDetailName}>{selectedContact.name}</Text>
          <Text style={styles.contactDetailStage}>{selectedContact.stage.replaceAll('_', ' ')}</Text>
          <Pressable accessibilityRole="button" onPress={() => onCall(selectedContact.phone, selectedContact.name)} style={styles.contactDetailCall}>
            <Icon name="call" size={21} color="white" />
            <Text style={styles.contactDetailCallText}>Call customer</Text>
          </Pressable>
          <View style={styles.contactDetailCard}>
            {[
              ['Phone', selectedContact.phone],
              ['Email', selectedContact.email],
              ['Move', selectedContact.route],
              ['Move date', selectedContact.moveDate],
              ['Estimate', selectedContact.quoteStatus],
              ['Next action', selectedContact.nextAction],
              ['Assigned to', selectedContact.assignedRep],
              ['Market', selectedContact.branch],
            ].filter(([, value]) => value).map(([label, value]) => (
              <View key={label} style={styles.contactDetailRow}>
                <Text style={styles.contactDetailLabel}>{label}</Text>
                <Text style={styles.contactDetailValue}>{value}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.contactsPage}>
      <View style={styles.contactsHeader}>
        <Text style={styles.contactsTitle}>Contacts</Text>
      </View>
      <View style={styles.contactSearch}>
        <Icon name="search" size={18} color="#8E8E93" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search customers"
          placeholderTextColor="#8E8E93"
          clearButtonMode="while-editing"
          style={styles.contactSearchInput}
        />
      </View>
      {loading ? (
        <View accessibilityRole="progressbar" accessibilityLabel="Loading contacts">
          {[0, 1, 2, 3, 4, 5].map(item => (
            <View key={item} style={styles.contactRow}>
              <View style={styles.contactSkeletonAvatar} />
              <View style={styles.flex}>
                <View style={styles.contactSkeletonTitle} />
                <View style={styles.contactSkeletonCopy} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <ScrollView>
          {entries.map(entry => (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${entry.name}`}
              onPress={() => setSelectedContact(entry)}
              style={styles.contactRow}
            >
              <View style={styles.contactAvatar}>
                <Text style={styles.contactAvatarText}>
                  {entry.name[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.contactName}>{entry.name}</Text>
                <Text style={styles.contactMeta}>
                  {[
                    entry.route,
                    entry.moveDate,
                    entry.stage.replaceAll('_', ' '),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View style={styles.contactCall}>
                <Icon name="chevron-forward" size={18} color="#8E8E93" />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function CallWrapUpScreen({
  call,
  token,
  onDone,
}: {
  call: {
    callSid?: string;
    phone: string;
    displayName?: string;
    direction: 'inbound' | 'outbound';
    durationSeconds: number;
    answered: boolean;
  };
  token: string;
  onDone: () => void;
}) {
  const [disposition, setDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDelay, setFollowUpDelay] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!disposition) return;
    setSaving(true);
    setError('');
    try {
      await logMobileCall(token, {
        ...call,
        disposition,
        notes: notes.trim() || undefined,
        ...(disposition === 'follow_up'
          ? { followUpDate: dateAfterDays(followUpDelay) }
          : {}),
      });
      onDone();
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.wrapPage}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.ivory} />
      <Text style={styles.eyebrow}>CALL COMPLETE</Text>
      <Text style={styles.wrapTitle}>How did it go?</Text>
      <Text style={styles.wrapPhone}>{call.displayName || call.phone}</Text>
      {!!call.displayName && <Text style={styles.wrapSecondaryPhone}>{call.phone}</Text>}
      <View style={styles.wrapOptions}>
        {CALL_DISPOSITIONS.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setDisposition(key)}
            style={[
              styles.wrapOption,
              disposition === key && styles.wrapOptionSelected,
            ]}
          >
            <Text
              style={[
                styles.wrapOptionText,
                disposition === key && styles.wrapOptionTextSelected,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {disposition === 'follow_up' && (
        <View style={styles.followUpCard}>
          <Text style={styles.noteLabel}>CALLBACK DUE</Text>
          <View style={styles.wrapOptions}>
            {([
              [0, 'Today'],
              [1, 'Tomorrow'],
              [3, 'In 3 days'],
              [7, 'In 1 week'],
            ] as const).map(([days, label]) => (
              <Pressable
                key={days}
                onPress={() => setFollowUpDelay(days)}
                style={[
                  styles.wrapOption,
                  followUpDelay === days && styles.wrapOptionSelected,
                ]}
              >
                <Text
                  style={[
                    styles.wrapOptionText,
                    followUpDelay === days && styles.wrapOptionTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.noteHint}>This callback is assigned to you in the CRM.</Text>
        </View>
      )}
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Promise, concern, next step, or callback timing…"
        placeholderTextColor={colors.muted}
        style={styles.wrapNotes}
      />
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      <Pressable
        disabled={!disposition || saving}
        onPress={save}
        style={[
          styles.primaryButton,
          (!disposition || saving) && styles.buttonDisabled,
        ]}
      >
        {saving ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryButtonText}>Save to CRM</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

function RecentsScreen({
  token,
  onCall,
}: {
  token: string;
  onCall: (phone: string, name: string) => void;
}) {
  const cachedCalls = peekMobileCalls(token);
  const [calls, setCalls] = useState<MobileCallLog[]>(cachedCalls?.calls || []);
  const [loading, setLoading] = useState(!cachedCalls);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    const cached = peekMobileCalls(token);
    if (cached) {
      setCalls(cached.calls);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError('');
    loadMobileCalls(token)
      .then(result => setCalls(result.calls))
      .catch(reason => setError(friendlyError(reason)))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => refresh(), [refresh]);

  return (
    <SafeAreaView style={styles.contactsPage}>
      <View style={styles.contactsHeader}>
        <Text style={styles.contactsTitle}>Recents</Text>
      </View>
      {loading ? (
        <View accessibilityRole="progressbar" accessibilityLabel="Loading recent calls">
          {[0, 1, 2, 3, 4, 5].map(item => (
            <View key={item} style={styles.contactRow}>
              <View style={styles.contactSkeletonAvatar} />
              <View style={styles.flex}>
                <View style={styles.contactSkeletonTitle} />
                <View style={styles.contactSkeletonCopy} />
              </View>
            </View>
          ))}
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Couldn’t load calls</Text>
          <Text style={styles.emptyCopy}>{error}</Text>
          <Pressable onPress={refresh} style={styles.textButton}>
            <Text style={styles.textButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : calls.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No calls yet</Text>
          <Text style={styles.emptyCopy}>CRM calls will appear here automatically.</Text>
        </View>
      ) : (
        <ScrollView>
          {calls.map(call => (
            <Pressable
              key={`${call.leadId}:${call.id}`}
              onPress={() => onCall(call.phone, call.name)}
              style={styles.contactRow}
            >
              <View style={styles.contactAvatar}>
                <Icon
                  name={call.direction === 'inbound' ? 'call-outline' : 'arrow-up-outline'}
                  size={19}
                  color={call.answered ? colors.green : colors.red}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.contactName}>{call.name}</Text>
                <Text style={styles.contactMeta}>
                  {[call.direction, call.duration, call.repName].filter(Boolean).join(' · ')}
                </Text>
                <Text style={styles.recentDate}>
                  {new Date(call.date).toLocaleString()}
                  {call.recordingAvailable ? ' · Recording' : ''}
                  {call.transcriptAvailable ? ' · Transcript' : ''}
                </Text>
              </View>
              <View style={styles.contactCall}>
                <Icon name="call" size={17} color="#007AFF" />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BottomNavigation({
  active,
  onChange,
}: {
  active: 'phone' | 'recents' | 'messages' | 'contacts';
  onChange: (tab: 'phone' | 'recents' | 'messages' | 'contacts') => void;
}) {
  return (
    <SafeAreaView style={styles.bottomSafe}>
      <View style={styles.bottomNav}>
        {(
          [
            ['phone', 'Phone'],
            ['recents', 'Recents'],
            ['messages', 'Messages'],
            ['contacts', 'Contacts'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={`${label} tab`}
            accessibilityState={{ selected: active === key }}
            onPress={() => onChange(key)}
            style={styles.bottomItem}
          >
            <View style={styles.navGlyph}>
              <Icon
                name={
                  key === 'phone'
                    ? active === key
                      ? 'keypad'
                      : 'keypad-outline'
                    : key === 'recents'
                    ? active === key
                      ? 'time'
                      : 'time-outline'
                    : key === 'messages'
                    ? active === key
                      ? 'chatbubble'
                      : 'chatbubble-outline'
                    : active === key
                    ? 'person-circle'
                    : 'person-circle-outline'
                }
                size={24}
                color={active === key ? '#007AFF' : '#8E8E93'}
              />
            </View>
            <Text
              style={[
                styles.bottomLabel,
                active === key && styles.bottomLabelSelected,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function IncomingCallScreen({
  state,
  busy,
  onAnswer,
  onDecline,
}: {
  state: typeof initialCallState;
  busy: boolean;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  return (
    <SafeAreaView style={styles.callPage}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <Text style={styles.incomingLabel}>SATURN STAR • INCOMING</Text>
      <View style={styles.callerAvatar}>
        <Text style={styles.callerInitial}>
          {(state.displayName || state.phone || '?')[0].toUpperCase()}
        </Text>
      </View>
      <Text style={styles.callerName}>
        {state.displayName || 'Incoming call'}
      </Text>
      <Text style={styles.callerPhone}>{state.phone}</Text>
      <Text style={styles.incomingCopy}>
        Answering keeps the call and recording inside the customer record.
      </Text>
      <View style={styles.answerRow}>
        <CallCircle
          label="Decline"
          color={colors.red}
          symbol="×"
          onPress={onDecline}
        />
        <CallCircle
          label="Answer"
          color={colors.green}
          symbol={busy ? '…' : '☎'}
          onPress={onAnswer}
        />
      </View>
    </SafeAreaView>
  );
}

function ActiveCallScreen({
  state,
  duration,
  note,
  setNote,
  busy,
  showKeypad,
  setShowKeypad,
  onDigit,
  onMute,
  onSpeaker,
  onHold,
  onTransfer,
  onHangUp,
  onConferenceAction,
  transferModal,
}: {
  state: typeof initialCallState;
  duration: string;
  note: string;
  setNote: (value: string) => void;
  busy: boolean;
  showKeypad: boolean;
  setShowKeypad: (value: boolean) => void;
  onDigit: (digit: string) => unknown;
  onMute: () => void;
  onSpeaker: () => void;
  onHold: () => void;
  onTransfer: () => void;
  onHangUp: () => void;
  onConferenceAction: (action: 'join' | 'complete' | 'return') => void;
  transferModal: React.ReactNode;
}) {
  const phaseLabel = useMemo(() => {
    if (state.phase === 'reconnecting') return 'Reconnecting…';
    if (state.phase === 'consulting' && state.conferenceMode === 'joined') {
      return 'Conference connected';
    }
    if (state.phase === 'consulting') return 'Private consultation';
    if (state.held) return 'On hold';
    if (state.phase === 'ringing') return 'Ringing…';
    if (state.phase === 'dialing') return 'Connecting…';
    return duration;
  }, [duration, state.conferenceMode, state.held, state.phase]);

  return (
    <KeyboardAvoidingView
      style={styles.activePage}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <SafeAreaView style={styles.flex}>
        <View style={styles.activeHeader}>
          <Text style={styles.activeEyebrow}>SATURN STAR COMPANY CALL</Text>
          <Text style={styles.activeName}>
            {state.displayName || state.phone || 'Customer'}
          </Text>
          <Text style={styles.activePhone}>{state.phone}</Text>
          <Text style={styles.duration}>{phaseLabel}</Text>
          {!!state.error && (
            <Text style={styles.activeError}>{state.error}</Text>
          )}
        </View>

        {state.phase === 'consulting' ? (
          <View style={styles.consultCard}>
            <Text style={styles.consultTitle}>
              {state.conferenceMode === 'joined'
                ? 'Everyone is on the call'
                : 'Customer is hearing hold music'}
            </Text>
            <Text style={styles.consultCopy}>
              {state.conferenceMode === 'joined'
                ? 'Stay on together, hand the call over, or return to the customer.'
                : 'Brief your teammate privately, then choose what happens next.'}
            </Text>
            {state.conferenceMode !== 'joined' && (
              <Pressable
                onPress={() => onConferenceAction('join')}
                style={styles.lightButton}
              >
                <Text style={styles.lightButtonText}>
                  Join everyone together
                </Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => onConferenceAction('complete')}
              style={styles.lightButton}
            >
              <Text style={styles.lightButtonText}>Transfer and leave</Text>
            </Pressable>
            <Pressable
              onPress={() => onConferenceAction('return')}
              style={styles.textButton}
            >
              <Text style={styles.textButtonText}>
                {state.conferenceMode === 'joined'
                  ? 'Remove teammate and return'
                  : 'Cancel transfer and return'}
              </Text>
            </Pressable>
          </View>
        ) : showKeypad ? (
          <View style={styles.activeKeypad}>
            <Keypad onDigit={onDigit} light />
            <Pressable onPress={() => setShowKeypad(false)}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.controlsGrid}>
              <ControlButton
                label={state.muted ? 'Unmute' : 'Mute'}
                symbol={state.muted ? 'M' : 'µ'}
                active={state.muted}
                onPress={onMute}
              />
              <ControlButton
                label={state.speaker ? 'Speaker on' : 'Speaker'}
                symbol="◖"
                active={state.speaker}
                onPress={onSpeaker}
              />
              <ControlButton
                label="Keypad"
                symbol="•••"
                onPress={() => setShowKeypad(true)}
              />
              <ControlButton
                label={state.held ? 'Resume' : 'Hold'}
                symbol={state.held ? '▶' : 'Ⅱ'}
                active={state.held}
                onPress={onHold}
              />
              <ControlButton
                label="Add / transfer"
                symbol="+"
                onPress={onTransfer}
              />
              <ControlButton
                label="Customer"
                symbol="i"
                onPress={() => undefined}
              />
            </View>
            <View style={styles.noteCard}>
              <Text style={styles.noteLabel}>CALL NOTES</Text>
              <TextInput
                multiline
                value={note}
                onChangeText={setNote}
                placeholder="Capture the promise, concern or next step…"
                placeholderTextColor="#8F99A6"
                style={styles.noteInput}
              />
              <Text style={styles.noteHint}>
                Notes stay on this screen while the call is active.
              </Text>
            </View>
          </>
        )}
        <View style={styles.hangupWrap}>
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <CallCircle
              label="End call"
              color={colors.red}
              symbol="⌁"
              onPress={onHangUp}
            />
          )}
        </View>
        {transferModal}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function TransferModal({
  visible,
  entries,
  onClose,
  onSelect,
}: {
  visible: boolean;
  entries: DirectoryEntry[];
  onClose: () => void;
  onSelect: (entry: DirectoryEntry) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.transferPage}>
        <View style={styles.transferHeader}>
          <View>
            <Text style={styles.eyebrow}>PRIVATE CONSULT</Text>
            <Text style={styles.transferTitle}>Add or transfer</Text>
          </View>
          <Pressable onPress={onClose}>
            <Text style={styles.signOut}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={styles.transferCopy}>
          The customer will hear hold music while you privately brief the
          teammate.
        </Text>
        <ScrollView>
          {entries.map(entry => (
            <Pressable
              key={entry.id}
              disabled={entry.status !== 'available'}
              onPress={() => onSelect(entry)}
              style={[
                styles.directoryRow,
                entry.status !== 'available' && styles.directoryRowBusy,
              ]}
            >
              <View style={styles.directoryAvatar}>
                <Text style={styles.directoryInitial}>
                  {entry.label[0]?.toUpperCase() || '?'}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.directoryName}>{entry.label}</Text>
                <Text style={styles.directoryMeta}>
                  {entry.kind === 'browser'
                    ? 'Saturn Star browser'
                    : entry.kind === 'mobile'
                    ? 'Saturn Star phone'
                    : 'Phone fallback'}
                </Text>
              </View>
              <Text style={styles.directoryStatus}>
                {entry.status === 'busy' ? 'On another call' : entry.status}
              </Text>
            </Pressable>
          ))}
          {entries.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                No teammate is available yet
              </Text>
              <Text style={styles.emptyCopy}>
                Ask the teammate to open Saturn Star Phone or the CRM dialer.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Keypad({
  onDigit,
  light = false,
}: {
  onDigit: (digit: string) => unknown;
  light?: boolean;
}) {
  const keys = [
    ['1', ''],
    ['2', 'ABC'],
    ['3', 'DEF'],
    ['4', 'GHI'],
    ['5', 'JKL'],
    ['6', 'MNO'],
    ['7', 'PQRS'],
    ['8', 'TUV'],
    ['9', 'WXYZ'],
    ['*', ''],
    ['0', '+'],
    ['#', ''],
  ];
  return (
    <View style={styles.keypad}>
      {keys.map(([digit, letters]) => (
        <Pressable
          key={digit}
          onPress={() => onDigit(digit)}
          style={({ pressed }) => [
            styles.key,
            light && styles.keyLight,
            pressed && styles.keyPressed,
          ]}
        >
          <Text style={[styles.keyDigit, light && styles.keyDigitLight]}>
            {digit}
          </Text>
          {!!letters && (
            <Text style={[styles.keyLetters, light && styles.keyLettersLight]}>
              {letters}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function ControlButton({
  label,
  symbol,
  active,
  onPress,
}: {
  label: string;
  symbol: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.control}>
      <View
        style={[styles.controlCircle, active && styles.controlCircleActive]}
      >
        <Text
          style={[styles.controlSymbol, active && styles.controlSymbolActive]}
        >
          {symbol}
        </Text>
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function CallCircle({
  label,
  color,
  symbol,
  onPress,
}: {
  label: string;
  color: string;
  symbol: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.callCircleWrap}>
      <View style={[styles.callCircle, { backgroundColor: color }]}>
        <Text style={styles.callCircleSymbol}>{symbol}</Text>
      </View>
      <Text style={styles.callCircleLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  launch: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
  },
  logoMark: {
    width: 60,
    height: 60,
    borderRadius: 18,
    resizeMode: 'contain',
  },
  launchTitle: {
    fontSize: 27,
    fontWeight: '700',
    color: 'white',
    marginTop: 20,
  },
  launchSubtitle: { fontSize: 15, color: '#AEB8C4', marginTop: 5 },
  launchSpinner: { marginTop: 34 },
  loginPage: { flex: 1, backgroundColor: colors.ivory },
  loginSafe: { flex: 1, padding: 24, justifyContent: 'center' },
  loginBrand: { marginBottom: 36 },
  loginLogo: { width: 50, height: 50, borderRadius: 15 },
  loginTitle: {
    fontSize: 31,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 22,
  },
  loginCopy: {
    fontSize: 17,
    lineHeight: 25,
    color: colors.muted,
    marginTop: 10,
  },
  loginCard: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
    borderRadius: 22,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    height: 54,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: '#FBFAF7',
    marginBottom: 8,
  },
  errorText: { fontSize: 14, lineHeight: 20, color: colors.red, marginTop: 10 },
  primaryButton: {
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700', color: 'white' },
  buttonDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.76 },
  page: { flex: 1, backgroundColor: colors.ivory },
  homeHeader: {
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.gold,
    fontWeight: '800',
  },
  homeTitle: {
    fontSize: 25,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
  },
  signOut: { fontSize: 15, fontWeight: '600', color: colors.ink },
  homeContent: { padding: 20, paddingBottom: 44 },
  statusCard: {
    flexDirection: 'row',
    gap: 14,
    borderRadius: 17,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.line,
    padding: 17,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#9BA4B0',
    marginTop: 5,
  },
  statusDotOn: { backgroundColor: colors.green },
  statusTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  statusCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginTop: 4,
  },
  queueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 17,
    backgroundColor: colors.navy,
    padding: 17,
    marginTop: 12,
  },
  queueTitle: { fontSize: 16, fontWeight: '800', color: 'white' },
  queueCopy: { fontSize: 12, color: '#C8D1DB', marginTop: 3 },
  queueButton: {
    minWidth: 94,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    paddingHorizontal: 14,
  },
  queueButtonText: { color: 'white', fontWeight: '800', fontSize: 13 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: '800',
    color: colors.muted,
    marginTop: 27,
    marginBottom: 10,
  },
  teamLineRow: { gap: 10, paddingRight: 4 },
  teamLineCard: {
    width: 116,
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
  },
  teamLineAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLineName: {
    maxWidth: 94,
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 7,
  },
  teamLineStatus: { fontSize: 10, color: colors.muted, marginTop: 3 },
  teamLineStatusReady: { color: colors.green },
  dialCard: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    padding: 18,
  },
  callerIdRow: { gap: 7, paddingBottom: 12 },
  callerIdPill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  callerIdPillSelected: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  callerIdLabel: { fontSize: 12, fontWeight: '600', color: colors.muted },
  callerIdLabelSelected: { color: 'white' },
  numberEntryRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  numberInput: {
    flex: 1,
    fontSize: 25,
    color: colors.ink,
    textAlign: 'center',
    paddingVertical: 10,
    paddingLeft: 38,
  },
  backspaceButton: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    maxWidth: 340,
    alignSelf: 'center',
  },
  key: {
    width: '31%',
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    marginBottom: 8,
    backgroundColor: '#F1F2F3',
  },
  keyLight: { backgroundColor: '#263444' },
  keyPressed: { opacity: 0.55 },
  keyDigit: {
    fontSize: 23,
    fontWeight: '500',
    color: colors.ink,
    lineHeight: 26,
  },
  keyDigitLight: { color: 'white' },
  keyLetters: { fontSize: 8, letterSpacing: 1.4, color: colors.muted },
  keyLettersLight: { color: '#B9C2CC' },
  callButton: {
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    marginTop: 15,
  },
  callButtonText: { fontSize: 16, fontWeight: '700', color: 'white' },
  promiseCard: { padding: 4, marginTop: 26 },
  promiseTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  promiseCopy: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    marginTop: 6,
  },
  callPage: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.navy,
    padding: 26,
  },
  incomingLabel: {
    fontSize: 11,
    letterSpacing: 1.8,
    color: colors.gold,
    fontWeight: '800',
    marginTop: 48,
  },
  callerAvatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#213041',
    marginTop: 62,
  },
  callerInitial: { fontSize: 40, color: 'white', fontWeight: '600' },
  callerName: {
    fontSize: 32,
    fontWeight: '700',
    color: 'white',
    marginTop: 25,
    textAlign: 'center',
  },
  callerPhone: { fontSize: 17, color: '#ABB6C2', marginTop: 7 },
  incomingCopy: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: '#94A1AF',
    marginTop: 28,
    maxWidth: 300,
  },
  answerRow: {
    position: 'absolute',
    bottom: 55,
    left: 46,
    right: 46,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  callCircleWrap: { alignItems: 'center', minWidth: 84 },
  callCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callCircleSymbol: { fontSize: 28, color: 'white', fontWeight: '600' },
  callCircleLabel: { fontSize: 13, color: 'white', marginTop: 10 },
  activePage: { flex: 1, backgroundColor: colors.navy },
  activeHeader: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 22,
  },
  activeEyebrow: {
    fontSize: 10,
    letterSpacing: 1.7,
    color: colors.gold,
    fontWeight: '800',
  },
  activeName: {
    fontSize: 29,
    color: 'white',
    fontWeight: '700',
    marginTop: 15,
    textAlign: 'center',
  },
  activePhone: { fontSize: 15, color: '#A9B5C1', marginTop: 5 },
  duration: {
    fontSize: 16,
    color: '#D7DDE3',
    marginTop: 12,
    fontVariant: ['tabular-nums'],
  },
  activeError: {
    fontSize: 13,
    color: '#FFB5BF',
    marginTop: 8,
    textAlign: 'center',
  },
  controlsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 30,
    paddingTop: 5,
  },
  control: { width: '33.33%', alignItems: 'center', marginBottom: 20 },
  controlCircle: {
    width: 63,
    height: 63,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#273544',
  },
  controlCircleActive: { backgroundColor: 'white' },
  controlSymbol: { fontSize: 22, color: 'white', fontWeight: '600' },
  controlSymbolActive: { color: colors.navy },
  controlLabel: {
    fontSize: 12,
    color: '#D6DCE2',
    marginTop: 8,
    textAlign: 'center',
  },
  noteCard: {
    marginHorizontal: 22,
    borderRadius: 16,
    backgroundColor: '#142332',
    padding: 15,
  },
  noteLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '800',
    color: colors.gold,
  },
  noteInput: {
    minHeight: 58,
    maxHeight: 100,
    fontSize: 15,
    lineHeight: 21,
    color: 'white',
    padding: 0,
    marginTop: 10,
  },
  noteHint: { fontSize: 11, color: '#8997A5', marginTop: 6 },
  hangupWrap: { marginTop: 'auto', alignItems: 'center', paddingBottom: 20 },
  activeKeypad: { paddingHorizontal: 25, flex: 1 },
  doneText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  consultCard: {
    margin: 24,
    borderRadius: 20,
    backgroundColor: 'white',
    padding: 20,
  },
  consultTitle: { fontSize: 19, color: colors.ink, fontWeight: '700' },
  consultCopy: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    marginTop: 7,
    marginBottom: 12,
  },
  lightButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.soft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  lightButtonText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  textButton: { padding: 15, alignItems: 'center' },
  textButtonText: { fontSize: 14, fontWeight: '600', color: colors.red },
  transferPage: { flex: 1, backgroundColor: colors.ivory },
  transferHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 22,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  transferTitle: {
    fontSize: 27,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
  },
  transferCopy: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  directoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 17,
    marginHorizontal: 18,
    marginBottom: 10,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
  },
  directoryRowBusy: { opacity: 0.55 },
  directoryAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  directoryInitial: { color: 'white', fontSize: 17, fontWeight: '700' },
  directoryName: { fontSize: 16, fontWeight: '700', color: colors.ink },
  directoryMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  directoryStatus: {
    fontSize: 11,
    color: colors.green,
    textTransform: 'capitalize',
  },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  bottomSafe: { backgroundColor: '#FFFFFF' },
  bottomNav: {
    height: 61,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    backgroundColor: 'rgba(249,249,249,0.98)',
  },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navGlyph: {
    height: 25,
    minWidth: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#8E8E93',
    marginTop: 2,
  },
  bottomLabelSelected: { color: '#007AFF' },
  contactsPage: { flex: 1, backgroundColor: '#F2F2F7' },
  wrapPage: { flex: 1, backgroundColor: colors.ivory, padding: 24 },
  wrapTitle: { fontSize: 34, fontWeight: '800', color: colors.ink, marginTop: 8 },
  wrapPhone: { fontSize: 17, color: colors.muted, marginTop: 5, marginBottom: 22 },
  wrapSecondaryPhone: {fontSize: 14, color: colors.muted, marginTop: -16, marginBottom: 22},
  wrapOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wrapOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'white',
  },
  wrapOptionSelected: { backgroundColor: colors.navy, borderColor: colors.navy },
  wrapOptionText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  wrapOptionTextSelected: { color: 'white' },
  followUpCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'white',
    padding: 15,
    marginTop: 18,
  },
  wrapNotes: {
    minHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'white',
    color: colors.ink,
    fontSize: 16,
    lineHeight: 22,
    padding: 16,
    marginTop: 22,
    marginBottom: 18,
    textAlignVertical: 'top',
  },
  contactsHeader: {
    height: 58,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 4,
    backgroundColor: '#F2F2F7',
  },
  contactsTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -1,
  },
  contactSearch: {
    height: 36,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 12,
    borderRadius: 10,
    backgroundColor: '#E3E3E8',
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  contactSearchInput: {
    height: 36,
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 7,
    fontSize: 17,
    color: '#000000',
  },
  contactsCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  contactSkeletonAvatar: {width: 42, height: 42, borderRadius: 21, backgroundColor: '#E3E4E8', marginRight: 12},
  contactSkeletonTitle: {height: 14, width: '48%', borderRadius: 7, backgroundColor: '#DFE1E5'},
  contactSkeletonCopy: {height: 11, width: '68%', borderRadius: 6, backgroundColor: '#E9EAED', marginTop: 9},
  contactDetailHeader: {height: 54, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D4D5D8'},
  contactDetailBack: {minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center'},
  contactDetailBackText: {fontSize: 17, color: '#007AFF'},
  contactDetailContent: {alignItems: 'center', padding: 24, paddingBottom: 48},
  contactDetailAvatar: {height: 88, width: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3E4E8', marginTop: 12},
  contactDetailAvatarText: {fontSize: 34, fontWeight: '600', color: colors.navy},
  contactDetailName: {fontSize: 28, fontWeight: '700', color: colors.navy, marginTop: 16, textAlign: 'center'},
  contactDetailStage: {fontSize: 15, color: colors.muted, marginTop: 5, textTransform: 'capitalize'},
  contactDetailCall: {minHeight: 50, minWidth: 190, borderRadius: 25, backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 22},
  contactDetailCallText: {fontSize: 16, fontWeight: '700', color: '#FFFFFF'},
  contactDetailCard: {alignSelf: 'stretch', borderRadius: 16, backgroundColor: '#FFFFFF', marginTop: 28, paddingHorizontal: 16},
  contactDetailRow: {minHeight: 54, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E1E2E5'},
  contactDetailLabel: {width: 90, fontSize: 14, color: colors.muted},
  contactDetailValue: {flex: 1, fontSize: 15, color: colors.navy, textAlign: 'right'},
  contactRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5EA',
    marginRight: 12,
  },
  contactAvatarText: { fontSize: 16, fontWeight: '600', color: '#3A3A3C' },
  contactName: { fontSize: 17, fontWeight: '600', color: '#000000' },
  contactMeta: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  recentDate: { fontSize: 11, color: '#8E8E93', marginTop: 3 },
  contactCall: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF3FF',
  },
});

export default App;
