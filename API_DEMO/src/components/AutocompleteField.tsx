import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type AutocompleteOption = {
  id: string
  label: string
  hint?: string
  searchText?: string
}

type Props = {
  label: string
  value: string
  options: AutocompleteOption[]
  placeholder?: string
  disabled?: boolean
  emptyText?: string
  onChange: (id: string) => void
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function scoreOption(option: AutocompleteOption, query: string) {
  const q = normalize(query)
  if (!q) return 1
  const hay = normalize(`${option.label} ${option.hint || ''} ${option.searchText || ''}`)
  if (hay === q) return 100
  if (hay.startsWith(q)) return 80
  if (hay.includes(` ${q}`)) return 60
  if (hay.includes(q)) return 50
  // Prefix of any word: "came" → "Cameron Crossing"
  const words = hay.split(' ').filter(Boolean)
  if (words.some((w) => w.startsWith(q))) return 45
  const tokens = q.split(' ').filter(Boolean)
  if (tokens.length && tokens.every((t) => hay.includes(t) || words.some((w) => w.startsWith(t)))) return 30
  return 0
}

export function AutocompleteField({
  label,
  value,
  options,
  placeholder = 'Type to search…',
  disabled,
  emptyText = 'No matches',
  onChange,
}: Props) {
  const listId = useId()
  const wrapRef = useRef<HTMLLabelElement>(null)
  const selected = options.find((o) => o.id === value) ?? null
  const [text, setText] = useState(selected?.label ?? '')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setText(selected?.label ?? '')
  }, [selected?.id, selected?.label, value])

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const LIST_LIMIT = 200

  const filtered = useMemo(() => {
    const browsing =
      !normalize(text) || (selected && normalize(text) === normalize(selected.label))
    if (browsing) {
      return options.slice(0, LIST_LIMIT)
    }
    return options
      .map((option) => ({ option, score: scoreOption(option, text) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label))
      .slice(0, LIST_LIMIT)
      .map((row) => row.option)
  }, [options, text, selected])

  useEffect(() => {
    setActiveIndex(0)
  }, [text, open])

  function pick(option: AutocompleteOption) {
    setText(option.label)
    setOpen(false)
    onChange(option.id)
  }

  function clear() {
    setText('')
    setOpen(true)
    onChange('')
  }

  return (
    <label className={`demo-ac${disabled ? ' is-disabled' : ''}`} ref={wrapRef}>
      <span>{label}</span>
      <div className="demo-ac__box">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            if (!disabled) setOpen(true)
          }}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            if (!e.target.value) onChange('')
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
              setOpen(true)
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const hit = filtered[activeIndex]
              if (hit) pick(hit)
            } else if (e.key === 'Escape') {
              setOpen(false)
              setText(selected?.label ?? '')
            }
          }}
        />
        {value || text ? (
          <button type="button" className="demo-ac__clear" aria-label={`Clear ${label}`} onClick={clear} disabled={disabled}>
            ×
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <ul id={listId} className="demo-ac__list" role="listbox">
          {filtered.length ? (
            <>
              {filtered.map((option, index) => (
                <li key={option.id} role="option" aria-selected={option.id === value}>
                  <button
                    type="button"
                    className={index === activeIndex || option.id === value ? 'is-active' : ''}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pick(option)}
                  >
                    <strong>{option.label}</strong>
                    {option.hint ? <span>{option.hint}</span> : null}
                  </button>
                </li>
              ))}
              {!normalize(text) && options.length > filtered.length ? (
                <li className="demo-ac__empty">
                  Showing {filtered.length} of {options.length} — type to narrow
                </li>
              ) : null}
            </>
          ) : (
            <li className="demo-ac__empty">{emptyText}</li>
          )}
        </ul>
      ) : null}
    </label>
  )
}
