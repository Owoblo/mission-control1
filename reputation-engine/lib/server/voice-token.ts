function toBase64Url(input: string | ArrayBuffer): string {
  let str: string
  if (typeof input === 'string') {
    str = input
  } else {
    const bytes = new Uint8Array(input)
    str = Array.from(bytes, b => String.fromCharCode(b)).join('')
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function buildVoiceToken(
  accountSid: string,
  apiKeySid: string,
  apiKeySecret: string,
  twimlAppSid: string,
  identity: string,
  pushCredentialSid?: string,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600

  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' }
  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    iat: now,
    exp,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: twimlAppSid },
        ...(pushCredentialSid ? { push_credential_sid: pushCredentialSid } : {}),
      },
    },
  }

  const encodedHeader = toBase64Url(JSON.stringify(header))
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiKeySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  const encodedSig = toBase64Url(sigBytes)

  return {
    token: `${signingInput}.${encodedSig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

