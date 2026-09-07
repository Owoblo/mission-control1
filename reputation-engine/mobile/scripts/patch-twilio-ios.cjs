const fs = require('node:fs');
const path = require('node:path');

const podspec = path.join(
  __dirname,
  '..',
  'node_modules',
  '@twilio',
  'voice-react-native-sdk',
  'twilio-voice-react-native.podspec',
);

if (!fs.existsSync(podspec)) process.exit(0);
const current = fs.readFileSync(podspec, 'utf8');
const patched = current.replace(
  /s\.dependency "TwilioVoice", "6\.13\.3"/,
  's.dependency "TwilioVoice", "6.13.7"',
);
if (patched === current && !current.includes('TwilioVoice", "6.13.7')) {
  throw new Error('Twilio iOS dependency declaration changed; review the reliability patch.');
}
fs.writeFileSync(podspec, patched);

const callKitImplementation = path.join(
  __dirname,
  '..',
  'node_modules',
  '@twilio',
  'voice-react-native-sdk',
  'ios',
  'TwilioVoiceReactNative+CallKit.m',
);
const callInviteImplementation = path.join(
  __dirname,
  '..',
  'node_modules',
  '@twilio',
  'voice-react-native-sdk',
  'ios',
  'TwilioVoiceReactNative+CallInvite.m',
);
const voiceImplementation = path.join(
  __dirname,
  '..',
  'node_modules',
  '@twilio',
  'voice-react-native-sdk',
  'ios',
  'TwilioVoiceReactNative.m',
);

function patchFile(file, replacements) {
  if (!fs.existsSync(file)) {
    throw new Error(`Required Twilio source is missing: ${file}`);
  }
  let source = fs.readFileSync(file, 'utf8');
  for (const {before, after, marker} of replacements) {
    if (source.includes(marker)) continue;
    if (!source.includes(before)) {
      throw new Error(`Twilio source changed before reliability patch: ${file}`);
    }
    source = source.replace(before, after);
  }
  fs.writeFileSync(file, source);
}

// Twilio RN issue #704: CallKit may deliver Answer after a cancellation has
// already removed the invite. The upstream wrapper passes nil to
// TVOAcceptOptions in Release builds, which raises NSInvalidArgumentException.
patchFile(callKitImplementation, [{
  marker: 'Saturn reliability: a stale CallKit answer must fail gracefully.',
  before: `    NSAssert(self.callInviteMap[uuid.UUIDString], @"No call invite");

    TVOCallInvite *callInvite = self.callInviteMap[uuid.UUIDString];`,
  after: `    // Saturn reliability: a stale CallKit answer must fail gracefully.
    TVOCallInvite *callInvite = self.callInviteMap[uuid.UUIDString];
    if (!callInvite) {
        completionHandler(NO);
        return;
    }`,
}, {
  marker: 'Saturn reliability: do not claim a stale CallKit answer.',
  before: `- (void)provider:(CXProvider *)provider performAnswerCallAction:(CXAnswerCallAction *)action {
    [TwilioVoiceReactNative twilioAudioDevice].enabled = NO;`,
  after: `- (void)provider:(CXProvider *)provider performAnswerCallAction:(CXAnswerCallAction *)action {
    // Saturn reliability: do not claim a stale CallKit answer.
    if (!self.callInviteMap[action.callUUID.UUIDString]) {
        [action fail];
        return;
    }
    [TwilioVoiceReactNative twilioAudioDevice].enabled = NO;`,
}]);

// A cancellation can legitimately arrive after another path removed the
// invite. Avoid subscripting the map with nil or building an event containing
// a nil NSError description.
patchFile(callInviteImplementation, [{
  marker: 'Saturn reliability: cancellation may race invite cleanup.',
  before: `    NSAssert(uuid, @"No matching call invite");
    self.cancelledCallInviteMap[uuid] = cancelledCallInvite;`,
  after: `    // Saturn reliability: cancellation may race invite cleanup.
    if (!uuid) {
        return;
    }
    self.cancelledCallInviteMap[uuid] = cancelledCallInvite;`,
}, {
  marker: 'Saturn reliability: cancellation errors are not guaranteed.',
  before: `    [self sendEventWithName:kTwilioVoiceReactNativeScopeCallInvite
                       body:@{
                         kTwilioVoiceReactNativeVoiceEventType: kTwilioVoiceReactNativeCallInviteEventTypeValueCancelled,
                         kTwilioVoiceReactNativeCallInviteEventKeyCallSid: cancelledCallInvite.callSid,
                         kTwilioVoiceReactNativeEventKeyCancelledCallInvite: [self cancelledCallInviteInfo:cancelledCallInvite],
                         kTwilioVoiceReactNativeVoiceErrorKeyError: @{
                           kTwilioVoiceReactNativeVoiceErrorKeyCode: @(error.code),
                           kTwilioVoiceReactNativeVoiceErrorKeyMessage: [error localizedDescription]}}];`,
  after: `    // Saturn reliability: cancellation errors are not guaranteed.
    NSMutableDictionary *body = [@{
      kTwilioVoiceReactNativeVoiceEventType: kTwilioVoiceReactNativeCallInviteEventTypeValueCancelled,
      kTwilioVoiceReactNativeCallInviteEventKeyCallSid: cancelledCallInvite.callSid,
      kTwilioVoiceReactNativeEventKeyCancelledCallInvite: [self cancelledCallInviteInfo:cancelledCallInvite]
    } mutableCopy];
    if (error) {
        body[kTwilioVoiceReactNativeVoiceErrorKeyError] = @{
          kTwilioVoiceReactNativeVoiceErrorKeyCode: @(error.code),
          kTwilioVoiceReactNativeVoiceErrorKeyMessage: error.localizedDescription ?: @"Call cancelled"
        };
    }
    [self sendEventWithName:kTwilioVoiceReactNativeScopeCallInvite body:body];`,
}]);

// Twilio RN issue #665: selectedAudioDevice can be nil during a first-launch
// audio interruption. Objective-C dictionary literals abort on nil values.
patchFile(voiceImplementation, [{
  marker: 'Saturn reliability: the selected audio device can be nil.',
  before: `    resolve(@{kTwilioVoiceReactNativeAudioDeviceKeyAudioDevices: nativeAudioDeviceInfos,
              kTwilioVoiceReactNativeAudioDeviceKeySelectedDevice: self.selectedAudioDevice});`,
  after: `    // Saturn reliability: the selected audio device can be nil.
    NSMutableDictionary *payload = [@{
      kTwilioVoiceReactNativeAudioDeviceKeyAudioDevices: nativeAudioDeviceInfos
    } mutableCopy];
    if (self.selectedAudioDevice) {
        payload[kTwilioVoiceReactNativeAudioDeviceKeySelectedDevice] = self.selectedAudioDevice;
    }
    resolve(payload);`,
}]);
