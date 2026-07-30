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
import {
  controlConference,
  DirectoryEntry,
  loadDirectory,
  loadMe,
  loadPhoneLines,
  loadVoiceToken,
  PhoneLine,
  signIn,
  StaffUser,
} from './src/api';
import {MessagesScreen} from './src/messages-screen';
import {
  callReducer,
  initialCallState,
} from './src/call-state';
import {clearSession, readSession, saveSession} from './src/storage';
import {colors} from './src/theme';

const voice = new Voice();
const TOKEN_REFRESH_MS = 45 * 60 * 1000;

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
      <View style={styles.logoMark}>
        <Text style={styles.logoGlyph}>S</Text>
      </View>
      <Text style={styles.launchTitle}>Saturn Star</Text>
      <Text style={styles.launchSubtitle}>Company phone</Text>
      <ActivityIndicator color={colors.gold} style={styles.launchSpinner} />
    </View>
  );
}

function LoginScreen({
  onAuthenticated,
}: {
  onAuthenticated: (result: {token: string; user: StaffUser}) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await signIn(email, password));
    } catch (reason) {
      setError(friendlyError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.loginPage}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.ivory} />
      <SafeAreaView style={styles.loginSafe}>
        <View style={styles.loginBrand}>
          <View style={[styles.logoMark, styles.loginLogo]}>
            <Text style={styles.logoGlyph}>S</Text>
          </View>
          <Text style={styles.loginTitle}>Saturn Star Phone</Text>
          <Text style={styles.loginCopy}>
            Your company line, customer context and call controls—together.
          </Text>
        </View>
        <View style={styles.loginCard}>
          <Text style={styles.fieldLabel}>WORK EMAIL</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@saturnstarmovers.ca"
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
            disabled={busy || !email.trim() || !password}
            onPress={submit}
            style={({pressed}) => [
              styles.primaryButton,
              (busy || !email.trim() || !password) && styles.buttonDisabled,
              pressed && styles.pressed,
            ]}>
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
  const [registered, setRegistered] = useState(false);
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [status, setStatus] = useState('Connecting company line…');
  const [activeTab, setActiveTab] = useState<'phone' | 'messages' | 'contacts'>('phone');
  const [lines, setLines] = useState<PhoneLine[]>([]);
  const [selectedLine, setSelectedLine] = useState('');
  const callRef = useRef<Call | null>(null);
  const inviteRef = useRef<CallInvite | null>(null);

  const register = useCallback(async () => {
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
    setLines(lineResult.lines);
    setSelectedLine(current =>
      current && lineResult.lines.some(line => line.number === current)
        ? current
        : lineResult.lines[0]?.number || '',
    );
    if (Platform.OS === 'ios') await voice.initializePushRegistry();
    await voice.setIncomingCallContactHandleTemplate(
      'Saturn Star • ${DisplayName}',
    );
    await voice.register(result.token);
    setRegistered(true);
    setStatus('Ready for company calls');
  }, [token]);

  const attachCall = useCallback((call: Call, fallbackPhone = '') => {
    callRef.current = call;
    const phone = call.getFrom() || call.getTo() || fallbackPhone;
    call.on(Call.Event.Ringing, () => dispatch({type: 'RINGING'}));
    call.on(Call.Event.Connected, () =>
      dispatch({type: 'CONNECTED', phone}),
    );
    call.on(Call.Event.Reconnecting, () =>
      dispatch({type: 'RECONNECTING'}),
    );
    call.on(Call.Event.Reconnected, () => dispatch({type: 'RECOVERED'}));
    call.on(Call.Event.ConnectFailure, error =>
      dispatch({type: 'ERROR', message: friendlyError(error)}),
    );
    call.on(Call.Event.Disconnected, error => {
      callRef.current = null;
      if (error) dispatch({type: 'ERROR', message: friendlyError(error)});
      dispatch({type: 'END'});
    });
  }, []);

  useEffect(() => {
    const onInvite = (invite: CallInvite) => {
      inviteRef.current = invite;
      const parameters = invite.getCustomParameters();
      dispatch({
        type: 'INCOMING',
        phone: invite.getFrom(),
        displayName:
          parameters.DisplayName || parameters.CustomerName || invite.getFrom(),
      });
      invite.on(CallInvite.Event.Cancelled, () => {
        inviteRef.current = null;
        dispatch({type: 'END'});
      });
      invite.on(CallInvite.Event.Accepted, call => {
        inviteRef.current = null;
        attachCall(call, invite.getFrom());
      });
    };
    const onVoiceError = (error: unknown) => {
      setStatus('Company line needs attention');
      dispatch({type: 'ERROR', message: friendlyError(error)});
    };
    voice.on(Voice.Event.CallInvite, onInvite);
    voice.on(Voice.Event.Registered, () => setRegistered(true));
    voice.on(Voice.Event.Unregistered, () => setRegistered(false));
    voice.on(Voice.Event.Error, onVoiceError);
    register().catch(onVoiceError);
    const refresh = setInterval(() => register().catch(onVoiceError), TOKEN_REFRESH_MS);
    const appSubscription = AppState.addEventListener('change', next => {
      if (next === 'active') register().catch(onVoiceError);
    });
    return () => {
      clearInterval(refresh);
      appSubscription.remove();
      voice.removeListener(Voice.Event.CallInvite, onInvite);
      voice.removeListener(Voice.Event.Error, onVoiceError);
    };
  }, [attachCall, register]);

  useEffect(() => {
    if (!state.connectedAt) {
      setSeconds(0);
      return;
    }
    const update = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - state.connectedAt!) / 1000)));
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

  async function placeCall() {
    const target = normalizeDialTarget(number);
    if (!target || !voiceToken) return;
    setBusy(true);
    dispatch({type: 'DIAL', phone: target});
    try {
      const call = await voice.connect(voiceToken, {
        params: {
          To: target,
          ...(selectedLine ? {PreferredFromNumber: selectedLine} : {}),
        },
        contactHandle: target,
        notificationDisplayName: 'Saturn Star call',
      });
      attachCall(call, target);
    } catch (error) {
      dispatch({type: 'ERROR', message: friendlyError(error)});
      dispatch({type: 'END'});
    } finally {
      setBusy(false);
    }
  }

  async function answer() {
    if (!inviteRef.current) return;
    setBusy(true);
    try {
      await inviteRef.current.accept();
    } catch (error) {
      dispatch({type: 'ERROR', message: friendlyError(error)});
    } finally {
      setBusy(false);
    }
  }

  async function hangUp() {
    if (inviteRef.current) {
      await inviteRef.current.reject().catch(() => undefined);
      inviteRef.current = null;
    }
    await callRef.current?.disconnect().catch(() => undefined);
    callRef.current = null;
    dispatch({type: 'END'});
  }

  async function toggleMute() {
    const value = !state.muted;
    await callRef.current?.mute(value);
    dispatch({type: 'MUTE', value});
  }

  async function toggleSpeaker() {
    const next = !state.speaker;
    const {audioDevices} = await voice.getAudioDevices();
    const desired = audioDevices.find(
      device =>
        device.type ===
        (next ? AudioDevice.Type.Speaker : AudioDevice.Type.Earpiece),
    );
    if (desired) await desired.select();
    else if (Platform.OS === 'ios') await voice.showAvRoutePickerView();
    dispatch({type: 'SPEAKER', value: next});
  }

  async function toggleHold() {
    const value = !state.held;
    await callRef.current?.hold(value);
    dispatch({type: 'HOLD', value});
  }

  async function openTransfer() {
    setBusy(true);
    try {
      const result = await loadDirectory(token);
      setDirectory(result.entries);
      setShowTransfer(true);
    } catch (error) {
      dispatch({type: 'ERROR', message: friendlyError(error)});
    } finally {
      setBusy(false);
    }
  }

  async function beginConsult(entry: DirectoryEntry) {
    const sid = callRef.current?.getSid();
    if (!sid) {
      dispatch({type: 'ERROR', message: 'The active call is not ready to transfer yet.'});
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
      dispatch({type: 'ERROR', message: friendlyError(error)});
    } finally {
      setBusy(false);
    }
  }

  async function conferenceAction(
    action: 'join' | 'complete' | 'return',
  ) {
    const session = state.conference;
    if (!session) return;
    setBusy(true);
    try {
      await controlConference(token, {action, ...session});
      if (action === 'complete') {
        callRef.current = null;
        dispatch({type: 'END'});
      } else if (action === 'join') {
        dispatch({type: 'JOIN_CONFERENCE'});
      } else {
        dispatch({type: 'RETURN_TO_CUSTOMER'});
      }
    } catch (error) {
      dispatch({type: 'ERROR', message: friendlyError(error)});
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
          onOpenDialer={(phone, line) => {
            if (phone) setNumber(phone);
            if (line && lines.some(item => item.number === line)) setSelectedLine(line);
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
          onCall={(phone, line) => {
            setNumber(phone);
            if (line) setSelectedLine(line);
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
          <Text style={styles.homeTitle}>Good day, {user.name.split(' ')[0]}</Text>
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
        <Text style={styles.sectionLabel}>NEW CALL</Text>
        <View style={styles.dialCard}>
          {lines.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.callerIdRow}>
              {lines.map(line => (
                <Pressable
                  key={line.number}
                  onPress={() => setSelectedLine(line.number)}
                  style={[
                    styles.callerIdPill,
                    selectedLine === line.number && styles.callerIdPillSelected,
                  ]}>
                  <Text
                    style={[
                      styles.callerIdLabel,
                      selectedLine === line.number && styles.callerIdLabelSelected,
                    ]}>
                    {line.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <TextInput
            value={number}
            onChangeText={setNumber}
            keyboardType="phone-pad"
            placeholder="Name or phone number"
            placeholderTextColor="#8A94A3"
            style={styles.numberInput}
          />
          <Keypad onDigit={digit => setNumber(current => `${current}${digit}`)} />
          {!!state.error && <Text style={styles.errorText}>{state.error}</Text>}
          <Pressable
            disabled={!registered || !normalizeDialTarget(number) || busy}
            onPress={placeCall}
            style={({pressed}) => [
              styles.callButton,
              (!registered || !normalizeDialTarget(number) || busy) &&
                styles.buttonDisabled,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.callButtonText}>
              Call from {lines.find(line => line.number === selectedLine)?.label || 'Saturn Star'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.promiseCard}>
          <Text style={styles.promiseTitle}>One company line. Full context.</Text>
          <Text style={styles.promiseCopy}>
            Calls, recordings and transfers remain attached to Saturn Star—not a rep’s personal phone.
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
  onCall: (phone: string, line?: string) => void;
}) {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDirectory(token)
      .then(result => setEntries(result.entries))
      .finally(() => setLoading(false));
  }, [token]);

  const visible = entries.filter(entry =>
    entry.kind === 'phone' &&
    `${entry.label} ${entry.target}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <SafeAreaView style={styles.contactsPage}>
      <View style={styles.contactsHeader}>
        <Text style={styles.contactsTitle}>Contacts</Text>
      </View>
      <View style={styles.contactSearch}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search teammates"
          placeholderTextColor="#89929F"
          style={styles.contactSearchInput}
        />
      </View>
      {loading ? (
        <View style={styles.contactsCenter}><ActivityIndicator color={colors.navy} /></View>
      ) : (
        <ScrollView>
          {visible.map(entry => (
            <Pressable
              key={entry.id}
              onPress={() => onCall(entry.target)}
              style={styles.contactRow}>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactAvatarText}>{entry.label[0]?.toUpperCase()}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.contactName}>{entry.label}</Text>
                <Text style={styles.contactMeta}>{entry.status}</Text>
              </View>
              <Text style={styles.contactCall}>Call</Text>
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
  active: 'phone' | 'messages' | 'contacts';
  onChange: (tab: 'phone' | 'messages' | 'contacts') => void;
}) {
  return (
    <SafeAreaView style={styles.bottomSafe}>
      <View style={styles.bottomNav}>
        {([
          ['phone', 'Phone'],
          ['messages', 'Messages'],
          ['contacts', 'Contacts'],
        ] as const).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{selected: active === key}}
            onPress={() => onChange(key)}
            style={styles.bottomItem}>
            <View style={[styles.navGlyph, active === key && styles.navGlyphSelected]}>
              <Text style={[styles.navGlyphText, active === key && styles.navGlyphTextSelected]}>
                {key === 'phone' ? '☎' : key === 'messages' ? '••' : '◉'}
              </Text>
            </View>
            <Text style={[styles.bottomLabel, active === key && styles.bottomLabelSelected]}>
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
      <Text style={styles.callerName}>{state.displayName || 'Incoming call'}</Text>
      <Text style={styles.callerPhone}>{state.phone}</Text>
      <Text style={styles.incomingCopy}>
        Answering keeps the call and recording inside the customer record.
      </Text>
      <View style={styles.answerRow}>
        <CallCircle label="Decline" color={colors.red} symbol="×" onPress={onDecline} />
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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <SafeAreaView style={styles.flex}>
        <View style={styles.activeHeader}>
          <Text style={styles.activeEyebrow}>SATURN STAR COMPANY CALL</Text>
          <Text style={styles.activeName}>
            {state.displayName || state.phone || 'Customer'}
          </Text>
          <Text style={styles.activePhone}>{state.phone}</Text>
          <Text style={styles.duration}>{phaseLabel}</Text>
          {!!state.error && <Text style={styles.activeError}>{state.error}</Text>}
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
                style={styles.lightButton}>
                <Text style={styles.lightButtonText}>Join everyone together</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => onConferenceAction('complete')}
              style={styles.lightButton}>
              <Text style={styles.lightButtonText}>Transfer and leave</Text>
            </Pressable>
            <Pressable
              onPress={() => onConferenceAction('return')}
              style={styles.textButton}>
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
              <ControlButton label="Customer" symbol="i" onPress={() => undefined} />
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
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
          The customer will hear hold music while you privately brief the teammate.
        </Text>
        <ScrollView>
          {entries.map(entry => (
            <Pressable
              key={entry.id}
              onPress={() => onSelect(entry)}
              style={styles.directoryRow}>
              <View style={styles.directoryAvatar}>
                <Text style={styles.directoryInitial}>
                  {entry.label[0]?.toUpperCase() || '?'}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.directoryName}>{entry.label}</Text>
                <Text style={styles.directoryMeta}>
                  {entry.kind === 'browser' ? 'Saturn Star app / browser' : 'Phone fallback'}
                </Text>
              </View>
              <Text style={styles.directoryStatus}>{entry.status}</Text>
            </Pressable>
          ))}
          {entries.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No teammate is available yet</Text>
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
          style={({pressed}) => [
            styles.key,
            light && styles.keyLight,
            pressed && styles.keyPressed,
          ]}>
          <Text style={[styles.keyDigit, light && styles.keyDigitLight]}>{digit}</Text>
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
      <View style={[styles.controlCircle, active && styles.controlCircleActive]}>
        <Text style={[styles.controlSymbol, active && styles.controlSymbolActive]}>
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
      <View style={[styles.callCircle, {backgroundColor: color}]}>
        <Text style={styles.callCircleSymbol}>{symbol}</Text>
      </View>
      <Text style={styles.callCircleLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
  },
  logoGlyph: {fontSize: 31, fontWeight: '800', color: colors.navy},
  launchTitle: {fontSize: 27, fontWeight: '700', color: 'white', marginTop: 20},
  launchSubtitle: {fontSize: 15, color: '#AEB8C4', marginTop: 5},
  launchSpinner: {marginTop: 34},
  loginPage: {flex: 1, backgroundColor: colors.ivory},
  loginSafe: {flex: 1, padding: 24, justifyContent: 'center'},
  loginBrand: {marginBottom: 36},
  loginLogo: {width: 50, height: 50, borderRadius: 15},
  loginTitle: {fontSize: 31, fontWeight: '700', color: colors.ink, marginTop: 22},
  loginCopy: {fontSize: 17, lineHeight: 25, color: colors.muted, marginTop: 10},
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
  errorText: {fontSize: 14, lineHeight: 20, color: colors.red, marginTop: 10},
  primaryButton: {
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  primaryButtonText: {fontSize: 16, fontWeight: '700', color: 'white'},
  buttonDisabled: {opacity: 0.42},
  pressed: {opacity: 0.76},
  page: {flex: 1, backgroundColor: colors.ivory},
  homeHeader: {
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  eyebrow: {fontSize: 10, letterSpacing: 1.6, color: colors.gold, fontWeight: '800'},
  homeTitle: {fontSize: 25, fontWeight: '700', color: colors.ink, marginTop: 4},
  signOut: {fontSize: 15, fontWeight: '600', color: colors.ink},
  homeContent: {padding: 20, paddingBottom: 44},
  statusCard: {
    flexDirection: 'row',
    gap: 14,
    borderRadius: 17,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.line,
    padding: 17,
  },
  statusDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: '#9BA4B0', marginTop: 5},
  statusDotOn: {backgroundColor: colors.green},
  statusTitle: {fontSize: 16, fontWeight: '700', color: colors.ink},
  statusCopy: {fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 4},
  sectionLabel: {fontSize: 11, letterSpacing: 1.6, fontWeight: '800', color: colors.muted, marginTop: 27, marginBottom: 10},
  dialCard: {backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 18},
  callerIdRow: {gap: 7, paddingBottom: 12},
  callerIdPill: {height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: colors.line},
  callerIdPillSelected: {backgroundColor: colors.navy, borderColor: colors.navy},
  callerIdLabel: {fontSize: 12, fontWeight: '600', color: colors.muted},
  callerIdLabelSelected: {color: 'white'},
  numberInput: {fontSize: 25, color: colors.ink, textAlign: 'center', paddingVertical: 10, marginBottom: 12},
  keypad: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', maxWidth: 340, alignSelf: 'center'},
  key: {width: '31%', height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 32, marginBottom: 8, backgroundColor: '#F1F2F3'},
  keyLight: {backgroundColor: '#263444'},
  keyPressed: {opacity: 0.55},
  keyDigit: {fontSize: 23, fontWeight: '500', color: colors.ink, lineHeight: 26},
  keyDigitLight: {color: 'white'},
  keyLetters: {fontSize: 8, letterSpacing: 1.4, color: colors.muted},
  keyLettersLight: {color: '#B9C2CC'},
  callButton: {height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green, marginTop: 15},
  callButtonText: {fontSize: 16, fontWeight: '700', color: 'white'},
  promiseCard: {padding: 4, marginTop: 26},
  promiseTitle: {fontSize: 17, fontWeight: '700', color: colors.ink},
  promiseCopy: {fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 6},
  callPage: {flex: 1, alignItems: 'center', backgroundColor: colors.navy, padding: 26},
  incomingLabel: {fontSize: 11, letterSpacing: 1.8, color: colors.gold, fontWeight: '800', marginTop: 48},
  callerAvatar: {width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center', backgroundColor: '#213041', marginTop: 62},
  callerInitial: {fontSize: 40, color: 'white', fontWeight: '600'},
  callerName: {fontSize: 32, fontWeight: '700', color: 'white', marginTop: 25, textAlign: 'center'},
  callerPhone: {fontSize: 17, color: '#ABB6C2', marginTop: 7},
  incomingCopy: {fontSize: 14, lineHeight: 21, textAlign: 'center', color: '#94A1AF', marginTop: 28, maxWidth: 300},
  answerRow: {position: 'absolute', bottom: 55, left: 46, right: 46, flexDirection: 'row', justifyContent: 'space-between'},
  callCircleWrap: {alignItems: 'center', minWidth: 84},
  callCircle: {width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center'},
  callCircleSymbol: {fontSize: 28, color: 'white', fontWeight: '600'},
  callCircleLabel: {fontSize: 13, color: 'white', marginTop: 10},
  activePage: {flex: 1, backgroundColor: colors.navy},
  activeHeader: {alignItems: 'center', paddingHorizontal: 24, paddingTop: 30, paddingBottom: 22},
  activeEyebrow: {fontSize: 10, letterSpacing: 1.7, color: colors.gold, fontWeight: '800'},
  activeName: {fontSize: 29, color: 'white', fontWeight: '700', marginTop: 15, textAlign: 'center'},
  activePhone: {fontSize: 15, color: '#A9B5C1', marginTop: 5},
  duration: {fontSize: 16, color: '#D7DDE3', marginTop: 12, fontVariant: ['tabular-nums']},
  activeError: {fontSize: 13, color: '#FFB5BF', marginTop: 8, textAlign: 'center'},
  controlsGrid: {flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 30, paddingTop: 5},
  control: {width: '33.33%', alignItems: 'center', marginBottom: 20},
  controlCircle: {width: 63, height: 63, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: '#273544'},
  controlCircleActive: {backgroundColor: 'white'},
  controlSymbol: {fontSize: 22, color: 'white', fontWeight: '600'},
  controlSymbolActive: {color: colors.navy},
  controlLabel: {fontSize: 12, color: '#D6DCE2', marginTop: 8, textAlign: 'center'},
  noteCard: {marginHorizontal: 22, borderRadius: 16, backgroundColor: '#142332', padding: 15},
  noteLabel: {fontSize: 10, letterSpacing: 1.5, fontWeight: '800', color: colors.gold},
  noteInput: {minHeight: 58, maxHeight: 100, fontSize: 15, lineHeight: 21, color: 'white', padding: 0, marginTop: 10},
  noteHint: {fontSize: 11, color: '#8997A5', marginTop: 6},
  hangupWrap: {marginTop: 'auto', alignItems: 'center', paddingBottom: 20},
  activeKeypad: {paddingHorizontal: 25, flex: 1},
  doneText: {color: 'white', textAlign: 'center', fontSize: 16, fontWeight: '600', marginTop: 8},
  consultCard: {margin: 24, borderRadius: 20, backgroundColor: 'white', padding: 20},
  consultTitle: {fontSize: 19, color: colors.ink, fontWeight: '700'},
  consultCopy: {fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 7, marginBottom: 12},
  lightButton: {height: 50, borderRadius: 12, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center', marginTop: 9},
  lightButtonText: {fontSize: 15, fontWeight: '700', color: colors.ink},
  textButton: {padding: 15, alignItems: 'center'},
  textButtonText: {fontSize: 14, fontWeight: '600', color: colors.red},
  transferPage: {flex: 1, backgroundColor: colors.ivory},
  transferHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 22, borderBottomWidth: 1, borderColor: colors.line},
  transferTitle: {fontSize: 27, fontWeight: '700', color: colors.ink, marginTop: 4},
  transferCopy: {fontSize: 15, lineHeight: 22, color: colors.muted, paddingHorizontal: 22, paddingVertical: 18},
  directoryRow: {flexDirection: 'row', alignItems: 'center', padding: 17, marginHorizontal: 18, marginBottom: 10, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 16},
  directoryAvatar: {width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginRight: 13},
  directoryInitial: {color: 'white', fontSize: 17, fontWeight: '700'},
  directoryName: {fontSize: 16, fontWeight: '700', color: colors.ink},
  directoryMeta: {fontSize: 12, color: colors.muted, marginTop: 3},
  directoryStatus: {fontSize: 11, color: colors.green, textTransform: 'capitalize'},
  emptyState: {padding: 40, alignItems: 'center'},
  emptyTitle: {fontSize: 18, fontWeight: '700', color: colors.ink},
  emptyCopy: {fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center', marginTop: 8},
  bottomSafe: {backgroundColor: '#FFFFFF'},
  bottomNav: {height: 58, flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#D8DCE1', backgroundColor: '#FFFFFF'},
  bottomItem: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  navGlyph: {height: 21, minWidth: 25, alignItems: 'center', justifyContent: 'center'},
  navGlyphSelected: {borderRadius: 11, backgroundColor: colors.navy},
  navGlyphText: {fontSize: 13, fontWeight: '700', color: '#7C8693'},
  navGlyphTextSelected: {color: '#FFFFFF', paddingHorizontal: 6},
  bottomLabel: {fontSize: 10, fontWeight: '600', color: '#7C8693', marginTop: 2},
  bottomLabelSelected: {color: colors.navy},
  contactsPage: {flex: 1, backgroundColor: '#FFFFFF'},
  contactsHeader: {height: 62, justifyContent: 'center', paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DDE1E6'},
  contactsTitle: {fontSize: 30, fontWeight: '700', color: colors.navy, letterSpacing: -0.8},
  contactSearch: {margin: 14, borderRadius: 12, backgroundColor: '#F0F1F2', paddingHorizontal: 13},
  contactSearchInput: {height: 42, fontSize: 16, color: colors.navy},
  contactsCenter: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  contactRow: {minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E0E3E7'},
  contactAvatar: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9ECEF', marginRight: 12},
  contactAvatarText: {fontSize: 16, fontWeight: '600', color: colors.navy},
  contactName: {fontSize: 16, fontWeight: '600', color: colors.navy},
  contactMeta: {fontSize: 13, color: '#7A8491', marginTop: 2, textTransform: 'capitalize'},
  contactCall: {fontSize: 14, fontWeight: '600', color: colors.navy},
});

export default App;
