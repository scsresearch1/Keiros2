import { useEffect, useRef, useState } from 'react'

export type SpeakStep = {
  id: string
  instruction: string
  distanceM?: number | null
}

const STORAGE = 'keiros-voice'

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

export function primeVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  window.speechSynthesis.getVoices()
}

export function stopVoice() {
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

export function speakDirection(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const synth = window.speechSynthesis
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.92
  utterance.pitch = 1.04
  utterance.lang = 'en-US'
  const voice = chooseVoice()
  if (voice) utterance.voice = voice
  synth.cancel()
  synth.speak(utterance)
}

export function useDirectionVoice(current: SpeakStep | null, upcoming: SpeakStep | null) {
  const [on, setOn] = useState(voicePreferenceOn)
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
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [])

  useEffect(() => {
    if (!supported) return
    if (!on || !current) {
      stopVoice()
      return
    }
    speakDirection(spokenCue(current, upcomingRef.current))
    return () => stopVoice()
  }, [current?.id, on, supported])

  function toggle() {
    setOn((value) => {
      const next = !value
      rememberVoice(next)
      return next
    })
  }

  function replay() {
    const step = currentRef.current
    if (!on || !step) return
    speakDirection(spokenCue(step, upcomingRef.current))
  }

  return { on, supported, toggle, replay }
}

function chooseVoice() {
  const voices = window.speechSynthesis?.getVoices?.() ?? []
  const english = voices.filter((voice) => /^en([-_]|$)/i.test(voice.lang))
  const ranked = [/samantha/i, /google uk english female/i, /google us english/i, /aria/i, /jenny/i, /natural/i, /zira/i]
  for (const pattern of ranked) {
    const hit = english.find((voice) => pattern.test(voice.name) && !/male|david/i.test(voice.name))
    if (hit) return hit
  }
  return english.find((voice) => !/david|male/i.test(voice.name)) ?? english[0] ?? null
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
