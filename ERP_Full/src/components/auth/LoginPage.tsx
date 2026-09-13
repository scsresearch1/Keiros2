import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DEFAULT_EMAIL, DEFAULT_PASSWORD } from '../../auth/credentials'
import { firebaseSignIn, isFirebaseEnabled } from '../../firebase'
import keirosLogo from '../../assets/keiros-logo.png'
import './LoginPage.css'

type LoginPageProps = {
  onBack: () => void
  onSuccess?: (email: string) => void
  initialNotice?: 'session' | null
}

type AuthView =
  | 'login'
  | 'mfa'
  | 'forgot'
  | 'reset'
  | 'setup'
  | 'verifying'
  | 'session'
  | 'denied'
  | 'help'

type DeniedReason = 'locked' | 'inactive' | 'unauthorized'

type Banner = null | 'invalid' | 'credentials' | 'reset-ok' | 'reset-fail' | 'reset-done'

type FieldError = 'email' | 'password' | 'otp' | 'setup' | 'reset' | null

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function LoginPage({ onBack, onSuccess, initialNotice = null }: LoginPageProps) {
  const [view, setView] = useState<AuthView>(initialNotice === 'session' ? 'session' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<Banner>(null)
  const [fieldError, setFieldError] = useState<FieldError>(null)
  const [seconds, setSeconds] = useState(60)
  const [deniedReason, setDeniedReason] = useState<DeniedReason>('locked')
  const [verifyMessage, setVerifyMessage] = useState('Verifying credentials…')

  useEffect(() => {
    if (view !== 'mfa') return undefined
    setSeconds(60)
    const timer = window.setInterval(() => {
      setSeconds((value) => (value > 0 ? value - 1 : 0))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [view])

  function goLogin(nextBanner: Banner = null) {
    setView('login')
    setBanner(nextBanner)
    setFieldError(null)
    setOtp('')
    setNewPassword('')
    setConfirmPassword('')
    setAcceptTerms(false)
    setLoading(false)
  }

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim().toLowerCase()

    if (!isEmail(trimmed) || password.length < 8) {
      setBanner('invalid')
      setFieldError(!isEmail(trimmed) ? 'email' : 'password')
      return
    }

    setBanner(null)
    setFieldError(null)
    setVerifyMessage(isFirebaseEnabled() ? 'Signing in with Firebase…' : 'Verifying credentials…')
    setView('verifying')

    if (isFirebaseEnabled()) {
      void (async () => {
        try {
          const user = await firebaseSignIn(trimmed, password)
          onSuccess?.(user.email ?? trimmed)
        } catch {
          goLogin('credentials')
          setFieldError('password')
        }
      })()
      return
    }

    window.setTimeout(() => {
      if (trimmed === DEFAULT_EMAIL) {
        if (password === DEFAULT_PASSWORD) {
          onSuccess?.(trimmed)
          return
        }
        goLogin('credentials')
        setFieldError('password')
        return
      }

      if (trimmed === 'locked@keiros.com') {
        setDeniedReason('locked')
        setView('denied')
        return
      }
      if (trimmed === 'inactive@keiros.com') {
        setDeniedReason('inactive')
        setView('denied')
        return
      }
      if (trimmed === 'unauthorized@keiros.com') {
        setDeniedReason('unauthorized')
        setView('denied')
        return
      }
      if (trimmed === 'expired@keiros.com') {
        setView('session')
        return
      }
      if (trimmed === 'setup@keiros.com') {
        setView('setup')
        setBanner(null)
        return
      }
      if (trimmed === 'wrong@keiros.com' || password === 'wrongpass') {
        goLogin('credentials')
        setFieldError('password')
        return
      }

      setView('mfa')
      setBanner(null)
    }, 1100)
  }

  function handleForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!isEmail(trimmed)) {
      setBanner('invalid')
      setFieldError('email')
      return
    }
    setLoading(true)
    setBanner(null)
    window.setTimeout(() => {
      setLoading(false)
      if (trimmed === 'fail@keiros.com') {
        setBanner('reset-fail')
        return
      }
      setBanner('reset-ok')
    }, 700)
  }

  function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < 10 || newPassword !== confirmPassword) {
      setBanner('invalid')
      setFieldError('reset')
      return
    }
    setLoading(true)
    setBanner(null)
    window.setTimeout(() => {
      setLoading(false)
      setNewPassword('')
      setConfirmPassword('')
      goLogin('reset-done')
    }, 700)
  }

  function handleMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (otp.replace(/\s/g, '').length !== 6) {
      setBanner('invalid')
      setFieldError('otp')
      return
    }
    setVerifyMessage('Verifying code…')
    setView('verifying')
    setBanner(null)
    window.setTimeout(() => {
      if (otp === '000000') {
        setView('mfa')
        setBanner('credentials')
        setFieldError('otp')
        return
      }
      onSuccess?.(email.trim().toLowerCase())
    }, 900)
  }

  function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < 10 || newPassword !== confirmPassword || !acceptTerms) {
      setBanner('invalid')
      setFieldError('setup')
      return
    }
    setLoading(true)
    setBanner(null)
    window.setTimeout(() => {
      setLoading(false)
      goLogin(null)
    }, 700)
  }

  return (
    <div className="login">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-glow login-glow-a" aria-hidden="true" />
      <div className="login-glow login-glow-b" aria-hidden="true" />

      <svg className="login-blueprint" viewBox="0 0 960 640" aria-hidden="true">
        <defs>
          <linearGradient id="routeGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7eb3ff" />
            <stop offset="100%" stopColor="#5eead4" />
          </linearGradient>
          <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="40" y="60" width="880" height="520" rx="22" fill="rgba(10,22,40,0.55)" stroke="rgba(126,179,255,0.22)" />
        <rect x="72" y="92" width="220" height="160" rx="12" fill="rgba(43,125,233,0.14)" stroke="rgba(126,179,255,0.35)" />
        <rect x="312" y="92" width="190" height="160" rx="12" fill="rgba(15,118,110,0.12)" stroke="rgba(94,234,212,0.3)" />
        <rect x="522" y="92" width="170" height="110" rx="12" fill="rgba(43,125,233,0.1)" stroke="rgba(126,179,255,0.28)" />
        <rect x="712" y="92" width="176" height="160" rx="12" fill="rgba(43,125,233,0.08)" stroke="rgba(126,179,255,0.25)" />
        <rect x="72" y="280" width="220" height="140" rx="12" fill="rgba(43,125,233,0.08)" stroke="rgba(126,179,255,0.24)" />
        <rect x="312" y="280" width="190" height="140" rx="12" fill="rgba(180,83,9,0.1)" stroke="rgba(251,191,36,0.28)" />
        <rect x="522" y="230" width="366" height="190" rx="12" fill="rgba(15,118,110,0.1)" stroke="rgba(94,234,212,0.32)" />
        <rect x="72" y="448" width="430" height="100" rx="12" fill="rgba(43,125,233,0.07)" stroke="rgba(126,179,255,0.2)" />
        <rect x="522" y="448" width="366" height="100" rx="12" fill="rgba(43,125,233,0.09)" stroke="rgba(126,179,255,0.22)" />
        <text x="182" y="178" textAnchor="middle" className="bp-label">Lobby</text>
        <text x="407" y="178" textAnchor="middle" className="bp-label">Office</text>
        <text x="607" y="152" textAnchor="middle" className="bp-label">Meeting</text>
        <text x="800" y="178" textAnchor="middle" className="bp-label">Lab</text>
        <text x="182" y="358" textAnchor="middle" className="bp-label">Storage</text>
        <text x="407" y="358" textAnchor="middle" className="bp-label">Server</text>
        <text x="705" y="330" textAnchor="middle" className="bp-label">Unit B12</text>
        <path
          d="M 182 210 L 182 350 L 407 350 L 407 400 L 700 400"
          fill="none"
          stroke="url(#routeGlow)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="9 8"
          filter="url(#softGlow)"
          opacity="0.9"
        >
          <animate attributeName="stroke-dashoffset" from="51" to="0" dur="2.6s" repeatCount="indefinite" />
        </path>
        <circle cx="182" cy="210" r="6" fill="#7eb3ff" filter="url(#softGlow)" />
        <circle cx="700" cy="400" r="6" fill="#5eead4" filter="url(#softGlow)" />
        <circle r="4.5" fill="#fff">
          <animateMotion dur="5s" repeatCount="indefinite" path="M 182 210 L 182 350 L 407 350 L 407 400 L 700 400" />
        </circle>
      </svg>

      <header className="login-top">
        <button type="button" className="login-brand" onClick={onBack}>
          <span className="logo-plate">
            <img src={keirosLogo} alt="Keiros" />
          </span>
        </button>
        <div className="login-status">
          <span className="pulse-dot" aria-hidden="true" />
          System Operational
        </div>
      </header>

      <main className="login-stage">
        <section className="login-intro rise">
          <p className="kicker">Keiros ERP</p>
          <h1>
            Indoor maps
            <em>for properties.</em>
          </h1>
          <p className="intro-line">Sign in to manage floors, units, and routes.</p>
          <div className="intro-meta">
            <span>Floor 02</span>
            <span>East wing</span>
            <span>Entry → Unit B12</span>
          </div>
        </section>

        <section className="login-card rise delay">
          {view === 'login' ? (
            <LoginCard
              email={email}
              password={password}
              showPassword={showPassword}
              remember={remember}
              banner={banner}
              fieldError={fieldError}
              onEmail={setEmail}
              onPassword={setPassword}
              onTogglePassword={() => setShowPassword((value) => !value)}
              onRemember={setRemember}
              onSubmit={handleLogin}
              onForgot={() => {
                setView('forgot')
                setBanner(null)
                setFieldError(null)
              }}
              onHelp={() => {
                setView('help')
                setBanner(null)
              }}
            />
          ) : null}

          {view === 'verifying' ? <VerifyingCard message={verifyMessage} /> : null}

          {view === 'mfa' ? (
            <MfaCard
              email={email}
              otp={otp}
              seconds={seconds}
              loading={loading}
              banner={banner}
              fieldError={fieldError}
              onOtp={setOtp}
              onSubmit={handleMfa}
              onResend={() => {
                setSeconds(60)
                setOtp('')
                setBanner(null)
              }}
              onBack={() => goLogin(null)}
            />
          ) : null}

          {view === 'forgot' ? (
            <ForgotCard
              email={email}
              loading={loading}
              banner={banner}
              fieldError={fieldError}
              onEmail={setEmail}
              onSubmit={handleForgot}
              onContinueReset={() => {
                setView('reset')
                setBanner(null)
                setFieldError(null)
                setNewPassword('')
                setConfirmPassword('')
              }}
              onBack={() => goLogin(null)}
              onHelp={() => setView('help')}
            />
          ) : null}

          {view === 'reset' ? (
            <ResetCard
              newPassword={newPassword}
              confirmPassword={confirmPassword}
              showPassword={showPassword}
              loading={loading}
              banner={banner}
              fieldError={fieldError}
              onNewPassword={setNewPassword}
              onConfirmPassword={setConfirmPassword}
              onTogglePassword={() => setShowPassword((value) => !value)}
              onSubmit={handleReset}
              onBack={() => {
                setView('forgot')
                setBanner(null)
                setFieldError(null)
              }}
            />
          ) : null}

          {view === 'setup' ? (
            <SetupCard
              newPassword={newPassword}
              confirmPassword={confirmPassword}
              acceptTerms={acceptTerms}
              showPassword={showPassword}
              loading={loading}
              banner={banner}
              fieldError={fieldError}
              onNewPassword={setNewPassword}
              onConfirmPassword={setConfirmPassword}
              onAcceptTerms={setAcceptTerms}
              onTogglePassword={() => setShowPassword((value) => !value)}
              onSubmit={handleSetup}
              onBack={() => goLogin(null)}
            />
          ) : null}

          {view === 'session' ? (
            <SessionCard
              onSignIn={() => goLogin(null)}
              onHelp={() => setView('help')}
            />
          ) : null}

          {view === 'denied' ? (
            <DeniedCard
              reason={deniedReason}
              onSignIn={() => goLogin(null)}
              onHelp={() => setView('help')}
            />
          ) : null}

          {view === 'help' ? <HelpCard onBack={() => goLogin(null)} /> : null}

          {view !== 'verifying' ? (
            <footer className="trust-bar">
              <p>Authorized users only</p>
              <nav>
                <a href="#privacy">Privacy Policy</a>
                <a href="#terms">Terms of Use</a>
                <button type="button" className="text-link trust-link" onClick={() => setView('help')}>
                  Support
                </button>
              </nav>
            </footer>
          ) : null}
        </section>
      </main>
    </div>
  )
}

