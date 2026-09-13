import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './icons'
import './charts.css'

function clampPct(value: number, max = 100) {
  if (!Number.isFinite(value) || max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

function readinessHue(pct: number) {
  return Math.round(Math.max(0, Math.min(100, pct)) * 1.25)
}

type ChartBarsProps = {
  items: Array<{ label: string; value: number; hint?: string }>
  max?: number
  unit?: string
  showValues?: boolean
}

/** Labeled horizontal bar chart — used for readiness / queue / analytics. */
export function ChartBars({ items, max, unit = '%', showValues = true }: ChartBarsProps) {
  const peak = max ?? Math.max(...items.map((item) => item.value), 1)
  return (
    <div className="k-chart-bars" role="img" aria-label="Bar chart">
      {items.map((item, index) => {
        const pct = clampPct(item.value, peak)
        const hue = readinessHue(unit === '%' ? item.value : (item.value / peak) * 100)
        return (
          <div key={`${item.label}-${index}`} className="k-chart-bars__row" style={{ animationDelay: `${index * 40}ms` }}>
            <div className="k-chart-bars__meta">
              <span className="k-chart-bars__label" title={item.label}>
                {item.label}
              </span>
              {showValues ? (
                <span className="k-chart-bars__value">
                  {item.value}
                  {unit}
                </span>
              ) : null}
            </div>
            <div className="k-chart-bars__track">
              <div
                className="k-chart-bars__fill"
                style={{
                  width: `${Math.max(pct, item.value > 0 ? 4 : 0)}%`,
                  background: `linear-gradient(90deg, hsl(${hue} 78% 42%), hsl(${Math.min(125, hue + 18)} 72% 52%))`,
                }}
              />
            </div>
            {item.hint ? <span className="k-chart-bars__hint">{item.hint}</span> : null}
          </div>
        )
      })}
    </div>
  )
}

type SparklineProps = {
  values: number[]
  labels?: string[]
  tone?: 'ok' | 'warn' | 'info' | 'danger'
}

/** Compact SVG area/line sparkline. */
export function Sparkline({ values, labels, tone = 'info' }: SparklineProps) {
  if (!values.length) return <div className="k-sparkline k-sparkline--empty">No series data</div>
  const w = 320
  const h = 88
  const pad = 8
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0
  const points = values.map((v, i) => {
    const x = pad + i * step
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return `${x},${y}`
  })
  const area = `M ${pad},${h - pad} L ${points.join(' L ')} L ${pad + (values.length - 1) * step},${h - pad} Z`
  const line = `M ${points.join(' L ')}`
  return (
    <div className={`k-sparkline k-sparkline--${tone}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="k-sparkline__svg" aria-hidden>
        <path className="k-sparkline__area" d={area} />
        <path className="k-sparkline__line" d={line} />
        {values.map((v, i) => {
          const x = pad + i * step
          const y = h - pad - ((v - min) / span) * (h - pad * 2)
          return <circle key={i} cx={x} cy={y} r="2.6" className="k-sparkline__dot" />
        })}
      </svg>
      {labels?.length ? (
        <div className="k-sparkline__labels">
          {labels.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type DonutProps = {
  segments: Array<{ label: string; value: number; tone?: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }>
  centerLabel?: string
  centerValue?: string | number
}

const DONUT_COLORS: Record<string, string> = {
  ok: '#059669',
  warn: '#d97706',
  danger: '#dc2626',
  info: '#2563eb',
  neutral: '#94a3b8',
}

/** Simple SVG donut for status mix. */
export function DonutChart({ segments, centerLabel, centerValue }: DonutProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0) || 1
  const r = 42
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="k-donut">
      <div className="k-donut__visual">
        <svg viewBox="0 0 120 120" className="k-donut__svg" aria-hidden>
          <circle cx="60" cy="60" r={r} className="k-donut__track" />
          {segments.map((seg, i) => {
            const len = (Math.max(0, seg.value) / total) * c
            const dash = `${len} ${c - len}`
            const el = (
              <circle
                key={`${seg.label}-${i}`}
                cx="60"
                cy="60"
                r={r}
                className="k-donut__seg"
                stroke={DONUT_COLORS[seg.tone ?? 'neutral']}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return el
          })}
        </svg>
        <div className="k-donut__center">
          {centerValue != null ? <strong>{centerValue}</strong> : null}
          {centerLabel ? <span>{centerLabel}</span> : null}
        </div>
      </div>
      <ul className="k-donut__legend">
        {segments.map((seg) => (
          <li key={seg.label}>
            <i style={{ background: DONUT_COLORS[seg.tone ?? 'neutral'] }} />
            <span>{seg.label}</span>
            <b>{seg.value}</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

type MeterProps = {
  label: string
  value: number
  max?: number
  icon?: LucideIcon
  tone?: 'ok' | 'warn' | 'danger' | 'info'
  suffix?: string
}

/** Icon + progress meter row for work queues. */
export function ProgressMeter({ label, value, max = 100, icon, tone = 'info', suffix }: MeterProps) {
  const pct = clampPct(value, max)
  return (
    <div className={`k-meter k-meter--${tone}`}>
      <div className="k-meter__head">
        <span className="k-meter__label">
          {icon ? <Icon icon={icon} size={15} className="k-meter__icon" /> : null}
          {label}
        </span>
        <strong>
          {value}
          {suffix ? <small>{suffix}</small> : null}
        </strong>
      </div>
      <div className="k-meter__track">
        <div className="k-meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

type TrendColumnsProps = {
  values: number[]
  labels?: string[]
  unit?: string
}

/** Vertical column chart (sample-style trends). */
export function TrendColumns({ values, labels, unit = '' }: TrendColumnsProps) {
  const max = Math.max(...values, 1)
  return (
    <div className="k-trend-cols" role="img" aria-label="Column chart">
      <div className="k-trend-cols__plot">
        {values.map((value, i) => {
          const pct = clampPct(value, max)
          const hue = readinessHue((value / max) * 100)
          return (
            <div key={i} className="k-trend-cols__item" style={{ animationDelay: `${i * 30}ms` }}>
              <span className="k-trend-cols__tip">
                {value}
                {unit}
              </span>
              <div
                className="k-trend-cols__bar"
                style={{
                  height: `${Math.max(pct, value > 0 ? 6 : 0)}%`,
                  background: `linear-gradient(180deg, hsl(${hue} 78% 52%), hsl(${Math.max(0, hue - 20)} 72% 38%))`,
                }}
                title={`${labels?.[i] ?? `#${i + 1}`}: ${value}${unit}`}
              />
              {labels?.[i] ? <span className="k-trend-cols__label">{labels[i]}</span> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type IconStatProps = {
  icon: LucideIcon
  label: string
  value: ReactNode
  hint?: string
  tone?: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
}

export function IconStat({ icon, label, value, hint, tone = 'neutral' }: IconStatProps) {
  return (
    <div className={`k-icon-stat k-icon-stat--${tone}`}>
      <span className="k-icon-stat__glyph">
        <Icon icon={icon} size={18} />
      </span>
      <div className="k-icon-stat__body">
        <span className="k-icon-stat__label">{label}</span>
        <strong className="k-icon-stat__value">{value}</strong>
        {hint ? <span className="k-icon-stat__hint">{hint}</span> : null}
      </div>
    </div>
  )
}
