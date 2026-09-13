import type { ReactNode } from 'react'
import './chrome.css'

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="tour-shell">{children}</div>
}

export function BottomSheet({
  children,
  title,
  subtitle,
  className = '',
}: {
  children: ReactNode
  title?: string
  subtitle?: string
  className?: string
}) {
  return (
    <div className={`tour-sheet ${className}`.trim()}>
      <div className="tour-sheet-handle" aria-hidden />
      {(title || subtitle) && (
        <header className="tour-sheet-head">
          {title && <h2>{title}</h2>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      <div className="tour-sheet-body">{children}</div>
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  variant = 'primary',
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  variant?: 'primary' | 'ghost' | 'teal' | 'light'
  className?: string
}) {
  return (
    <button
      type={type}
      className={`tour-btn tour-btn--${variant} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export function BackChip({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="tour-back" onClick={onClick} aria-label={label}>
      ←
    </button>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="tour-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function PropertyHeroCard({
  image,
  title,
  meta,
  cta,
  onCta,
  badge,
}: {
  image: string
  title: string
  meta?: string
  cta?: string
  onCta?: () => void
  badge?: string
}) {
  return (
    <article className="prop-card">
      <div className="prop-card-media" style={{ backgroundImage: `url(${image})` }}>
        <div className="prop-card-scrim" />
        {badge && <span className="prop-badge">{badge}</span>}
        <div className="prop-card-copy">
          <h3>{title}</h3>
          {meta && <p>{meta}</p>}
          {cta && onCta && (
            <button type="button" className="prop-cta" onClick={onCta}>
              {cta}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
