import {API_BASE_URL} from './config';

export type StaffUser = {
  id: string;
  email?: string;
  name: string;
  role: string;
  branch?: string | null;
};

export type VoiceToken = {
  token: string;
  identity: string;
  repName: string;
  expiresAt: string;
};

export type DirectoryEntry = {
  id: string;
  label: string;
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
};

export type ConversationMessage = {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
};

async function request<T>(
  path: string,
  options: RequestInit & {token?: string} = {},
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
          ? {'Content-Type': 'application/json'}
          : {}),
        ...(options.token
          ? {Authorization: `Bearer ${options.token}`}
          : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Saturn Star took too long to respond. Check your connection and try again.');
    }
    throw new Error('You appear to be offline. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `Saturn Star request failed (${response.status})`);
  }
  return payload;
}

export function signIn(password: string) {
  return request<{token: string; user: StaffUser}>('/api/mobile/auth/login', {
    method: 'POST',
    body: JSON.stringify({password}),
  });
}

export function loadMe(token: string) {
  return request<{user: StaffUser}>('/api/mobile/auth/me', {token});
}

export function loadVoiceToken(token: string) {
  return request<VoiceToken>('/api/sales/dialer/token', {token});
}

export function loadPhoneLines(token: string) {
  return request<{lines: PhoneLine[]}>('/api/mobile/lines', {token});
}

export function resolveSuggestedLine(token: string, phone: string) {
  const query = new URLSearchParams({phone});
  return request<{line: PhoneLine; reason: string}>(
    `/api/mobile/caller-id?${query}`,
    {token},
  );
}

export function loadConversations(
  token: string,
  workspace: 'sales' | 'partnership',
  line?: string,
) {
  const query = new URLSearchParams({workspace});
  if (line) query.set('line', line);
  return request<{conversations: Conversation[]; lines: PhoneLine[]}>(
    `/api/mobile/conversations?${query}`,
    {token},
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
  return request<{messages: ConversationMessage[]}>(
    `/api/mobile/conversations/${encodeURIComponent(conversation.id)}?${query}`,
    {token},
  );
}

export function sendConversationMessage(
  token: string,
  conversation: Conversation,
  body: string,
  mediaUrls: string[] = [],
) {
  if (conversation.workspace === 'partnership') {
    return request<{ok: boolean}>(
      `/api/marketing/contacts/${encodeURIComponent(conversation.id)}/send-reply`,
      {
        method: 'POST',
        token,
        body: JSON.stringify({
          body,
          from_number: conversation.line,
          media_urls: mediaUrls,
        }),
      },
    );
  }
  return request<{ok: boolean}>('/api/sales/send', {
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
  });
}

export async function uploadMessageMedia(
  token: string,
  file: {uri: string; name: string; type: string},
) {
  const form = new FormData();
  form.append('file', file as unknown as Blob);
  return request<{url: string; name: string; type: string}>(
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
  return request<{entries: DirectoryEntry[]}>(
    '/api/sales/dialer/internal-directory',
    {token},
  );
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
