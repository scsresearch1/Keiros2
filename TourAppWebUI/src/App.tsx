import { TourProvider, useTour } from './flow/TourContext'
import { AppShell } from './ui/chrome'
import { SplashScreen } from './screens/SplashScreen'
import { PermissionsScreen } from './screens/PermissionsScreen'
import { PropertyCodeScreen } from './screens/PropertyCodeScreen'
import { ValidatingScreen } from './screens/ValidatingScreen'
import { DownloadScreen } from './screens/DownloadScreen'
import { OverviewScreen } from './screens/OverviewScreen'
import { SearchScreen } from './screens/SearchScreen'
import { RoutePreviewScreen } from './screens/RoutePreviewScreen'
import { NavigationScreen } from './screens/NavigationScreen'
import { DoorAccessScreen } from './screens/DoorAccessScreen'
import { CompleteScreen } from './screens/CompleteScreen'
import './screens/screens.css'

function TourRouter() {
  const { step } = useTour()
  switch (step) {
    case 'splash':
      return <SplashScreen />
    case 'permissions':
      return <PermissionsScreen />
    case 'propertyCode':
      return <PropertyCodeScreen />
    case 'validating':
      return <ValidatingScreen />
    case 'download':
      return <DownloadScreen />
    case 'overview':
      return <OverviewScreen />
    case 'search':
      return <SearchScreen />
    case 'routePreview':
      return <RoutePreviewScreen />
    case 'navigation':
      return <NavigationScreen />
    case 'doorAccess':
      return <DoorAccessScreen />
    case 'complete':
      return <CompleteScreen />
    default:
      return <SplashScreen />
  }
}

export default function App() {
  return (
    <TourProvider>
      <AppShell>
        <TourRouter />
      </AppShell>
    </TourProvider>
  )
}
