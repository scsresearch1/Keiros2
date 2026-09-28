import { useMemo } from 'react'
import { BackChip, ErrorBanner, PrimaryButton, PropertyHeroCard } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { photos } from '../media/photos'

export function OverviewScreen() {
  const {
    goBack,
    property,
    hierarchy,
    hierarchyError,
    reloadHierarchy,
    selectedComplexId,
    startGuidedTour,
    startBrowseTour,
  } = useTour()

  const complex = useMemo(() => {
    if (!hierarchy) return null
    return hierarchy.complexes.find((c) => c.id === selectedComplexId) ?? hierarchy.complexes[0]
  }, [hierarchy, selectedComplexId])

  const buildings = useMemo(() => {
    if (!hierarchy || !complex) return 0
    return hierarchy.buildings.filter((b) => b.complexId === complex.id).length
  }, [hierarchy, complex])

  const amenityCount = useMemo(() => {
    if (!hierarchy) return 0
    return hierarchy.units.filter(
      (u) =>
        (!selectedComplexId || u.complexId === selectedComplexId) &&
        /gym|pool|club|lobby|leas|park|amenit/i.test(`${u.type} ${u.name}`),
    ).length
  }, [hierarchy, selectedComplexId])

  return (
    <section className="screen screen--scroll">
      <div className="screen-pad">
        <div className="screen-top static">
          <BackChip onClick={goBack} />
          <p className="top-brand">Keiros Tour</p>
        </div>
        <p className="splash-eyebrow">Welcome</p>
        <h1 className="page-title">Tour {property?.name ?? complex?.name ?? 'the property'}</h1>
        <p className="muted tour-lede">
          No guide needed. Follow a curated walkthrough of highlights, or wander freely — you’re in
          control.
        </p>
        {hierarchyError && (
          <ErrorBanner
            message="We couldn’t load the property map. Check your connection and try again."
            onRetry={() => void reloadHierarchy()}
          />
        )}
        <PropertyHeroCard
          image={photos.campus}
          badge={property?.code}
          title={property?.name ?? complex?.name ?? 'Property'}
          meta={`${property?.city ?? complex?.city ?? ''}${buildings ? ` · ${buildings} buildings` : ''}${
            amenityCount ? ` · ${amenityCount}+ places` : ''
          }`}
          cta="Start self-guided tour"
          onCta={startGuidedTour}
        />
        <ul className="tour-bullets">
          <li>
            <strong>Enter once</strong>
            <span>Get inside the building first</span>
          </li>
          <li>
            <strong>Lowest floor first</strong>
            <span>Visit every unit on a floor, then move up</span>
          </li>
          <li>
            <strong>End anytime</strong>
            <span>Leave the tour whenever you’re ready</span>
          </li>
        </ul>
        {hierarchy && (
          <div className="bottom-cta-safe stacked">
            <PrimaryButton onClick={startGuidedTour}>Start self-guided tour</PrimaryButton>
            <button type="button" className="linkish" onClick={startBrowseTour}>
              Browse places instead
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
