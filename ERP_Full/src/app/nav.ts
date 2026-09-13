export type PageId =
  | 'dashboard'
  | 'organizations'
  | 'users'
  | 'roles'
  | 'properties'
  | 'property-form'
  | 'property-detail'
  | 'buildings'
  | 'floors'
  | 'locations'
  | 'field-mapping'
  | 'coordinate-review'
  | 'mapping-quality'
  | 'approval-queue'
  | 'correction-requests'
  | 'map-publishing'
  | 'map-versions'
  | 'map-viewer'
  | 'routes'
  | 'route-preview'
  | 'property-codes'
  | 'code-usage'
  | 'mobile-downloads'
  | 'mobile-sessions'
  | 'journey-tracking'
  | 'dwell-time'
  | 'tour-activity'
  | 'tenant-activity'
  | 'api-clients'
  | 'api-keys'
  | 'api-usage'
  | 'api-logs'
  | 'api-navigation'
  | 'access-integration'
  | 'notifications'
  | 'reports'
  | 'audit-logs'
  | 'alerts'
  | 'system-health'
  | 'settings'
  | 'help'

export type NavItem = {
  id: PageId
  label: string
}

export type NavGroup = {
  title: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ id: 'dashboard', label: 'Home Dashboard' }],
  },
  {
    title: 'Organization',
    items: [
      { id: 'organizations', label: 'Organizations' },
      { id: 'users', label: 'User Management' },
      { id: 'roles', label: 'Role Management' },
    ],
  },
  {
    title: 'Properties',
    items: [
      { id: 'properties', label: 'Complexes' },
      { id: 'buildings', label: 'Buildings' },
      { id: 'floors', label: 'Floors' },
      { id: 'locations', label: 'Units / Locations' },
      { id: 'map-viewer', label: 'Wayfinding Map' },
      { id: 'routes', label: 'Route Management' },
      { id: 'route-preview', label: 'Route Preview' },
    ],
  },
  {
    title: 'Mapping',
    items: [
      { id: 'field-mapping', label: 'Field Mapping' },
      { id: 'coordinate-review', label: 'Coordinate Review' },
      { id: 'mapping-quality', label: 'Mapping Quality' },
      { id: 'approval-queue', label: 'Approval Queue' },
      { id: 'correction-requests', label: 'Correction Requests' },
      { id: 'map-publishing', label: 'Map Publishing' },
      { id: 'map-versions', label: 'Map Versions' },
    ],
  },
  {
    title: 'Mobile Access',
    items: [
      { id: 'property-codes', label: 'Property Codes' },
      { id: 'code-usage', label: 'Code Usage' },
      { id: 'mobile-downloads', label: 'Map Downloads' },
      { id: 'mobile-sessions', label: 'Mobile Sessions' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { id: 'journey-tracking', label: 'Journey Tracking' },
      { id: 'dwell-time', label: 'Dwell-Time' },
      { id: 'tour-activity', label: 'Tour Activity' },
      { id: 'tenant-activity', label: 'Tenant Activity' },
    ],
  },
  {
    title: 'API & Integrations',
    items: [
      { id: 'api-clients', label: 'API Clients' },
      { id: 'api-keys', label: 'API Keys' },
      { id: 'api-usage', label: 'API Usage' },
      { id: 'api-logs', label: 'API Logs' },
      { id: 'api-navigation', label: 'API Navigation Live' },
      { id: 'access-integration', label: 'Access Integration' },
      { id: 'notifications', label: 'Notifications / ERS' },
    ],
  },
  {
    title: 'System',
    items: [
      { id: 'reports', label: 'Reports' },
      { id: 'audit-logs', label: 'Audit Logs' },
      { id: 'alerts', label: 'Alerts' },
      { id: 'system-health', label: 'System Health' },
      { id: 'settings', label: 'Settings' },
      { id: 'help', label: 'Help / Support' },
    ],
  },
]

export const pageTitles: Record<PageId, string> = {
  ...(Object.fromEntries(
    navGroups.flatMap((group) => group.items.map((item) => [item.id, item.label])),
  ) as Record<PageId, string>),
  'property-form': 'Complexes',
  'property-detail': 'Complexes',
}

const ALL_PAGE_IDS = new Set<string>([
  ...Object.keys(pageTitles),
  'property-form',
  'property-detail',
])

export const ERP_PAGE_STORAGE_KEY = 'keiros-erp-page'

export function isPageId(value: string | null | undefined): value is PageId {
  return Boolean(value && ALL_PAGE_IDS.has(value))
}

export function readStoredPage(): PageId {
  try {
    const stored = sessionStorage.getItem(ERP_PAGE_STORAGE_KEY)
    if (isPageId(stored)) return stored
  } catch {
    /* ignore */
  }
  return 'dashboard'
}

export function storePage(page: PageId) {
  try {
    sessionStorage.setItem(ERP_PAGE_STORAGE_KEY, page)
  } catch {
    /* ignore */
  }
}
