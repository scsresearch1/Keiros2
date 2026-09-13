import { useState } from 'react'
import { BottomSheet, PrimaryButton, BackChip } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { DEMO_CODES } from '../mock/propertyCode'
import { photos } from '../media/photos'

export function PropertyCodeScreen() {
  const { goBack, validateCode, codeError } = useTour()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await validateCode(code)
    } catch {
      /* codeError */
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="screen">
      <div className="hero-photo soft" style={{ backgroundImage: `url(${photos.campus})` }} />
      <div className="hero-overlay" />
      <div className="screen-top">
        <BackChip onClick={goBack} />
      </div>
      <BottomSheet title="Enter or scan property code" subtitle="Code at the lobby, leasing office, or unit door.">
        <label className="field">
          <span>Property code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="OC-CHI-2026"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <p className="field-hint">
          Paste a code or a scanned Keiros access link (`https://keiros.ai/access?code=…`). Uses active
          codes from ERP → Property Codes.
        </p>
        {codeError && <p className="field-error">{codeError}</p>}
        <div className="btn-stack">
          <PrimaryButton variant="ghost" onClick={() => setCode(DEMO_CODES[0])}>
            Simulate QR scan
          </PrimaryButton>
          <PrimaryButton onClick={submit} disabled={!code.trim() || busy}>
            {busy ? 'Checking…' : 'Validate code'}
          </PrimaryButton>
        </div>
      </BottomSheet>
    </section>
  )
}
