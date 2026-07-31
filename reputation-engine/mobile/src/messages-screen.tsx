import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {pick, types} from '@react-native-documents/picker';
import {launchImageLibrary} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import {
  Conversation,
  ConversationMessage,
  ContactProfile,
  loadContactProfile,
  loadConversationMessages,
  loadConversations,
  PhoneLine,
  sendConversationMessage,
  uploadMessageMedia,
} from './api';
import {colors} from './theme';
import {
  appendPendingMessage,
  createPendingMessage,
  removePendingMessage,
} from './message-state';

type Workspace = 'sales' | 'partnership';
type PendingAttachment = {uri: string; name: string; type: string};

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

function timeOfDay(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function MessagesScreen({
  token,
  onOpenDialer,
  canAccessPartnership,
}: {
  token: string;
  onOpenDialer: (phone?: string, line?: string) => void;
  canAccessPartnership: boolean;
}) {
  const [workspace, setWorkspace] = useState<Workspace>('sales');
  const [lines, setLines] = useState<PhoneLine[]>([]);
  const [line, setLine] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const result = await loadConversations(token, workspace, line || undefined);
      setLines(result.lines);
      if (line && !result.lines.some(item => item.number === line)) setLine('');
      setConversations(result.conversations);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Messages are temporarily unavailable.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [line, token, workspace]);

  useEffect(() => {
    setSelected(null);
    setLine('');
  }, [workspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => refresh(true), 20_000);
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') refresh(true);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(null);
      refresh(true);
      return true;
    });
    return () => subscription.remove();
  }, [refresh, selected]);

  if (selected) {
    return (
      <ThreadScreen
        token={token}
        conversation={selected}
        onBack={() => {
          setSelected(null);
          refresh(true);
        }}
        onCall={() => onOpenDialer(selected.phone, selected.line)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <Pressable accessibilityRole="button" onPress={() => refresh()}>
          <Text style={styles.headerAction}>Refresh</Text>
        </Pressable>
      </View>
      <View style={styles.segment}>
        <Segment
          label="Customers"
          selected={workspace === 'sales'}
          onPress={() => setWorkspace('sales')}
        />
        {canAccessPartnership && (
          <Segment
            label="Partnerships"
            selected={workspace === 'partnership'}
            onPress={() => setWorkspace('partnership')}
          />
        )}
      </View>
      {lines.length > 1 && (
        <FlatList
          horizontal
          data={[{number: '', label: 'All lines'} as PhoneLine, ...lines]}
          keyExtractor={item => item.number || 'all'}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.lineList}
          renderItem={({item}) => (
            <Pressable
              onPress={() => setLine(item.number)}
              style={[styles.linePill, line === item.number && styles.linePillSelected]}>
              <Text style={[styles.lineText, line === item.number && styles.lineTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      )}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Messages didn’t load</Text>
          <Text style={styles.emptyCopy}>{error}</Text>
          <Pressable onPress={() => refresh()} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={item => `${item.workspace}:${item.id}:${item.line}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                refresh(true);
              }}
              tintColor={colors.navy}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyCopy}>
                New replies on the selected company line will appear here.
              </Text>
            </View>
          }
          renderItem={({item}) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(item)}
              style={({pressed}) => [styles.row, pressed && styles.rowPressed]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text numberOfLines={1} style={styles.name}>{item.name}</Text>
                  <Text style={styles.time}>{relativeTime(item.lastAt)}</Text>
                </View>
                <Text numberOfLines={1} style={styles.subtitle}>{item.subtitle}</Text>
                <View style={styles.previewRow}>
                  <Text numberOfLines={1} style={styles.preview}>
                    {item.lastDirection === 'outbound' ? 'You: ' : ''}{item.lastMessage}
                  </Text>
                  {item.unreadCount > 0 && <View style={styles.unreadDot} />}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ThreadScreen({
  token,
  conversation,
  onBack,
  onCall,
}: {
  token: string;
  conversation: Conversation;
  onBack: () => void;
  onCall: () => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<FlatList<ConversationMessage>>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await loadConversationMessages(token, conversation);
      setMessages(result.messages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Conversation is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, [conversation, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(load, 15_000);
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') load();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [load]);

  async function send() {
    const body = draft.trim();
    if ((!body && !attachment) || sending) return;
    const optimistic = createPendingMessage(body || `Attachment: ${attachment?.name}`);
    setDraft('');
    setSending(true);
    setMessages(current => appendPendingMessage(current, optimistic));
    try {
      const mediaUrls = attachment
        ? [(await uploadMessageMedia(token, attachment)).url]
        : [];
      await sendConversationMessage(token, conversation, body, mediaUrls);
      setAttachment(null);
      await load();
    } catch (reason) {
      setMessages(current => removePendingMessage(current, optimistic.id));
      setDraft(body);
      setError(reason instanceof Error ? reason.message : 'Message was not sent.');
    } finally {
      setSending(false);
    }
  }

  async function choosePhoto() {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setAttachment({
      uri: asset.uri,
      name: asset.fileName || 'photo.jpg',
      type: asset.type || 'image/jpeg',
    });
  }

  async function chooseDocument() {
    const result = await pick({
      allowMultiSelection: false,
      type: [types.pdf, types.plainText],
    });
    const file = result[0];
    if (!file?.uri) return;
    setAttachment({
      uri: file.uri,
      name: file.name || 'document',
      type: file.type || 'application/octet-stream',
    });
  }

  function showAttachmentMenu() {
    Alert.alert('Add attachment', 'Choose what to send', [
      {text: 'Photo library', onPress: () => choosePhoto().catch(reason => setError(String(reason)))},
      {text: 'Document', onPress: () => chooseDocument().catch(reason => setError(String(reason)))},
      {text: 'Cancel', style: 'cancel'},
    ]);
  }

  async function openProfile() {
    setShowProfile(true);
    if (profile) return;
    setProfileLoading(true);
    try {
      setProfile((await loadContactProfile(token, conversation)).profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Contact details did not load.');
    } finally {
      setProfileLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.threadPage}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
      <SafeAreaView style={styles.threadPage}>
        <View style={styles.threadHeader}>
          <Pressable accessibilityLabel="Back to messages" onPress={onBack} hitSlop={12}>
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Open contact details"
            onPress={openProfile}
            style={styles.threadIdentity}>
            <Text numberOfLines={1} style={styles.threadName}>{conversation.name}</Text>
            <Text numberOfLines={1} style={styles.threadLine}>
              {conversation.subtitle} · View details
            </Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onCall} hitSlop={12}>
            <Text style={styles.callAction}>Call</Text>
          </Pressable>
        </View>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.navy} /></View>
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => list.current?.scrollToEnd({animated: false})}
            renderItem={({item, index}) => {
              const outbound = item.direction === 'outbound';
              const previous = messages[index - 1];
              const showTime = !previous ||
                new Date(item.created_at).getTime() - new Date(previous.created_at).getTime() > 15 * 60 * 1000;
              return (
                <View>
                  {showTime && <Text style={styles.messageTime}>{timeOfDay(item.created_at)}</Text>}
                  <View style={[styles.bubble, outbound ? styles.outbound : styles.inbound]}>
                    <Text style={[styles.messageText, outbound && styles.outboundText]}>
                      {item.body}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}
        {!!error && (
          <Pressable onPress={load} style={styles.inlineError}>
            <Text numberOfLines={2} style={styles.inlineErrorText}>{error} Tap to retry.</Text>
          </Pressable>
        )}
        <View style={styles.composerWrap}>
          {!!attachment && (
            <View style={styles.attachmentChip}>
              <Icon
                name={attachment.type.startsWith('image/') ? 'image-outline' : 'document-outline'}
                size={18}
                color={colors.navy}
              />
              <Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text>
              <Pressable accessibilityLabel="Remove attachment" onPress={() => setAttachment(null)}>
                <Icon name="close-circle" size={21} color="#77818F" />
              </Pressable>
            </View>
          )}
          <View style={styles.composer}>
            <Pressable
              accessibilityLabel="Add photo or document"
              onPress={showAttachmentMenu}
              hitSlop={8}
              style={styles.attachButton}>
              <Icon name="add-circle-outline" size={29} color={colors.navy} />
            </Pressable>
            <TextInput
              multiline
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor="#8D96A3"
              style={styles.composerInput}
            />
            <Pressable
              accessibilityLabel="Send message"
              disabled={(!draft.trim() && !attachment) || sending}
              onPress={send}
              style={[
                styles.send,
                ((!draft.trim() && !attachment) || sending) && styles.sendDisabled,
              ]}>
              {sending
                ? <ActivityIndicator size="small" color="white" />
                : <Icon name="arrow-up" size={20} color="white" />}
            </Pressable>
          </View>
          <Text style={styles.sendingLine}>
            Sending from {conversation.line}
          </Text>
        </View>
        <Modal
          visible={showProfile}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowProfile(false)}>
          <SafeAreaView style={styles.profilePage}>
            <View style={styles.profileHeader}>
              <Text style={styles.profileHeaderTitle}>Contact details</Text>
              <Pressable onPress={() => setShowProfile(false)} hitSlop={12}>
                <Icon name="close" size={27} color={colors.navy} />
              </Pressable>
            </View>
            {profileLoading ? (
              <View style={styles.center}><ActivityIndicator color={colors.navy} /></View>
            ) : profile ? (
              <View style={styles.profileContent}>
                <View style={styles.profileAvatar}>
                  <Text style={styles.profileAvatarText}>
                    {profile.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.profileName}>{profile.name}</Text>
                <Text style={styles.profileRole}>
                  {[profile.title, profile.company].filter(Boolean).join(' · ')}
                </Text>
                <View style={styles.profileActions}>
                  <Pressable onPress={onCall} style={styles.profileAction}>
                    <Icon name="call" size={20} color="white" />
                    <Text style={styles.profileActionText}>Call</Text>
                  </Pressable>
                </View>
                {[
                  ['Phone', profile.phone],
                  ['Email', profile.email],
                  ['Location', [profile.city, profile.area].filter((item, index, all) => item && all.indexOf(item) === index).join(' · ')],
                  ['Status', profile.status],
                ].filter(([, value]) => value).map(([label, value]) => (
                  <View key={label} style={styles.profileRow}>
                    <Text style={styles.profileLabel}>{label}</Text>
                    <Text style={styles.profileValue}>{value}</Text>
                  </View>
                ))}
                {profile.details.map(detail => (
                  <View key={detail} style={styles.profileDetail}>
                    <Icon name="information-circle-outline" size={18} color={colors.gold} />
                    <Text style={styles.profileDetailText}>{detail}</Text>
                  </View>
                ))}
                {!!profile.notes && (
                  <View style={styles.profileNotes}>
                    <Text style={styles.profileLabel}>CRM CONTEXT</Text>
                    <Text style={styles.profileNotesText}>{profile.notes}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.center}>
                <Text style={styles.emptyTitle}>No linked CRM profile yet</Text>
                <Text style={styles.emptyCopy}>The phone conversation is still available.</Text>
              </View>
            )}
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Segment({label, selected, onPress}: {label: string; selected: boolean; onPress: () => void}) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentItem, selected && styles.segmentSelected]}>
      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#FFFFFF'},
  threadPage: {flex: 1, backgroundColor: '#F7F7F5'},
  header: {height: 62, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DDE1E6'},
  title: {fontSize: 30, fontWeight: '700', color: colors.navy, letterSpacing: -0.8},
  headerAction: {fontSize: 16, color: colors.navy},
  segment: {margin: 12, padding: 3, borderRadius: 10, backgroundColor: '#F0F1F2', flexDirection: 'row'},
  segmentItem: {flex: 1, minHeight: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8},
  segmentSelected: {backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: {width: 0, height: 1}},
  segmentText: {fontSize: 14, fontWeight: '600', color: '#697383'},
  segmentTextSelected: {color: colors.navy},
  lineList: {paddingHorizontal: 14, paddingBottom: 10, gap: 7},
  linePill: {height: 32, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 16, borderWidth: 1, borderColor: '#D9DDE2'},
  linePillSelected: {backgroundColor: colors.navy, borderColor: colors.navy},
  lineText: {fontSize: 13, color: '#596474'},
  lineTextSelected: {color: '#FFFFFF'},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32},
  emptyTitle: {fontSize: 18, fontWeight: '600', color: colors.navy, marginBottom: 6},
  emptyCopy: {fontSize: 15, lineHeight: 21, textAlign: 'center', color: '#6C7582'},
  retryButton: {marginTop: 16, paddingHorizontal: 18, height: 42, borderRadius: 21, backgroundColor: colors.navy, justifyContent: 'center'},
  retryText: {color: '#FFFFFF', fontWeight: '600'},
  row: {minHeight: 82, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', backgroundColor: '#FFFFFF'},
  rowPressed: {backgroundColor: '#F4F5F6'},
  avatar: {height: 54, width: 54, borderRadius: 27, backgroundColor: '#E9ECEF', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  avatarText: {fontSize: 19, fontWeight: '600', color: colors.navy},
  rowBody: {flex: 1, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DDE1E6'},
  rowTop: {flexDirection: 'row', alignItems: 'center'},
  name: {flex: 1, fontSize: 17, fontWeight: '600', color: colors.navy},
  time: {fontSize: 13, color: '#818A97'},
  subtitle: {fontSize: 13, color: '#7A8492', marginTop: 2},
  previewRow: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  preview: {flex: 1, fontSize: 15, color: '#687281'},
  unreadDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: colors.navy, marginLeft: 8},
  threadHeader: {height: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D8DCE1'},
  back: {fontSize: 40, lineHeight: 40, width: 34, color: colors.navy, fontWeight: '300'},
  threadIdentity: {flex: 1, alignItems: 'center'},
  threadName: {fontSize: 16, fontWeight: '600', color: colors.navy},
  threadLine: {fontSize: 12, color: '#77818F', marginTop: 1},
  callAction: {width: 42, textAlign: 'right', fontSize: 16, fontWeight: '600', color: colors.navy},
  messageList: {paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12},
  messageTime: {alignSelf: 'center', fontSize: 11, color: '#8A929E', marginVertical: 10},
  bubble: {maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, marginVertical: 2},
  inbound: {alignSelf: 'flex-start', backgroundColor: '#E7E8EA', borderBottomLeftRadius: 5},
  outbound: {alignSelf: 'flex-end', backgroundColor: colors.navy, borderBottomRightRadius: 5},
  messageText: {fontSize: 16, lineHeight: 21, color: '#1E2733'},
  outboundText: {color: '#FFFFFF'},
  inlineError: {marginHorizontal: 12, marginBottom: 7, borderRadius: 9, backgroundColor: '#ECEDEE', paddingHorizontal: 12, paddingVertical: 8},
  inlineErrorText: {fontSize: 13, color: '#48515E', textAlign: 'center'},
  composerWrap: {backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 5, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#D8DCE1'},
  attachmentChip: {height: 38, maxWidth: '90%', alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#ECEEF1', paddingHorizontal: 10, marginBottom: 7},
  attachmentName: {maxWidth: 230, fontSize: 13, fontWeight: '600', color: colors.navy},
  composer: {minHeight: 42, maxHeight: 124, borderRadius: 21, borderWidth: 1, borderColor: '#CBD0D6', flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 3, paddingRight: 4, paddingVertical: 3},
  attachButton: {width: 38, height: 38, alignItems: 'center', justifyContent: 'center'},
  composerInput: {flex: 1, minHeight: 34, maxHeight: 112, fontSize: 16, lineHeight: 21, color: colors.navy, paddingTop: 7, paddingBottom: 6},
  send: {height: 34, width: 34, borderRadius: 17, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center'},
  sendDisabled: {backgroundColor: '#C7CCD2'},
  sendText: {fontSize: 22, lineHeight: 25, fontWeight: '700', color: '#FFFFFF'},
  sendingLine: {fontSize: 10, color: '#89919D', textAlign: 'center', marginTop: 4},
  profilePage: {flex: 1, backgroundColor: '#F7F7F5'},
  profileHeader: {height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D8DCE1', backgroundColor: 'white'},
  profileHeaderTitle: {fontSize: 18, fontWeight: '700', color: colors.navy},
  profileContent: {padding: 22},
  profileAvatar: {width: 72, height: 72, borderRadius: 36, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy},
  profileAvatarText: {fontSize: 28, fontWeight: '700', color: 'white'},
  profileName: {fontSize: 25, fontWeight: '700', color: colors.navy, textAlign: 'center', marginTop: 14},
  profileRole: {fontSize: 14, lineHeight: 20, color: '#6D7785', textAlign: 'center', marginTop: 4},
  profileActions: {alignItems: 'center', marginVertical: 18},
  profileAction: {height: 42, paddingHorizontal: 18, borderRadius: 21, backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', gap: 7},
  profileActionText: {fontSize: 14, fontWeight: '700', color: 'white'},
  profileRow: {minHeight: 50, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#D8DCE1'},
  profileLabel: {width: 88, fontSize: 11, letterSpacing: 1.1, fontWeight: '700', color: '#7A8492'},
  profileValue: {flex: 1, fontSize: 15, color: colors.navy, textAlign: 'right'},
  profileDetail: {flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12},
  profileDetailText: {flex: 1, fontSize: 14, color: '#536070'},
  profileNotes: {borderRadius: 15, backgroundColor: 'white', borderWidth: 1, borderColor: '#D8DCE1', padding: 15, marginTop: 20},
  profileNotesText: {fontSize: 14, lineHeight: 21, color: '#3E4957', marginTop: 9},
});
