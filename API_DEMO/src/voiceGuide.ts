import { useEffect, useRef, useState } from 'react'

export type SpeakStep = {
  id: string
  instruction: string
  distanceM?: number | null
}

const STORAGE = 'keiros-voice'

let sessionUnlocked = false
let pendingText: string | null = null
let resumeTimer: number | null = null

export function voicePreferenceOn() {
  try {
    return localStorage.getItem(STORAGE) !== 'off'
  } catch {
    return true
  }
}

export function rememberVoice(on: boolean) {
  try {
    localStorage.setItem(STORAGE, on ? 'on' : 'off')
  } catch {
    /* private mode */
  }
}

export function isVoiceUnlocked() {
  return sessionUnlocked
}

export function primeVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.getVoices()
  try {
    window.speechSynthesis.resume()
  } catch {
    /* ignore */
  }
}

/**
 * Must run inside a click/tap handler. Mobile Safari/Chrome block speech until then.
 */
export function unlockVoiceFromGesture() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false
  const synth = window.speechSynthesis
  try {
    synth.resume()
  } catch {
    /* ignore */
  }
  // Silent (near-silent) utterance unlocks the audio session on iOS/Android.
  const unlock = new SpeechSynthesisUtterance(' ')
  unlock.volume = 0.01
  unlock.rate = 1.2
  unlock.lang = 'en-US'
  try {
    synth.cancel()
    synth.speak(unlock)
  } catch {
    /* ignore */
  }
  sessionUnlocked = true
  if (pendingText) {
    const text = pendingText
    pendingText = null
    window.setTimeout(() => speakDirection(text, { force: true }), 120)
  }
  return true
}

export function stopVoice() {
  if (resumeTimer != null) {
    window.clearInterval(resumeTimer)
    resumeTimer = null
  }
  window.speechSynthesis?.cancel()
}

/**
 * Google Maps–style: one short line for the current step only.
 * Do not stack “then / follow this for / next maneuver” in the same utterance.
 */
export function spokenCue(current: SpeakStep, _upcoming?: SpeakStep | null) {
  const line = shortenForVoice(current.instruction)
  if (!line) return ''
  const dist = approachingDistance(current.distanceM)
  if (dist && !/^(in |after |you have arrived|arrived|park here)/i.test(line)) {
    return `${dist}, ${lowerFirst(line)}`
  }
  return capitalize(line)
}

export function speakDirection(text: string, opts?: { force?: boolean }) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const trimmed = text.trim()
  if (!trimmed) return

  // Without a prior tap, queue the line until unlockVoiceFromGesture runs.
  if (!sessionUnlocked && !opts?.force) {
    pendingText = trimmed
    return
  }

  const synth = window.speechSynthesis
  try {
    synth.resume()
  } catch {
    /* ignore */
  }

  const utterance = new SpeechSynthesisUtterance(trimmed)
  utterance.rate = 1.05
  utterance.pitch = 1
  utterance.lang = preferredLang()
  utterance.volume = 1
  const voice = chooseVoice()
  if (voice) utterance.voice = voice

  if (resumeTimer != null) {
    window.clearInterval(resumeTimer)
    resumeTimer = null
  }

  // iOS Safari often pauses mid-utterance unless resume() is poked.
  resumeTimer = window.setInterval(() => {
    if (!synth.speaking) {
      if (resumeTimer != null) window.clearInterval(resumeTimer)
      resumeTimer = null
      return
    }
    try {
      synth.resume()
    } catch {
      /* ignore */
    }
  }, 8000)

  utterance.onend = () => {
    if (resumeTimer != null) {
      window.clearInterval(resumeTimer)
      resumeTimer = null
    }
  }
  utterance.onerror = () => {
    if (resumeTimer != null) {
      window.clearInterval(resumeTimer)
      resumeTimer = null
    }
  }

  synth.cancel()
  // Brief delay after cancel helps iOS actually start the next utterance.
  window.setTimeout(() => {
    try {
      synth.speak(utterance)
      synth.resume()
    } catch {
      /* ignore */
    }
  }, 60)
}