function BannerNote({ banner }: { banner: Banner }) {
  if (!banner) return null

  const copy: Record<Exclude<Banner, null>, { tone: string; text: string }> = {
    invalid: { tone: 'warn', text: 'Check the highlighted fields and try again.' },
    credentials: { tone: 'error', text: 'Incorrect credentials. Access was not granted.' },
    'reset-ok': { tone: 'ok', text: 'Reset link sent. Check your work email.' },
    'reset-fail': { tone: 'error', text: 'Unable to send reset link. Try again or contact support.' },
    'reset-done': { tone: 'ok', text: 'Password updated. Sign in with your new password.' },
  }

  const item = copy[banner]
  return (
    <p className={`banner ${item.tone}`} role="status">
      {item.text}
    </p>
  )
}

type LoginCardProps = {
  email: string
  password: string
  showPassword: boolean
  remember: boolean
  banner: Banner
  fieldError: FieldError
  onEmail: (value: string) => void
  onPassword: (value: string) => void
  onTogglePassword: () => void
  onRemember: (value: boolean) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onForgot: () => void
  onHelp: () => void
}

function LoginCard({
  email,
  password,
  showPassword,
  remember,
  banner,
  fieldError,
  onEmail,
  onPassword,
  onTogglePassword,
  onRemember,
  onSubmit,
  onForgot,
  onHelp,
}: LoginCardProps) {
  return (
    <>
      <div className="panel-head">
        <h2>Sign in</h2>
        <p>Email and password</p>
      </div>
      <BannerNote banner={banner} />
      <form className="login-form" onSubmit={onSubmit} noValidate>
        <label>
          Email address
          <input
            className={fieldError === 'email' ? 'is-invalid' : ''}
            type="email"
            name="email"
            autoComplete="username"
            placeholder="you@organization.com"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            aria-invalid={fieldError === 'email'}
            required
          />
        </label>

        <label>
          Password
          <span className="password-wrap">
            <input
              className={fieldError === 'password' ? 'is-invalid' : ''}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              placeholder="Enter password"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              aria-invalid={fieldError === 'password'}
              required
            />
            <button type="button" className="reveal" onClick={onTogglePassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>

        <div className="form-row">
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => onRemember(event.target.checked)}
            />
            Remember me
          </label>
          <button type="button" className="text-link" onClick={onForgot}>
            Forgot password
          </button>
        </div>

        <button type="submit" className="btn solid">
          Sign in
        </button>
        <button type="button" className="text-link center" onClick={onHelp}>
          Login help
        </button>
      </form>
    </>
  )
}

