import { LogOut, Menu, Moon, Search, Sun } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import keirosLogo from '../assets/keiros-logo.png'
import { navGroups, pageTitles, readStoredPage, storePage, type PageId } from './nav'
import { Icon, groupIcons, pageIcons } from '../ui/icons'
import { useTheme } from '../theme/ThemeProvider'
import {
  AccessIntegrationPage,
  AlertsPage,
  ApiClientsPage,
  ApiKeysPage,
  ApiLogsPage,
  ApiNavigationLivePage,
  ApiUsagePage,
  AuditLogsPage,
  HelpPage,
  NotificationsPage,
  ReportsPage,
  SettingsPage,
  SystemHealthPage,
} from '../pages/pagesGroupC'
import {
  ApprovalQueuePage,
  BuildingsPage,
  CoordinateReviewPage,
  CorrectionRequestsPage,
  DashboardPage,
  FieldMappingPage,
  FloorsPage,
  LocationsPage,
  MapPublishingPage,
  MapVersionsPage,
  MapViewerPage,
  MappingQualityPage,
  OrganizationsPage,
  PropertiesPage,
  RolesPage,
  UsersPage,
} from '../pages/pagesGroupA'
import {
  CodeUsagePage,
  DwellTimePage,
  JourneyTrackingPage,
  MobileDownloadsPage,
  MobileSessionsPage,
  PropertyCodesPage,
  RoutePreviewPage,
  RoutesPage,
  TenantActivityPage,
  TourActivityPage,
} from '../pages/pagesGroupB'
import './AppShell.css'

type AppShellProps = {
  email: string
  onSignOut: () => void
  onSessionExpired?: () => void
}

function pageSubtitle(page: PageId): string {
  const group = navGroups.find((g) => g.items.some((item) => item.id === page))
  if (page === 'dashboard') {
    return 'Live portfolio readiness, queues, and priority work from Firestore.'
  }
  return group ? `${group.title} · Keiros operations` : 'Keiros ERP'
}

function avatarInitials(email: string): string {
  const local = email.split('@')[0] ?? 'K'
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return local.slice(0, 2).toUpperCase() || 'K'
}

