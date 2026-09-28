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
      <BottomSheet
        title="Join this property tour"
        subtitle="Scan the code at the lobby, leasing desk, or model unit door."
      >
        <label className="field">
          <span>Tour access code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="OC-CHI-2026"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <p className="field-hint">You can also paste a scanned Keiros access link.</p>
        {codeError && <p className="field-error">{codeError}</p>}
        <div className="btn-stack">
          <PrimaryButton variant="ghost" onClick={() => setCode(DEMO_CODES[0])}>
            Use demo scan
          </PrimaryButton>
          <PrimaryButton onClick={submit} disabled={!code.trim() || busy}>
            {busy ? 'Opening tour…' : 'Start with this code'}
          </PrimaryButton>
        </div>
      </BottomSheet>
    </section>
  )
}