function VerifyingCard({ message }: { message: string }) {
  return (
    <div className="verifying" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2>Signing in</h2>
      <p>{message}</p>
    </div>
  )
}

type MfaCardProps = {
  email: string
  otp: string
  seconds: number
  loading: boolean
  banner: Banner
  fieldError: FieldError
  onOtp: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onResend: () => void
  onBack: () => void
}

function MfaCard({
  email,
  otp,
  seconds,
  loading,
  banner,
  fieldError,
  onOtp,
  onSubmit,
  onResend,
  onBack,
}: MfaCardProps) {
  return (
    <>
      <div className="panel-head">
        <p className="kicker">Verification</p>
        <h2>Enter code</h2>
        <p>Code sent to {email || 'your email'}.</p>
      </div>
      <BannerNote banner={banner} />
      <form className="login-form" onSubmit={onSubmit} noValidate>
        <label>
          Verification code
          <input
            className={fieldError === 'otp' ? 'is-invalid' : ''}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={6}
            value={otp}
            onChange={(event) => onOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-invalid={fieldError === 'otp'}
          />
        </label>
        <p className="timer">Expires in {seconds}s</p>
        <button type="submit" className="btn solid" disabled={loading || seconds === 0}>
          {loading ? 'Verifying…' : 'Verify'}
        </button>
        <div className="form-row">
          <button type="button" className="text-link" onClick={onResend} disabled={seconds > 45}>
            Resend code
          </button>
          <button type="button" className="text-link" onClick={onBack}>
            Back to login
          </button>
        </div>
      </form>
    </>
  )
}

type ForgotCardProps = {
  email: string
  loading: boolean
  banner: Banner
  fieldError: FieldError
  onEmail: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onContinueReset: () => void
  onBack: () => void
  onHelp: () => void
}

function ForgotCard({
  email,
  loading,
  banner,
  fieldError,
  onEmail,
  onSubmit,
  onContinueReset,
  onBack,
  onHelp,
}: ForgotCardProps) {
  return (
    <>
      <div className="panel-head">
        <p className="kicker">Account recovery</p>
        <h2>Forgot password</h2>
        <p>Enter your email to request a reset.</p>
      </div>
      <BannerNote banner={banner} />
      <form className="login-form" onSubmit={onSubmit} noValidate>
        <label>
          Email address
          <input
            className={fieldError === 'email' ? 'is-invalid' : ''}
            type="email"
            placeholder="you@organization.com"
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            aria-invalid={fieldError === 'email'}
            required
          />
        </label>
        <button type="submit" className="btn solid" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
        {banner === 'reset-ok' ? (
          <button type="button" className="btn ghost" onClick={onContinueReset}>
            Continue to reset password
          </button>
        ) : null}
        <button type="button" className="text-link center" onClick={onBack}>
          Back to sign in
        </button>
        <button type="button" className="text-link center" onClick={onHelp}>
          Need help?
        </button>
      </form>
    </>
  )
}

type ResetCardProps = {
  newPassword: string
  confirmPassword: string
  showPassword: boolean
  loading: boolean
  banner: Banner
  fieldError: FieldError
  onNewPassword: (value: string) => void
  onConfirmPassword: (value: string) => void
  onTogglePassword: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
}

function ResetCard({
  newPassword,
  confirmPassword,
  showPassword,
  loading,
  banner,
  fieldError,
  onNewPassword,
  onConfirmPassword,
  onTogglePassword,
  onSubmit,
  onBack,
}: ResetCardProps) {
  return (
    <>
      <div className="panel-head">
        <p className="kicker">Account recovery</p>
        <h2>Reset password</h2>
        <p>Create a new password.</p>
      </div>
      <BannerNote banner={banner} />
      <form className="login-form" onSubmit={onSubmit} noValidate>
        <label>
          New password
          <span className="password-wrap">
            <input
              className={fieldError === 'reset' ? 'is-invalid' : ''}
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 10 characters"
              value={newPassword}
              onChange={(event) => onNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="reveal" onClick={onTogglePassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <label>
          Confirm password
          <input
            className={fieldError === 'reset' ? 'is-invalid' : ''}
            type={showPassword ? 'text' : 'password'}
            placeholder="Re-enter password"
            value={confirmPassword}
            onChange={(event) => onConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <button type="submit" className="btn solid" disabled={loading}>
          {loading ? 'Saving…' : 'Update password'}
        </button>
        <button type="button" className="text-link center" onClick={onBack}>
          Back
        </button>
      </form>
    </>
  )
}

type SetupCardProps = {
  newPassword: string
  confirmPassword: string
  acceptTerms: boolean
  showPassword: boolean
  loading: boolean
  banner: Banner
  fieldError: FieldError
  onNewPassword: (value: string) => void
  onConfirmPassword: (value: string) => void
  onAcceptTerms: (value: boolean) => void
  onTogglePassword: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
}

function SetupCard({
  newPassword,
  confirmPassword,
  acceptTerms,
  showPassword,
  loading,
  banner,
  fieldError,
  onNewPassword,
  onConfirmPassword,
  onAcceptTerms,
  onTogglePassword,
  onSubmit,
  onBack,
}: SetupCardProps) {
  return (
    <>
      <div className="panel-head">
        <p className="kicker">First-time access</p>
        <h2>Set your password</h2>
        <p>Choose a password and accept the terms.</p>
      </div>
      <BannerNote banner={banner} />
      <form className="login-form" onSubmit={onSubmit} noValidate>
        <label>
          Set password
          <span className="password-wrap">
            <input
              className={fieldError === 'setup' ? 'is-invalid' : ''}
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 10 characters"
              value={newPassword}
              onChange={(event) => onNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            <button type="button" className="reveal" onClick={onTogglePassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <label>
          Confirm password
          <input
            className={fieldError === 'setup' ? 'is-invalid' : ''}
            type={showPassword ? 'text' : 'password'}
            placeholder="Re-enter password"
            value={confirmPassword}
            onChange={(event) => onConfirmPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(event) => onAcceptTerms(event.target.checked)}
          />
          Accept Terms of Use and Privacy Policy
        </label>
        <button type="submit" className="btn solid" disabled={loading}>
          {loading ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" className="text-link center" onClick={onBack}>
          Back to sign in
        </button>
      </form>
    </>
  )
}

function SessionCard({ onSignIn, onHelp }: { onSignIn: () => void; onHelp: () => void }) {
  return (
    <>
      <div className="panel-head">
        <p className="kicker">Session</p>
        <h2>Session expired</h2>
        <p>Sign in again to continue.</p>
      </div>
      <p className="banner warn" role="status">
        Your session expired.
      </p>
      <div className="login-form">
        <button type="button" className="btn solid" onClick={onSignIn}>
          Sign in again
        </button>
        <button type="button" className="text-link center" onClick={onHelp}>
          Login help
        </button>
      </div>
    </>
  )
}

function DeniedCard({
  reason,
  onSignIn,
  onHelp,
}: {
  reason: DeniedReason
  onSignIn: () => void
  onHelp: () => void
}) {
  const copy: Record<DeniedReason, { title: string; detail: string }> = {
    locked: {
      title: 'Account locked',
      detail: 'This account is locked. Contact your organization admin.',
    },
    inactive: {
      title: 'Account inactive',
      detail: 'This account is inactive and cannot sign in.',
    },
    unauthorized: {
      title: 'Access denied',
      detail: 'You are not authorized to access Keiros ERP.',
    },
  }

  const item = copy[reason]

  return (
    <>
      <div className="panel-head">
        <p className="kicker">Access</p>
        <h2>{item.title}</h2>
        <p>{item.detail}</p>
      </div>
      <p className="banner error" role="status">
        {item.detail}
      </p>
      <div className="login-form">
        <button type="button" className="btn solid" onClick={onSignIn}>
          Back to sign in
        </button>
        <button type="button" className="text-link center" onClick={onHelp}>
          Contact support
        </button>
      </div>
    </>
  )
}

function HelpCard({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="panel-head">
        <p className="kicker">Support</p>
        <h2>Login help</h2>
        <p>Contact support for sign-in issues.</p>
      </div>
      <ul className="help-list">
        <li>
          <span>Email</span>
          <strong>support@keiros.ai</strong>
        </li>
        <li>
          <span>Hours</span>
          <strong>Mon–Fri, 09:00–18:00 IST</strong>
        </li>
        <li>
          <span>Request</span>
          <strong>Include your work email and error message</strong>
        </li>
      </ul>
      <div className="login-form">
        <a className="btn solid center-btn" href="mailto:support@keiros.ai">
          Email support
        </a>
        <button type="button" className="text-link center" onClick={onBack}>
          Back to sign in
        </button>
      </div>
    </>
  )
}
