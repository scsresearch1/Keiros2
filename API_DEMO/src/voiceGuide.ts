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

export function spokenCue(current: SpeakStep, upcoming?: SpeakStep | null) {
  const now = soften(current.instruction)
  const next = upcoming ? soften(upcoming.instruction) : ''
  const arriving = /reached the parking|you're at the entrance|you're inside|you've arrived|park here/i.test(now)
  const span = arriving ? '' : distancePhrase(current.distanceM ?? 0)
  if (next && span) return `${finish(now)} Follow this for ${span}. Then, ${lowerFirst(next)}.`
  if (next) return `${finish(now)} Then, ${lowerFirst(next)}.`
  return finish(now)
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
  utterance.rate = 0.92
  utterance.pitch = 1.04
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

function soften(instruction: string) {
  let text = instruction.replace(/\s+/g, ' ').replace(/\s*[—–]\s*/g, '. ').trim()
  text = text.replace(/visitor\s*\/\s*garage parking/gi, 'the visitor parking')
  const swaps: Array<[RegExp, string]> = [
    [/^Start driving toward /i, "Let's head toward "],
    [/^Start driving onto /i, "Let's head onto "],
    [/^Start driving\b/i, "Let's get going"],
    [/^Depart via /i, "Let's head out via "],
    [/^Arrive at the nearest parking\. leave the car here\.?$/i, "You've reached the parking. You can leave the car here"],
    [/^Arrive at building entrance\. continue inside\.?$/i, "You're at the entrance. We'll continue inside"],
    [/^Park and leave the vehicle\. walk the rest of the way\.?$/i, "Park here, and we'll walk the rest of the way"],
    [/^Leave the car and walk to the entrance\.?$/i, 'Leave the car, and walk over to the entrance'],
    [/^Leave parking and walk toward /i, 'From the parking, walk toward '],
    [/^Drive into the nearest parking and leave the car\.?$/i, 'Drive into the nearest parking, and leave the car there'],
    [/^Enter building at (.+?)\. indoor navigation$/i, "You're inside. Head toward $1"],
    [/^Take vertical access to ([^,]+), then to (.+)$/i, 'Take the stairs or elevator to $1, then continue to $2'],
    [/^Go to /i, 'Continue to '],
    [/^Arrive at /i, "You've arrived at "],
  ]
  for (const [pattern, replacement] of swaps) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement)
      break
    }
  }
  return text.replace(/\s+\./g, '.').replace(/\.+/g, '.').replace(/\.\s*\./g, '.').trim()
}

function finish(text: string) {
  const clean = text.replace(/[.\s]+$/, '')
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}.`
}

function lowerFirst(text: string) {
  const clean = text.replace(/[.\s]+$/, '')
  const body = /^[A-Z][a-z]/.test(clean) ? `${clean.charAt(0).toLowerCase()}${clean.slice(1)}` : clean
  return body
}

function distancePhrase(meters: number) {
  if (meters < 80) return ''
  if (meters < 950) {
    const rounded = Math.max(50, Math.round(meters / 50) * 50)
    return `about ${rounded} meters`
  }
  const miles = meters / 1609.344
  if (miles < 10) return `about ${miles < 1.25 ? miles.toFixed(1) : Math.round(miles * 2) / 2} miles`
  return `about ${Math.round(miles)} miles`
}