export function AppShell({ email, onSignOut, onSessionExpired }: AppShellProps) {
  const { theme, setTheme } = useTheme()
  const [page, setPage] = useState<PageId>(() => readStoredPage())
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [confirmOut, setConfirmOut] = useState(false)

  const navigate = useCallback((next: PageId) => {
    setPage(next)
    storePage(next)
    setSidebarOpen(false)
  }, [])

  const toggleGroup = (title: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [title]: !prev[title] }))
  }

  const renderPage = (): ReactNode => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage />
      case 'organizations':
        return <OrganizationsPage />
      case 'users':
        return <UsersPage />
      case 'roles':
        return <RolesPage />
      case 'properties':
      case 'property-form':
      case 'property-detail':
        return <PropertiesPage onNavigate={navigate} />
      case 'buildings':
        return <BuildingsPage />
      case 'floors':
        return <FloorsPage />
      case 'locations':
        return <LocationsPage />
      case 'field-mapping':
        return <FieldMappingPage onNavigate={navigate} />
      case 'coordinate-review':
        return <CoordinateReviewPage onNavigate={navigate} />
      case 'mapping-quality':
        return <MappingQualityPage onNavigate={navigate} />
      case 'approval-queue':
        return <ApprovalQueuePage onNavigate={navigate} />
      case 'correction-requests':
        return <CorrectionRequestsPage onNavigate={navigate} />
      case 'map-publishing':
        return <MapPublishingPage onNavigate={navigate} />
      case 'map-versions':
        return <MapVersionsPage onNavigate={navigate} />
      case 'map-viewer':
        return <MapViewerPage />
      case 'routes':
        return <RoutesPage onNavigate={navigate} />
      case 'route-preview':
        return <RoutePreviewPage onNavigate={navigate} />
      case 'property-codes':
        return <PropertyCodesPage onNavigate={navigate} />
      case 'code-usage':
        return <CodeUsagePage onNavigate={navigate} />
      case 'mobile-downloads':
        return <MobileDownloadsPage onNavigate={navigate} />
      case 'mobile-sessions':
        return <MobileSessionsPage onNavigate={navigate} />
      case 'journey-tracking':
        return <JourneyTrackingPage onNavigate={navigate} />
      case 'dwell-time':
        return <DwellTimePage onNavigate={navigate} />
      case 'tour-activity':
        return <TourActivityPage onNavigate={navigate} />
      case 'tenant-activity':
        return <TenantActivityPage onNavigate={navigate} />
      case 'api-clients':
        return <ApiClientsPage onNavigate={navigate} />
      case 'api-keys':
        return <ApiKeysPage onNavigate={navigate} />
      case 'api-usage':
        return <ApiUsagePage onNavigate={navigate} />
      case 'api-logs':
        return <ApiLogsPage onNavigate={navigate} />
      case 'api-navigation':
        return <ApiNavigationLivePage onNavigate={navigate} />
      case 'access-integration':
        return <AccessIntegrationPage onNavigate={navigate} />
      case 'notifications':
        return <NotificationsPage />
      case 'reports':
        return <ReportsPage onNavigate={navigate} />
      case 'audit-logs':
        return <AuditLogsPage onNavigate={navigate} />
      case 'alerts':
        return <AlertsPage onNavigate={navigate} />
      case 'system-health':
        return <SystemHealthPage onNavigate={navigate} />
      case 'settings':
        return <SettingsPage onNavigate={navigate} />
      case 'help':
        return <HelpPage onNavigate={navigate} />
      default:
        return <DashboardPage />
    }
  }

  return (
    <div className={`app-shell${sidebarOpen ? ' app-shell--sidebar-open' : ''}`}>
      <div
        className="app-shell__backdrop"
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className="app-shell__sidebar" aria-label="Main navigation">
        <div className="app-shell__brand">
          <span className="app-shell__logo-plate">
            <img src={keirosLogo} alt="Keiros" className="app-shell__logo" />
          </span>
          <span className="app-shell__brand-text">
            Keiros
            <small>ERP</small>
          </span>
        </div>

        <nav className="app-shell__nav">
          {navGroups.map((group) => {
            const collapsed = collapsedGroups[group.title] ?? false
            return (
              <div key={group.title} className="app-shell__nav-group">
                <button
                  type="button"
                  className="app-shell__nav-group-title"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!collapsed}
                >
                  <span className="app-shell__nav-group-label">
                    {groupIcons[group.title] ? (
                      <Icon icon={groupIcons[group.title]} size={13} className="app-shell__nav-group-icon" />
                    ) : null}
                    {group.title}
                  </span>
                  <span className={`app-shell__chevron${collapsed ? ' app-shell__chevron--collapsed' : ''}`} aria-hidden>
                    ▾
                  </span>
                </button>
                {!collapsed ? (
                  <ul className="app-shell__nav-list">
                    {group.items.map((item) => {
                      const ItemIcon = pageIcons[item.id]
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`app-shell__nav-link${page === item.id ? ' app-shell__nav-link--active' : ''}`}
                            onClick={() => navigate(item.id)}
                            aria-current={page === item.id ? 'page' : undefined}
                          >
                            <Icon icon={ItemIcon} size={16} className="app-shell__nav-link-icon" />
                            <span>{item.label}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </nav>

        <div className="app-shell__sidebar-foot">
          <div className="app-shell__theme-toggle" role="group" aria-label="Color theme">
            <button
              type="button"
              className={`app-shell__theme-btn${theme === 'light' ? ' app-shell__theme-btn--active' : ''}`}
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              <Icon icon={Sun} size={14} />
              Light
            </button>
            <button
              type="button"
              className={`app-shell__theme-btn${theme === 'dark' ? ' app-shell__theme-btn--active' : ''}`}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              <Icon icon={Moon} size={14} />
              Dark
            </button>
          </div>
          <span className="app-shell__env-pill">
            <span className="app-shell__env-dot" aria-hidden />
            Live Firestore
          </span>
        </div>
      </aside>

      <div className="app-shell__main">
        <header className="app-shell__topbar">
          <div className="app-shell__topbar-left">
            <button
              type="button"
              className="app-shell__menu-btn"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Icon icon={Menu} size={18} />
            </button>
            <div>
              <h1 className="app-shell__page-title">
                <Icon icon={pageIcons[page]} size={22} className="app-shell__page-title-icon" />
                {pageTitles[page]}
              </h1>
              <p className="app-shell__page-sub">{pageSubtitle(page)}</p>
            </div>
          </div>
          <div className="app-shell__topbar-right">
            <div className="app-shell__search" aria-hidden>
              <Icon icon={Search} size={14} />
              <span>Search portfolio…</span>
            </div>
            <div className="app-shell__user">
              <span className="app-shell__avatar" aria-hidden>
                {avatarInitials(email)}
              </span>
              <span className="app-shell__email">{email}</span>
            </div>
            {onSessionExpired ? (
              <button type="button" className="app-shell__btn app-shell__btn--ghost" onClick={onSessionExpired}>
                Session expired
              </button>
            ) : null}
            <button type="button" className="app-shell__btn" onClick={() => setConfirmOut(true)}>
              <Icon icon={LogOut} size={14} />
              Sign out
            </button>
          </div>
        </header>

        <main className="app-shell__content">
          <div key={page} className="app-shell__page page-enter">
            {renderPage()}
          </div>
        </main>
      </div>

      {confirmOut ? (
        <div className="app-shell__overlay" role="dialog" aria-modal="true" aria-labelledby="logout-title">
          <div className="app-shell__modal">
            <h2 id="logout-title">Sign out?</h2>
            <p>You will need to sign in again to continue.</p>
            <div className="app-shell__modal-actions">
              <button type="button" className="app-shell__btn app-shell__btn--ghost" onClick={() => setConfirmOut(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="app-shell__btn app-shell__btn--danger"
                onClick={() => {
                  setConfirmOut(false)
                  onSignOut()
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
