import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './icons'
import { TrendColumns } from './charts'
import './primitives.css'

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

type PageHeaderProps = {
  title: string
  subtitle?: string
  actions?: ReactNode
  icon?: LucideIcon
}

export function PageHeader({ title, subtitle, actions, icon }: PageHeaderProps) {
  return (
    <header className="k-page-header">
      <div className="k-page-header__text">
        <h1>
          {icon ? <Icon icon={icon} size={22} className="k-page-header__icon" /> : null}
          {title}
        </h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="k-page-header__actions">{actions}</div> : null}
    </header>
  )
}

type KpiItem = {
  label: string
  value: string | number
  hint?: string
  tone?: Tone
  icon?: LucideIcon
}

type KpiRowProps = {
  items: KpiItem[]
}

export function KpiRow({ items }: KpiRowProps) {
  return (
    <div className="k-kpi-row">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `k-kpi k-kpi--${item.tone}` : 'k-kpi'}>
          {item.icon ? (
            <span className="k-kpi__icon">
              <Icon icon={item.icon} size={15} />
            </span>
          ) : null}
          <div className="k-kpi__label">{item.label}</div>
          <div className="k-kpi__value">{item.value}</div>
          {item.hint ? <div className="k-kpi__hint">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  )
}

type PanelProps = {
  title?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
  icon?: LucideIcon
}

export function Panel({ title, children, actions, className, icon }: PanelProps) {
  const cls = className ? `k-panel ${className}` : 'k-panel'
  return (
    <section className={cls}>
      {title || actions ? (
        <div className="k-panel__head">
          {title ? (
            <h2 className="k-panel__title">
              <span className="k-panel__title-wrap">
                {icon ? <Icon icon={icon} size={16} className="k-panel__title-icon" /> : null}
                {title}
              </span>
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="k-panel__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="k-panel__body">{children}</div>
    </section>
  )
}

type DataTableProps = {
  columns: string[]
  rows: ReactNode[][]
}

export function DataTable({ columns, rows }: DataTableProps) {
  return (
    <div className="k-table-wrap">
      <table className="k-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type BadgeProps = {
  children: ReactNode
  tone?: Tone
}

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return <span className={`k-badge k-badge--${tone}`}>{children}</span>
}

type ToolbarProps = {
  children: ReactNode
}

export function Toolbar({ children }: ToolbarProps) {
  return <div className="k-toolbar">{children}</div>
}

type ActionBarProps = {
  children: ReactNode
}

export function ActionBar({ children }: ActionBarProps) {
  return <div className="k-action-bar">{children}</div>
}

type MiniBarsProps = {
  values: number[]
  labels?: string[]
}

export function MiniBars({ values, labels }: MiniBarsProps) {
  return <TrendColumns values={values} labels={labels} />
}

type MapStageProps = {
  title?: string
  children?: ReactNode
}

export function MapStage({ title, children }: MapStageProps) {
  return (
    <div className="k-map-stage">
      {title ? <span className="k-map-stage__title">{title}</span> : null}
      <div className="k-map-stage__content">{children}</div>
    </div>
  )
}

type SplitViewProps = {
  left: ReactNode
  right: ReactNode
}

export function SplitView({ left, right }: SplitViewProps) {
  return (
    <div className="k-split">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  )
}

type FormGridProps = {
  children: ReactNode
}

export function FormGrid({ children }: FormGridProps) {
  return <div className="k-form-grid">{children}</div>
}

type FieldProps = {
  label: string
  children: ReactNode
}

export function Field({ label, children }: FieldProps) {
  return (
    <label className="k-field">
      <span className="k-field__label">{label}</span>
      <div className="k-field__control">{children}</div>
    </label>
  )
}

type EmptyHintProps = {
  text: string
}

export function EmptyHint({ text }: EmptyHintProps) {
  return <div className="k-empty">{text}</div>
}