export function useDirectionVoice(current: SpeakStep | null, upcoming: SpeakStep | null) {
  const [on, setOn] = useState(voicePreferenceOn)
  const [unlocked, setUnlocked] = useState(sessionUnlocked)
  const upcomingRef = useRef(upcoming)
  const currentRef = useRef(current)
  upcomingRef.current = upcoming
  currentRef.current = current
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => {
    primeVoice()
    const synth = window.speechSynthesis
    if (!synth) return
    const refresh = () => chooseVoice()
    synth.addEventListener('voiceschanged', refresh)
    // Warm voices list (async on many phones)
    window.setTimeout(() => synth.getVoices(), 250)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [])

  useEffect(() => {
    if (!supported) return
    if (sessionUnlocked) setUnlocked(true)
    if (!on || !current) {
      stopVoice()
      return
    }
    // Auto-speak only after this browser session was unlocked by a tap (e.g. Navigate).
    speakDirection(spokenCue(current, upcomingRef.current))
    return () => stopVoice()
  }, [current?.id, on, supported])

  function toggle() {
    setOn((value) => {
      const next = !value
      rememberVoice(next)
      if (next) {
        unlockVoiceFromGesture()
        setUnlocked(true)
        const step = currentRef.current
        if (step) {
          speakDirection(spokenCue(step, upcomingRef.current), { force: true })
        }
      } else {
        stopVoice()
        pendingText = null
      }
      return next
    })
  }

  function replay() {
    const step = currentRef.current
    if (!on || !step) return
    unlockVoiceFromGesture()
    setUnlocked(true)
    speakDirection(spokenCue(step, upcomingRef.current), { force: true })
  }

  /** Call from Navigate / other primary buttons so the first cue can play. */
  function unlockFromUi() {
    unlockVoiceFromGesture()
    setUnlocked(true)
  }

  return { on, supported, unlocked, toggle, replay, unlockFromUi }
}

function preferredLang() {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  if (/^en/i.test(nav)) return nav
  return 'en-US'
}

function chooseVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? []
  if (!voices.length) return null
  const lang = preferredLang().slice(0, 2).toLowerCase()
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith(lang) || /^en/i.test(voice.lang))
  const pool = english.length ? english : voices
  // Prefer on-device voices — remote voices often fail silently on phones.
  const local = pool.filter((voice) => (voice as SpeechSynthesisVoice & { localService?: boolean }).localService !== false)
  const candidates = local.length ? local : pool
  const ranked = [
    /samantha/i,
    /google us english/i,
    /google uk english female/i,
    /enhanced/i,
    /premium/i,
    /aria/i,
    /jenny/i,
    /natural/i,
    /siri/i,
    /zira/i,
  ]
  for (const pattern of ranked) {
    const hit = candidates.find((voice) => pattern.test(voice.name) && !/male|david|daniel/i.test(voice.name))
    if (hit) return hit
  }
  return candidates.find((voice) => !/david|male|daniel/i.test(voice.name)) ?? candidates[0] ?? null
}

