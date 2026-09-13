export type TourStep =
  | 'splash'
  | 'permissions'
  | 'propertyCode'
  | 'validating'
  | 'download'
  | 'overview'
  | 'search'
  | 'routePreview'
  | 'navigation'
  | 'doorAccess'
  | 'complete'

export const STEP_ORDER: TourStep[] = [
  'splash',
  'permissions',
  'propertyCode',
  'validating',
  'download',
  'overview',
  'search',
  'routePreview',
  'navigation',
  'doorAccess',
  'complete',
]

/** Screens that show Map / Doors / Access bottom tabs */
export const TOUR_TAB_STEPS: TourStep[] = [
  'overview',
  'search',
  'routePreview',
  'navigation',
  'doorAccess',
]

export function stepIndex(step: TourStep) {
  return STEP_ORDER.indexOf(step)
}

export function nextStep(step: TourStep): TourStep | null {
  const i = stepIndex(step)
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null
}

export function prevStep(step: TourStep): TourStep | null {
  const i = stepIndex(step)
  return i > 0 ? STEP_ORDER[i - 1] : null
}
