'use client'

import { useCallback, useEffect, useRef } from 'react'

const POLL_MS = 30_000

function playChime() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.4)
    setTimeout(() => {
      osc2(ctx)
    }, 220)
  } catch { /* audio ctx unavailable */ }
}

function osc2(ctx: AudioContext) {
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 1100
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.35)
  } catch { /* ignore */ }
}

function fireNotification(title: string, body: string, href: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      requireInteraction: true,
      tag: `saturn-${Date.now()}`,
    })
    n.onclick = () => {
      window.focus()
      window.location.href = href
      n.close()
    }
  } catch { /* ignore */ }
}

interface NotificationItem {
  id: string
  type: 'lead' | 'sms' | 'email' | 'alert'
  source?: string
  title: string
  preview: string
  time: string
  leadId: string | null
  phone: string | null
  href: string
}

export function useLeadAlerts() {
  const seenIds = useRef<Set<string>>(new Set())
  const initialized = useRef(false)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/notifications', { credentials: 'include', cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { items: NotificationItem[] }

      const urgent = data.items.filter(item => ['lead', 'sms'].includes(item.type))
      const newItems = urgent.filter(item => !seenIds.current.has(item.id))

      // Seed seen set on first load — don't fire for existing backlog
      data.items.forEach(item => seenIds.current.add(item.id))

      if (!initialized.current) {
        initialized.current = true
        return
      }

      if (newItems.length === 0) return

      playChime()

      const toShow = newItems.slice(0, 3)
      for (const item of toShow) {
        const emoji =
          item.source === 'twilio_call' ? '📞' :
          item.source === 'missed_call' ? '📵' :
          item.type === 'sms' ? '💬' :
          item.source === 'facebook_lead_ad' ? '📘' :
          item.source === 'direct_mail' ? '📬' :
          item.source === 'website_form' ? '🌐' : '🔔'
        const label =
          item.source === 'twilio_call' ? 'Incoming Call' :
          item.source === 'missed_call' ? 'Missed Call' :
          item.type === 'sms' ? 'New SMS' :
          item.source === 'facebook_lead_ad' ? 'FB Lead Ad' :
          item.source === 'direct_mail' ? 'QR / Direct Mail Lead' :
          item.source === 'website_form' ? 'Web Form Lead' : 'New Lead'

        fireNotification(
          `${emoji} ${label} — ${item.title}`,
          item.preview || 'Open Mission Control to respond',
          item.href,
        )
      }

      if (newItems.length > 3) {
        fireNotification(
          `🔔 ${newItems.length} new leads`,
          'Multiple new contacts — check your inbox',
          '/sales/inbox',
        )
      }
    } catch { /* ignore network errors during poll */ }
  }, [])

  useEffect(() => {
    // Request permission once on mount (only prompts if not yet decided)
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }

    void poll()
    const id = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(id)
  }, [poll])
}
