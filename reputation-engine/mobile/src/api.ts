import { API_BASE_URL } from './config';

export type StaffUser = {
  id: string;
  email?: string;
  name: string;
  role: string;
  branch?: string | null;
};

export type MobileContact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  stage: string;
  branch: string;
  route: string;
  moveDate: string;
  assignedRep: string;
  quoteStatus: string;
  nextAction: string;
};

export type VoiceToken = {
  token: string;
  identity: string;
  repName: string;
  expiresAt: string;
  pushConfigured: boolean;
};

export type MobileCallLog = {
  id: string;
  leadId: string;
  name: string;
  phone: string;
  date: string;
  direction: 'inbound' | 'outbound';
  duration: string;
  answered: boolean;
  repName: string;
  branchNumber: string;
  recordingAvailable: boolean;
  transcriptAvailable: boolean;
  notes: string;
};

export type DirectoryEntry = {
  id: string;
  userId?: string;
  label: string;
  role?: string | null;
  target: string;
  status: string;
  kind: string;
};

export type PhoneLine = {
  number: string;
  label: string;
  workspace: 'sales' | 'partnership';
  branch: string;
};

export type Conversation = {
  id: string;
  workspace: 'sales' | 'partnership';
  name: string;
  subtitle: string;
  phone: string;
  line: string;
  lastMessage: string;
  lastAt: string;
  lastDirection: 'inbound' | 'outbound';
  unreadCount: number;
  city?: string;
  status?: string;
  needsReply?: boolean;
  responded?: boolean;
  activePartner?: boolean;
};

export type ConversationMessage = {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
};

export type ContactProfile = {
  id: string;
  workspace: 'sales' | 'partnership';
  name: string;
  phone: string;
  email: string;
  company: string;
  title: string;
  city: string;
  area: string;
  status: string;
  notes: string;
  details: string[];
  quoteStatus?: string;
  nextAction?: string;
};

type CacheEntry<T> = {
  value?: T;
  updatedAt?: number;
  inflight?: Promise<T>;
};

const responseCache = new Map<string, CacheEntry<unknown>>();

function cacheKey(token: string, path: string) {
  // Tokens keep data from different staff sessions isolated without retaining
  // additional identity information in memory.
  return `${token}:${path}`;
}

function peekCached<T>(token: string, path: string) {
  return responseCache.get(cacheKey(token, path))?.value as T | undefined;
}

function invalidateCached(token: string, pathPrefix: string) {
  const prefix = cacheKey(token, pathPrefix);
  for (const key of Array.from(responseCache.keys())) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

export function clearMobileCaches(token: string) {
  const prefix = `${token}:`;
  for (const key of Array.from(responseCache.keys())) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

async function cachedRequest<T>(
  token: string,
  path: string,
  maxAgeMs: number,
) {
  const key = cacheKey(token, path);
  const cached = responseCache.get(key) as CacheEntry<T> | undefined;
  if (
    cached?.value !== undefined &&
    cached.updatedAt &&
    Date.now() - cached.updatedAt < maxAgeMs
  ) {
    return cached.value;
  }
  if (cached?.inflight) return cached.inflight;

  const entry: CacheEntry<T> = cached || {};
  const inflight = request<T>(path, { token })
    .then(value => {
      entry.value = value;
      entry.updatedAt = Date.now();
      return value;
    })
    .finally(() => {
      entry.inflight = undefined;
    });
  entry.inflight = inflight;
  responseCache.set(key, entry);
  return inflight;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        'Saturn Star took too long to respond. Check your connection and try again.',
      );
    }
    throw new Error(
      'You appear to be offline. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error || `Saturn Star request failed (${response.status})`,
    );
  }
  return payload;
}

