import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CheckSquare,
  ClipboardCheck,
  Compass,
  Download,
  FileSearch,
  FolderKanban,
  HardDrive,
  HeartPulse,
  HelpCircle,
  KeyRound,
  Layers,
  LayoutDashboard,
  Map,
  MapPin,
  Navigation,
  Plug,
  QrCode,
  Route,
  Settings,
  Shield,
  Smartphone,
  Timer,
  Users,
  Waypoints,
  Wrench,
} from 'lucide-react'
import type { PageId } from '../app/nav'

export const pageIcons: Record<PageId, LucideIcon> = {
  dashboard: LayoutDashboard,
  organizations: Building2,
  users: Users,
  roles: Shield,
  properties: FolderKanban,
  'property-form': FolderKanban,
  'property-detail': FolderKanban,
  buildings: Building2,
  floors: Layers,
  locations: MapPin,
  'field-mapping': Map,
  'coordinate-review': Compass,
  'mapping-quality': ClipboardCheck,
  'approval-queue': CheckSquare,
  'correction-requests': Wrench,
  'map-publishing': Navigation,
  'map-versions': HardDrive,
  'map-viewer': Map,
  routes: Route,
  'route-preview': Waypoints,
  'property-codes': QrCode,
  'code-usage': Activity,
  'mobile-downloads': Download,
  'mobile-sessions': Smartphone,
  'journey-tracking': Navigation,
  'dwell-time': Timer,
  'tour-activity': Compass,
  'tenant-activity': Users,
  'api-clients': Plug,
  'api-keys': KeyRound,
  'api-usage': BarChart3,
  'api-logs': FileSearch,
  'api-navigation': Map,
  'access-integration': Shield,
  notifications: Bell,
  reports: BarChart3,
  'audit-logs': BookOpen,
  alerts: AlertTriangle,
  'system-health': HeartPulse,
  settings: Settings,
  help: HelpCircle,
}

export const groupIcons: Record<string, LucideIcon> = {
  Overview: LayoutDashboard,
  Organization: Users,
  Properties: Building2,
  Mapping: Map,
  'Mobile Access': Smartphone,
  Analytics: BarChart3,
  'API & Integrations': Plug,
  System: Settings,
}

type IconProps = {
  icon: LucideIcon
  size?: number
  className?: string
  strokeWidth?: number
}

export function Icon({ icon: Glyph, size = 16, className, strokeWidth = 1.85 }: IconProps) {
  return <Glyph size={size} className={className} strokeWidth={strokeWidth} aria-hidden />
}
