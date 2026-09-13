import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import keirosLogo from '../assets/keiros-logo.png'
import { buildAccessPayload } from './PropertyCodeQr'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image failed'))
    img.src = src
  })
}

export function PropertyCodeQrThumb({
  code,
  propertyName,
  propertyId,
  status,
}: {
  code: string
  propertyName: string
  propertyId?: string
  status?: string
}) {
  const [src, setSrc] = useState('')
  const muted = status === 'Revoked' || status === 'Expired'

  useEffect(() => {
    let cancelled = false
    const payload = buildAccessPayload(code, propertyName, undefined, propertyId)
    void (async () => {
      try {
        const qrUrl = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 96,
          color: {
            dark: muted ? '#64748b' : '#0f172a',
            light: '#ffffff',
          },
        })
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 96
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          if (!cancelled) setSrc(qrUrl)
          return
        }
        const qr = await loadImage(qrUrl)
        ctx.drawImage(qr, 0, 0, 96, 96)
        const box = 18
        const x = (96 - box) / 2
        const y = (96 - box) / 2
        const r = 4
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.moveTo(x + r, y)
        ctx.arcTo(x + box, y, x + box, y + box, r)
        ctx.arcTo(x + box, y + box, x, y + box, r)
        ctx.arcTo(x, y + box, x, y, r)
        ctx.arcTo(x, y, x + box, y, r)
        ctx.closePath()
        ctx.fill()
        try {
          const logo = await loadImage(keirosLogo)
          const inset = 3
          ctx.drawImage(logo, x + inset, y + inset, box - inset * 2, box - inset * 2)
        } catch {
          /* ignore */
        }
        if (!cancelled) setSrc(canvas.toDataURL('image/png'))
      } catch {
        if (!cancelled) setSrc('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, propertyName, propertyId, muted])

  if (!src) return <span className="k-qr-thumb" aria-hidden />
  return (
    <img
      className={`k-qr-thumb${muted ? ' is-muted' : ''}`}
      src={src}
      alt=""
      width={36}
      height={36}
    />
  )
}