export function signIn(email: string, password: string) {
  return request<{ token: string; user: StaffUser }>('/api/mobile/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function loadMe(token: string) {
  return request<{ user: StaffUser }>('/api/mobile/auth/me', { token });
}

export function loadVoiceToken(token: string) {
  return request<VoiceToken>('/api/sales/dialer/token', { token });
}

export function postMobilePresence(
  token: string,
  payload: {
    state: 'registering' | 'ready' | 'busy' | 'incoming' | 'offline';
    timestamp: string;
    sessionId: string;
    identity: string;
    deviceState: string;
    platform: 'mobile';
    os: string;
    online: boolean;
  },
) {
  return request<{ ok: boolean }>('/api/sales/dialer/events', {
    method: 'POST',
    token,
    body: JSON.stringify({ kind: 'presence', payload }),
  });
}

export function postMobileEvent(
  token: string,
  payload: {
    event: string;
    timestamp: string;
    sessionId?: string;
    identity?: string | null;
    callSid?: string;
    callDirection?: 'inbound' | 'outbound';
    phoneNumber?: string;
    deviceState?: string | null;
    errorMessage?: string | null;
    platform: 'mobile';
    os: string;
    online: boolean;
    extra?: Record<string, unknown>;
  },
) {
  return request<{ ok: boolean }>('/api/sales/dialer/events', {
    method: 'POST',
    token,
    body: JSON.stringify({ kind: 'event', payload }),
  });
}

export function loadPhoneLines(token: string) {
  return request<{ lines: PhoneLine[] }>('/api/mobile/lines', { token });
}

export function resolveSuggestedLine(token: string, phone: string) {
  const query = new URLSearchParams({ phone });
  return request<{ line: PhoneLine; reason: string }>(
    `/api/mobile/caller-id?${query}`,
    { token },
  );
}

export function loadConversations(
  token: string,
  workspace: 'sales' | 'partnership',
  line?: string,
  search?: string,
) {
  const query = new URLSearchParams({ workspace });
  if (line) query.set('line', line);
  if (search?.trim()) query.set('q', search.trim());
  return cachedRequest<{ conversations: Conversation[]; lines: PhoneLine[] }>(
    token,
    `/api/mobile/conversations?${query}`,
    10_000,
  );
}

export function peekConversations(
  token: string,
  workspace: 'sales' | 'partnership',
  line?: string,
  search?: string,
) {
  const query = new URLSearchParams({ workspace });
  if (line) query.set('line', line);
  if (search?.trim()) query.set('q', search.trim());
  return peekCached<{ conversations: Conversation[]; lines: PhoneLine[] }>(
    token,
    `/api/mobile/conversations?${query}`,
  );
}

export function loadConversationMessages(
  token: string,
  conversation: Conversation,
) {
  const query = new URLSearchParams({
    workspace: conversation.workspace,
    line: conversation.line,
  });
  return request<{ messages: ConversationMessage[] }>(
    `/api/mobile/conversations/${encodeURIComponent(conversation.id)}?${query}`,
    { token },
  );
}

export function loadContactProfile(token: string, conversation: Conversation) {
  const query = new URLSearchParams({
    workspace: conversation.workspace,
    id: conversation.id,
    phone: conversation.phone,
  });
  return request<{ profile: ContactProfile | null }>(
    `/api/mobile/contact-profile?${query}`,
    { token },
  );
}

export function sendConversationMessage(
  token: string,
  conversation: Conversation,
  body: string,
  mediaUrls: string[] = [],
) {
  if (conversation.workspace === 'partnership') {
    return request<{ ok: boolean }>(
      `/api/marketing/contacts/${encodeURIComponent(
        conversation.id,
      )}/send-reply`,
      {
        method: 'POST',
        token,
        body: JSON.stringify({
          body,
          from_number: conversation.line,
          media_urls: mediaUrls,
        }),
      },
    ).then(result => {
      invalidateCached(token, '/api/mobile/conversations?');
      return result;
    });
  }
  return request<{ ok: boolean }>('/api/sales/send', {
    method: 'POST',
    token,
    body: JSON.stringify({
      channel: 'sms',
      to: conversation.phone,
      body,
      fromNumber: conversation.line,
      mediaUrls,
      actor: 'human',
    }),
  }).then(result => {
    invalidateCached(token, '/api/mobile/conversations?');
    return result;
  });
}

export async function uploadMessageMedia(
  token: string,
  file: { uri: string; name: string; type: string },
) {
  const form = new FormData();
  form.append('file', file as unknown as Blob);
  return request<{ url: string; name: string; type: string }>(
    '/api/mobile/upload-media',
    {
      method: 'POST',
      token,
      body: form,
      headers: {},
    },
  );
}

export function loadDirectory(token: string) {
  return request<{ entries: DirectoryEntry[] }>(
    '/api/sales/dialer/internal-directory',
    { token },
  );
}

export function loadCallQueue(token: string) {
  return request<{ size: number; queueSid: string | null }>(
    '/api/sales/dialer/queue',
    { token },
  );
}

export function acceptNextQueuedCall(token: string, identity: string) {
  return request<{
    ok: boolean;
    message?: string;
    identity?: string;
    rerouted?: boolean;
  }>('/api/sales/dialer/queue', {
    method: 'POST',
    token,
    body: JSON.stringify({ identity }),
  });
}

export function loadMobileContacts(token: string, query = '') {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.toString() ? `?${params}` : '';
  return cachedRequest<{ contacts: MobileContact[] }>(
    token,
    `/api/mobile/contacts${suffix}`,
    query.trim() ? 5_000 : 30_000,
  );
}

export function peekMobileContacts(token: string, query = '') {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.toString() ? `?${params}` : '';
  return peekCached<{ contacts: MobileContact[] }>(
    token,
    `/api/mobile/contacts${suffix}`,
  );
}

export function logMobileCall(
  token: string,
  body: {
    phone: string;
    direction: 'inbound' | 'outbound';
    durationSeconds: number;
    callSid?: string;
    branchNumber?: string;
    notes?: string;
    answered: boolean;
    disposition?: string;
    followUpDate?: string;
  },
) {
  return request<{ ok: boolean; leadId?: string; matched: boolean }>(
    '/api/mobile/calls',
    { method: 'POST', token, body: JSON.stringify(body) },
  ).then(result => {
    invalidateCached(token, '/api/mobile/calls');
    return result;
  });
}

export function loadMobileCalls(token: string) {
  return cachedRequest<{ calls: MobileCallLog[] }>(
    token,
    '/api/mobile/calls',
    15_000,
  );
}

export function peekMobileCalls(token: string) {
  return peekCached<{ calls: MobileCallLog[] }>(token, '/api/mobile/calls');
}

export function prefetchPhoneTabs(token: string, includePartnership: boolean) {
  const requests: Array<Promise<unknown>> = [
    loadMobileCalls(token),
    loadMobileContacts(token),
    loadConversations(token, 'sales'),
  ];
  if (includePartnership) requests.push(loadConversations(token, 'partnership'));
  return Promise.allSettled(requests);
}

export function controlConference(
  token: string,
  body: Record<string, string | boolean | null | undefined>,
) {
  return request<{
    ok: boolean;
    conferenceName?: string;
    customerCallSid?: string;
    repCallSid?: string;
    targetCallSid?: string | null;
    mode?: string;
  }>('/api/sales/dialer/conference', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}
