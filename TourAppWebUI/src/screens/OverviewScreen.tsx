import { useMemo } from 'react'
import { BackChip, ErrorBanner, PrimaryButton, PropertyHeroCard } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { photos } from '../media/photos'

export function OverviewScreen() {
  const {
    goBack,
    goNext,
    property,
    hierarchy,
    hierarchyError,
    reloadHierarchy,
    selectedComplexId,
  } = useTour()

  const complex = useMemo(() => {
    if (!hierarchy) return null
    return hierarchy.complexes.find((c) => c.id === selectedComplexId) ?? hierarchy.complexes[0]
  }, [hierarchy, selectedComplexId])

  const buildings = useMemo(() => {
    if (!hierarchy || !complex) return 0
    return hierarchy.buildings.filter((b) => b.complexId === complex.id).length
  }, [hierarchy, complex])

  return (
    <section className="screen screen--scroll">
      <div className="screen-pad">
        <div className="screen-top static">
          <BackChip onClick={goBack} />
          <p className="top-brand">Keiros</p>
        </div>
        <h1 className="page-title">Your property</h1>
        {hierarchyError && (
          <ErrorBanner
            message="Map server offline. Start ERP on port 8787."
            onRetry={() => void reloadHierarchy()}
          />
        )}
        <PropertyHeroCard
          image={photos.campus}
          badge={property?.code}
          title={property?.name ?? complex?.name ?? 'Property'}
          meta={`${property?.city ?? complex?.city ?? ''}${buildings ? ` · ${buildings} buildings` : ''}`}
          cta="Find destination"
          onCta={goNext}
        />
        {hierarchy && (
          <div className="bottom-cta-safe">
            <PrimaryButton onClick={goNext}>Continue</PrimaryButton>
          </div>
        )}
      </div>
    </section>
  )
}
