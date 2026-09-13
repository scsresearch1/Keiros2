import { Copy, Download, MapPin, ScanLine } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import keirosLogo from '../assets/keiros-logo.png'
import { Icon } from './icons'
import './PropertyCodeQr.css'

export type PropertyCodeQrProps = {
  code: string
  propertyName: string
  propertyId?: string
  label?: string
  status?: string
  size?: number
  muted?: boolean
}

/** Universal scan payload — HTTPS so phone cameras / QR apps always find data. */
export const ACCESS_QR_BASE = 'https://keiros.ai/access'

/** Payload scanned by Keiros mobile / Tour App to unlock a property map. */
export function buildAccessPayload(code: string, propertyName: string, label?: string, propertyId?: string) {
  const params = new URLSearchParams({
    code: code.trim(),
    property: propertyName,
  })
  if (propertyId) params.set('propertyId', propertyId)
  if (label) params.set('label', label)
  // HTTPS first so generic scanners work; apps can still deep-link from this URL.
  return `${ACCESS_QR_BASE}?${params.toString()}`
}

/** Extract a property access code from a raw QR scan (URL, deep link, or plain code). */
export function parseAccessCodeFromScan(raw: string): string {
  const text = raw.trim()
  if (!text) return ''

  try {
    if (/^https?:\/\//i.test(text) || /^keiros:\/\//i.test(text)) {
      const normalized = text.replace(/^keiros:\/\//i, 'https://keiros.local/')
      const url = new URL(normalized)
      const fromQuery = url.searchParams.get('code')
      if (fromQuery?.trim()) return fromQuery.trim().toUpperCase().replace(/\s+/g, '-')
      const pathParts = url.pathname.split('/').filter(Boolean)
      const last = pathParts[pathParts.length - 1]
      if (last && last.toUpperCase() !== 'ACCESS') {
        return last.trim().toUpperCase().replace(/\s+/g, '-')
      }
    }
  } catch {
    /* fall through to plain-code handling */
  }

  const codeMatch = text.match(/[?&]code=([^&\s#]+)/i)
  if (codeMatch?.[1]) {
    try {
      return decodeURIComponent(codeMatch[1]).trim().toUpperCase().replace(/\s+/g, '-')
    } catch {
      return codeMatch[1].trim().toUpperCase().replace(/\s+/g, '-')
    }
  }

  return text.toUpperCase().replace(/\s+/g, '-')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image failed to load'))
    img.src = src
  })
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

async function composeLogoQr(opts: {
  payload: string
  muted: boolean
  pixelSize: number
}): Promise<string> {
  const { payload, muted, pixelSize } = opts
  const qrDataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: pixelSize,
    color: {
      dark: muted ? '#64748b' : '#0f172a',
      light: '#ffffff',
    },
  })

  const canvas = document.createElement('canvas')
  canvas.width = pixelSize
  canvas.height = pixelSize
  const ctx = canvas.getContext('2d')
  if (!ctx) return qrDataUrl

  const qrImg = await loadImage(qrDataUrl)
  ctx.drawImage(qrImg, 0, 0, pixelSize, pixelSize)

  const logoBox = pixelSize * 0.18
  const logoPad = logoBox * 0.14
  const logoDraw = logoBox - logoPad * 2
  const boxX = (pixelSize - logoBox) / 2
  const boxY = (pixelSize - logoBox) / 2

  // Solid white plate only (no shadow) — shadows can break QR modules under the logo.
  roundRect(ctx, boxX, boxY, logoBox, logoBox, logoBox * 0.2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  roundRect(ctx, boxX, boxY, logoBox, logoBox, logoBox * 0.2)
  ctx.strokeStyle = muted ? 'rgba(100, 116, 139, 0.35)' : 'rgba(37, 99, 235, 0.2)'
  ctx.lineWidth = Math.max(1.5, pixelSize * 0.006)
  ctx.stroke()

  try {
    const logo = await loadImage(keirosLogo)
    const aspect = logo.width / Math.max(logo.height, 1)
    let drawW = logoDraw
    let drawH = logoDraw
    if (aspect > 1) drawH = logoDraw / aspect
    else drawW = logoDraw * aspect
    const logoX = boxX + (logoBox - drawW) / 2
    const logoY = boxY + (logoBox - drawH) / 2
    if (muted) ctx.globalAlpha = 0.55
    ctx.drawImage(logo, logoX, logoY, drawW, drawH)
    ctx.globalAlpha = 1
  } catch {
    /* keep QR without logo if asset fails */
  }

  return canvas.toDataURL('image/png')
}

function marketingCopy(propertyName: string, label?: string) {
  const accessKind = label?.trim() || 'Guest access'
  return {
    eyebrow: 'Keiros wayfinding',
    headline: 'Scan. Arrive. Explore.',
    sub: `Instant indoor navigation for ${propertyName} — built for ${accessKind.toLowerCase()}.`,
    footer: 'Maps that guide every visitor · Powered by Keiros',
  }
}

export function PropertyCodeQr({
  code,
  propertyName,
  propertyId,
  label,
  status,
  size = 168,
  muted = false,
}: PropertyCodeQrProps) {
  const inactive = muted || status === 'Revoked' || status === 'Expired'
  const payload = useMemo(
    () => buildAccessPayload(code, propertyName, label, propertyId),
    [code, propertyName, label, propertyId],
  )
  const copy = useMemo(() => marketingCopy(propertyName, label), [propertyName, label])
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError('')
    setDataUrl('')
    void composeLogoQr({
      payload,
      muted: inactive,
      pixelSize: Math.max(320, size * 2),
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setError('QR could not be generated.')
      })
    return () => {
      cancelled = true
    }
  }, [payload, size, inactive])

  function downloadPng() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${code.replace(/[^A-Za-z0-9-_]/g, '_')}-keiros-qr.png`
    a.click()
  }

  function copyPayload() {
    void navigator.clipboard?.writeText(payload).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  if (error) {
    return <p className="k-empty-hint">{error}</p>
  }

  return (
    <article className={`k-qr-pass${inactive ? ' is-muted' : ''}`}>
      <header className="k-qr-pass__brand">
        <span className="k-qr-pass__logo-plate">
          <img src={keirosLogo} alt="" />
        </span>
        <div>
          <p className="k-qr-pass__eyebrow">{copy.eyebrow}</p>
          <h3 className="k-qr-pass__headline">{copy.headline}</h3>
        </div>
      </header>

      <p className="k-qr-pass__pitch">{copy.sub}</p>

      <div className="k-qr-pass__stage">
        <div className="k-qr-pass__glow" aria-hidden />
        <div className="k-qr-pass__frame" style={{ width: size, height: size }}>
          {dataUrl ? (
            <img src={dataUrl} alt={`Keiros QR code for ${code}`} width={size} height={size} />
          ) : (
            <div className="k-qr-pass__skeleton" aria-hidden />
          )}
        </div>
        <div className="k-qr-pass__scan-hint">
          <Icon icon={ScanLine} size={14} />
          <span>Scan with any camera · opens Keiros access link</span>
        </div>
      </div>

      <div className="k-qr-pass__meta">
        <code className="k-qr-pass__code">{code}</code>
        <p className="k-qr-pass__property">
          <Icon icon={MapPin} size={13} />
          <span>{propertyName}</span>
        </p>
        {label ? <p className="k-qr-pass__label">{label}</p> : null}
        <p className="k-qr-pass__payload" title={payload}>
          {payload}
        </p>
      </div>

      <p className="k-qr-pass__footer">{copy.footer}</p>

      <div className="k-qr-pass__actions">
        <button
          type="button"
          className="k-btn k-btn--ghost k-qr-pass__download"
          onClick={copyPayload}
          disabled={!payload}
        >
          <Icon icon={Copy} size={14} />
          {copied ? 'Link copied' : 'Copy scan link'}
        </button>
        <button
          type="button"
          className="k-btn k-btn--primary k-qr-pass__download"
          onClick={downloadPng}
          disabled={!dataUrl}
        >
          <Icon icon={Download} size={14} />
          Download branded QR
        </button>
      </div>
    </article>
  )
}
