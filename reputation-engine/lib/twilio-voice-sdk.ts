'use client'

const SDK_URL = 'https://unpkg.com/@twilio/voice-sdk@2.11.0/dist/twilio.js'
const SCRIPT_ID = 'saturn-twilio-voice-sdk'
let sdkPromise: Promise<void> | null = null

function isReady() {
  if (typeof window === 'undefined') return false
  return Boolean((window as unknown as { Twilio?: { Device?: unknown } }).Twilio?.Device)
}

export function loadTwilioVoiceSdk(timeoutMs = 10_000) {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser voice is only available in a browser.'))
  if (isReady()) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing || document.createElement('script')
    const timeout = window.setTimeout(() => finish(new Error('Browser voice took too long to load.')), timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timeout)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }
    const finish = (error?: Error) => {
      cleanup()
      if (error) {
        sdkPromise = null
        reject(error)
      } else resolve()
    }
    const onLoad = () => finish(isReady() ? undefined : new Error('Browser voice loaded without an available calling device.'))
    const onError = () => {
      script.remove()
      finish(new Error('Browser voice could not load. Messages and customer records are still safe.'))
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (!existing) {
      script.id = SCRIPT_ID
      script.src = SDK_URL
      script.async = true
      script.dataset.twilioVoice = 'true'
      document.head.appendChild(script)
    }
  })
  return sdkPromise
}