/** Compress long ERP / OSRM lines into a single Google-like cue. */
function shortenForVoice(instruction: string) {
  let text = instruction.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/[—–]/g, ' ').trim()
  // One clause only — drop everything after the first sentence break.
  text = (text.split(/[.!?]/)[0] || text).trim()

  const swaps: Array<[RegExp, string]> = [
    [/^Start driving toward\s+/i, 'Head toward '],
    [/^Start driving onto\s+/i, 'Head onto '],
    [/^Start driving\b.*$/i, 'Continue straight'],
    [/^Depart via\s+/i, 'Head out on '],
    [/^Drive into the nearest parking.*$/i, 'Enter parking'],
    [/^Arrive at the nearest parking.*$/i, 'You have arrived at parking'],
    [/^Arrive at building entrance.*$/i, 'You have arrived'],
    [/^Park and leave the vehicle.*$/i, 'Park here'],
    [/^Leave the car and walk to the entrance.*$/i, 'Walk to the entrance'],
    [/^Leave parking and walk toward\s+/i, 'Walk toward '],
    [/^Walk toward\s+/i, 'Walk toward '],
    [/^Walk via\s+/i, 'Walk on '],
    [/^Walk along the path.*$/i, 'Continue on the path'],
    [/^Drive along the route.*$/i, 'Continue on the route'],
    [/^Continue walking.*$/i, 'Continue straight'],
    [/^Continue driving.*$/i, 'Continue straight'],
    [/^You're already at the entrance.*$/i, 'You have arrived'],
    // Indoor — keep ultra short
    [/^Enter at\s+(.+?)(?:\s+and start.*)?$/i, 'Enter $1'],
    [/^Enter building at\s+(.+?)(?:\.|$)/i, 'Enter $1'],
    [/^Take the stairs to\s+(.+)$/i, 'Stairs to $1'],
    [/^Take the elevator to\s+(.+)$/i, 'Elevator to $1'],
    [/^Take vertical access to\s+([^,]+).*$/i, 'Stairs to $1'],
    [/^Go to the stairs.*?(?:for|to)\s+(.+)$/i, 'Stairs to $1'],
    [/^Go to the elevator.*?(?:for|to)\s+(.+)$/i, 'Elevator to $1'],
    [/^Turn left and arrive at\s+/i, 'Arrive at '],
    [/^Turn right and arrive at\s+/i, 'Arrive at '],
    [/^Arrive at\s+/i, 'Arrive at '],
    [/^Continue to\s+/i, 'Continue to '],
    [/^Turn left toward\s+/i, 'Turn left to '],
    [/^Turn right toward\s+/i, 'Turn right to '],
    [/^Bear left toward\s+/i, 'Bear left to '],
    [/^Bear right toward\s+/i, 'Bear right to '],
    [/^Go to\s+/i, 'Go to '],
  ]
  for (const [pattern, replacement] of swaps) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement)
      break
    }
  }

  text = text
    .replace(/\bvisitor\s*\/\s*garage parking\b/gi, 'parking')
    .replace(/\bnearest parking\b/gi, 'parking')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()

  // Drop parenthetical meters / floor tags voice doesn't need.
  text = text
    .replace(/\s*\(\d+\s*m\)/gi, '')
    .replace(/\s*·\s*up\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Hard cap so TTS stays short (~Google cue length).
  if (text.length > 48) {
    text = text.slice(0, 48).replace(/\s+\S*$/, '').trim()
  }
  return text
}

/** Weak indoor/outdoor GPS — speak at most once per cooldown. */
let lastWeakGpsAt = 0
export function speakWeakGpsAlert(accuracyM: number, opts?: { force?: boolean }) {
  if (!Number.isFinite(accuracyM) || accuracyM < 25) return
  const now = Date.now()
  if (!opts?.force && now - lastWeakGpsAt < 45000) return
  lastWeakGpsAt = now
  const meters = Math.round(accuracyM)
  speakDirection(
    meters >= 80 ? 'GPS signal is weak' : `GPS accuracy about ${meters} meters`,
    opts,
  )
}

function capitalize(text: string) {
  const clean = text.replace(/[.\s]+$/, '')
  if (!clean) return ''
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`
}

function lowerFirst(text: string) {
  const clean = text.replace(/[.\s]+$/, '')
  if (!clean) return ''
  return `${clean.charAt(0).toLowerCase()}${clean.slice(1)}`
}

/** “In 200 meters” — only when the leg is long enough to matter. */
function approachingDistance(meters?: number | null) {
  if (meters == null || !Number.isFinite(meters) || meters < 120) return ''
  if (meters < 1000) {
    const rounded = Math.max(100, Math.round(meters / 50) * 50)
    return `In ${rounded} meters`
  }
  const miles = meters / 1609.344
  if (miles < 10) {
    const shown = miles < 1.5 ? miles.toFixed(1) : String(Math.round(miles * 2) / 2)
    return `In ${shown} miles`
  }
  return `In ${Math.round(miles)} miles`
}
