# Keiros ERP — User input fields (Firebase planning)

Living note of **persistable** user inputs by page.  
Update this file whenever a page/form with inputs is added or changed.  
Later: use these lists to design Firebase collections.

Format per field: `key` · Label · type · required? · notes

---

## Entity model (joins)

Canonical types: `ERP_Full/src/data/schema.ts` · runtime indexes: `entityMap.ts`

**Hierarchy**
- `Organization` 1—* `Complex` (`organizationId`)
- `Complex` 1—* `Building` (`complexId`; null = independent)
- `Building` 1—* `Floor` (`buildingId`)
- `Floor` 1—* `MapLocation` (`floorId`) — type name avoids DOM `Location`

**SiteProperty** (ops join root, `siteProperties`)
- `kind: complex` → `id = complex.id`
- `kind: independent` → `id = building.id`
- Floors / locations / routes / codes / versions / sessions / analytics all carry `propertyId`

**Cross-domain FKs**
| Child | Parent FK |
|-------|-----------|
| MapVersion, Route, PropertyCode, MobileSession, Tour, … | `propertyId` → SiteProperty |
| Approval, MapDownload | `mapVersionId` → MapVersion |
| CodeUsage | `propertyCodeId` → PropertyCode |
| Journey | `routeId` → Route |
| Correction, DwellMetric, TenantActivity.topDestination | `locationId` |
| Route endpoints | `fromLocationId` / `toLocationId` |
| User | `organizationId`, `roleId` |
| MappingQueueItem | `propertyId`, `floorId`, `mapperUserId` |
| ApiKey / ApiUsage / ApiLog | `apiClientId` |
| ApiClient | `organizationId` |

Display `*Name` fields are **cached labels only** — never sole join keys.

---

## Auth

### Sign in · collection hint: `users` / `sessions`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| email | Email address | string (email) | yes | |
| password | Password | string | yes | min 8 |
| rememberMe | Remember me | boolean | no | client preference |

### MFA · collection hint: `mfa_challenges`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| otp | Verification code | string | yes | 6 digits |
| email | Email address | string | yes | from prior step |

### Forgot password · collection hint: `password_reset_requests`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| email | Email address | string (email) | yes | |

### Reset password · collection hint: `users` (password hash update)
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| newPassword | New password | string | yes | min 10 |
| confirmPassword | Confirm password | string | yes | must match |

### First-time setup · collection hint: `users`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| newPassword | Set password | string | yes | min 10 |
| confirmPassword | Confirm password | string | yes | must match |
| acceptTerms | Accept Terms / Privacy | boolean | yes | must be true |

---

## Properties

Hierarchy: **Complex → Building → Floor → Unit / Location**

Nav (Properties): Complexes · Buildings · Floors · Units / Locations · **Wayfinding Map** · Route Management · Route Preview

### Add / Edit Complex · collection hint: `complexes`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Name | string | yes | |
| city | City | string | yes | |
| address | Address | string | no | |
| organizationName | Organization | string | yes | display cache |
| organizationId | Organization | ref | yes | → organizations |
| status | Status | enum | yes | Draft \| Mapped \| Review \| Published |
| buildings | Building count | number | system | derived |
| floors | Floor count | number | system | derived |
| readiness | Readiness | number | system | 0–100, derived from mapping progress |

### Add / Edit Building · collection hint: `buildings`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Name | string | yes | tower/block/section |
| affiliation | Affiliation | UI enum | yes | Complex \| Independent; determines `complexId` |
| complexId | Complex | ref/null | conditional | → complexes; `null` for independent buildings |
| status | Status | enum | yes | Active \| Draft \| Inactive |
| floors | Floor count | number | yes | non-negative |
| mappedFloors | Mapped floor count | number | system | derived |

### Add / Edit Floor · collection hint: `floors`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| buildingId | Building | ref | yes | |
| propertyId | Site property | ref | yes | complex id or independent building id |
| label | Floor label | string | yes | e.g. L02 |
| level | Level index | number | yes | |
| mappedPct | Mapped percent | number | no | 0–100 |
| locations | Location count | number | system | derived |

### Add / Edit Unit / Location · collection hint: `locations` (type: `MapLocation`)
Every unit/location has a **physical address** and a **coordinate address**.

| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| floorId | Floor | ref | yes | inherits building + complex |
| propertyId | Site property | ref | yes | complex id or independent building id |
| name | Name | string | yes | |
| type | Type | enum | yes | Room \| Unit \| Door \| Amenity \| Entry \| Exit \| Stairs \| Elevator \| Corridor \| Pool \| Gym \| Lobby \| Parking |
| code | Location code | string | no | |
| physicalAddress | Physical address | string | yes | street / suite / place address |
| latitude | Latitude | number | yes | WGS84 |
| longitude | Longitude | number | yes | WGS84 |
| elevation | Elevation (m) | number | yes | meters (MSL or project vertical datum) |
| mapped | Mapped | boolean | no | ready for routing |

---

## Organizations & access

### Organizations · collection hint: `organizations`
Create / Edit form active in UI.

| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Name | string | yes | |
| type | Type | enum | yes | Owner \| PMC \| Customer |
| status | Status | enum | yes | Active \| Pending \| Suspended |
| contactEmail | Contact email | string (email) | no | |
| notes | Notes | string | no | |
| id | Account ID | string | system | auto-generated |
| properties | Properties | number | system | starts at 0 |

### Organization members · collection hint: `organization_members` (or `users` with orgId)
Members modal on Organizations page.

| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| organizationId | Organization | ref | yes | → organizations |
| name | Name | string | yes | |
| email | Email | string (email) | yes | unique per org |
| role | Role | string / ref | yes | → roles |
| status | Status | enum | yes | Active \| Inactive |

### Users · collection hint: `users`
Invite / Edit form active on User Management page.

| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Name | string | yes | |
| email | Email | string (email) | yes | unique |
| role | Role | string | yes | display cache |
| roleId | Role | ref | yes | → roles |
| org | Organization | string | yes | display cache |
| organizationId | Organization | ref | yes | → organizations |
| status | Status | enum | yes | Active \| Inactive |
| id | User ID | string | system | auto-generated |
| lastAccess | Last access | string / timestamp | system | |

### Roles · collection hint: `roles`
Create / Edit form and access matrix active on Role Management page.

| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Role name | string | yes | unique |
| description | Description | string | no | |
| permissions | Permissions summary | string | system/derived | from matrix or description |
| usersCount | Assignments | number | system | |
| matrix | Access matrix | map | yes | module → { view, edit, approve } |
| matrix.*.view | View | enum | yes | Allow \| Deny \| N/A |
| matrix.*.edit | Edit | enum | yes | Allow \| Deny \| N/A |
| matrix.*.approve | Approve | enum | yes | Allow \| Deny \| N/A |
| id | Role ID | string | system | |

Modules in matrix: Properties, Mapping, Analytics, Publishing, API, Users.

---

## Mapping & publishing

All Mapping nav pages are interactive (assign / review / quality / approve / correct / publish / versions) with on-page help notes.

### Field Mapping · collection hint: `mapping_assignments` / `coordinate_captures`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Property | ref | yes | |
| floorLabel | Floor | string | yes | |
| mapperId | Mapper | ref | yes | → users |
| status | Status | enum | yes | Queued\|In Progress\|Blocked\|Complete |
| priority | Priority | number | no | |
| dueDate | Due date | date | no | |
| snapGrid | Snap grid | boolean | no | UI capture preference |
| *(planned capture)* lat, lng, heading, locationId | coordinates | number/ref | when capturing | |

### Coordinate Review / Approval Queue · collection hint: `approvals`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| decision | Approve / Reject | enum | yes | Approved \| Rejected |
| mapVersion | Map version | string | yes | |
| notes | Review notes | string | no | |

### Correction Requests · collection hint: `corrections`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyName | Property | ref/string | yes | |
| location | Location | string/ref | yes | |
| description | Description | string | yes | |
| assigneeId | Assignee | ref | no | |
| status | Status | enum | yes | Open \| Assigned \| Resolved |

### Map Publishing · collection hint: `map_releases`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Property | ref | yes | |
| version | Version | string | yes | |
| environment | Environment | enum | yes | Staging \| Production |
| releaseNote | Release note | string | no | |
| verified | Verification confirm | boolean | yes | must be true to publish |

### Map Viewer / Wayfinding Map · collection hint: `wayfinding_prefs` / session
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| complexId | Complex | ref | yes | drill-down root |
| buildingId | Building | ref | no | required below complex |
| floorId | Floor | ref | no | for floor / unit views |
| unitId | Unit / Location | ref | no | focus target |
| level | Map level | enum | yes | complex \| building \| floor \| unit |
| mode | 2D / 3D | enum | no | isometric stack for building/floor |
| showLabels | Labels | boolean | no | |
| showRoute | Route overlay | boolean | no | |
| darkBasemap | Dark basemap | boolean | no | free OSM/CARTO tiles, no API key |
| fromLocationId | Navigate from | ref | no | → locations |
| toLocationId | Navigate to | ref | no | → locations |

Maps are generated from location `latitude` / `longitude` / `elevation` (see Units / Locations). Basemap: OpenStreetMap + CARTO (no paid API).

---

## Routing (under Properties nav)

### Route Management · collection hint: `routes`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | → siteProperties |
| propertyName | Property name | string | yes | display cache |
| name | Route name | string | yes | often derived from from→to |
| status | Status | enum | yes | Active \| Draft \| Disabled |
| fromLocationId | From | ref | yes | → locations |
| toLocationId | To | ref | yes | → locations |
| waypoints | Waypoints | number | system | derived from pathfinding |
| avgDurationMin | Duration | number | system | derived from distance + floors |

### Route Preview · collection hint: session only / `route_previews`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| routeId | Route | ref | yes | |
| accessible | Accessible | boolean | no | prefer elevators over stairs |
| activeStep | Step index | number | no | UI only |
| viewMode | 2D / 3D | enum | no | default 3D blueprint with path |

---

## Mobile access

All Mobile Access nav pages are interactive (codes / usage / downloads / sessions) with on-page help notes.

### Property Codes · collection hint: `property_codes`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | → siteProperties / complex or independent building |
| propertyName | Property | string | yes | display cache |
| code | Code | string | yes | unique; QR encodes `https://keiros.ai/access?propertyId=&code=` |
| label | Label | string | no | |
| status | Status | enum | yes | Active \| Expired \| Revoked |
| expiresAt | Expires | date \| null | no | |

Tour App validates via `POST /api/v1/access/validate` (API key + `maps:read`). Success returns complex metadata and increments `code_usage.scans`.

### Code Usage · collection hint: `code_usage` (aggregated)
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyCodeId | Property code | ref | yes | → property_codes |
| propertyId | Site property | ref | yes | |
| code | Code | string | yes | display cache |
| propertyName | Property | string | yes | display cache |
| scans | Scans | number | system | |
| uniqueDevices | Devices | number | system | |
| lastUsed | Last used | datetime | system | |

### Map Downloads · collection hint: `map_downloads`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | |
| mapVersionId | Map version | ref | yes | → map_versions |
| propertyName | Property | string | yes | display cache |
| platform | Platform | enum | yes | iOS \| Android |
| version | Map version label | string | yes | display cache; align to Live on refresh |
| downloads | Downloads | number | system | |

### Mobile Sessions · collection hint: `mobile_sessions`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | |
| propertyName | Property | string | yes | display cache |
| deviceId | Device | string | yes | |
| userLabel | Profile | string | no | Visitor \| Staff \| … |
| status | State | enum | yes | Active \| Idle \| Ended |
| startedAt | Started | datetime | yes | |

### Journey Tracking · collection hint: `journeys` (aggregated from route sessions)
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | → siteProperties |
| routeId | Route | ref | yes | → routes |
| propertyName | Property | string | yes | display cache |
| routeName | Route | string | yes | display cache |
| sessions | Sessions | number | system | scaled by period filter in UI |
| completionRate | Completion % | number | system | 0–100 |
| avgDurationMin | Avg duration | number | system | minutes |

UI-only filters: period (Today \| 7 days \| 30 days \| Sep 1-4), minCompletion, search, chart metric (Completion \| Sessions \| Duration). CSV export = filtered rows (UTF-8 BOM).

### Dwell-Time · collection hint: `dwell_metrics`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | → siteProperties |
| locationId | Location / zone | ref | yes | → locations |
| propertyName | Property | string | yes | display cache |
| zone | Zone label | string | yes | editable in Configure zones |
| avgDwellMin | Avg dwell | number | system | minutes |
| visits | Visits | number | system | scaled by period |
| peakHour | Peak hour | string | system | HH:mm |
| liveDwellSec | Live dwell (sec) | number | system | Tour App heartbeat |
| liveUpdatedAt | Live updated | timestamp | system | ISO |
| activeVisitors | Active visitors | number | system | enter/leave counter |
| source | Source | string | system | `TOUR_APP` when live |

Written by Tour App via `POST /api/v1/tracking/dwell` (enter / heartbeat ~5s / leave / complete). ERP Dwell-Time auto-refreshes every 5s. UI filters: property, period, minDwellMin, Tour App live only, search. Configure zones: rename / watch.

### Tour Activity · collection hint: `tours`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | → siteProperties |
| propertyName | Property | string | yes | display cache |
| tourName | Tour | string | yes | |
| starts | Starts | number | system | scaled by period |
| completions | Completions | number | system | scaled by period |
| avgSteps | Avg steps | number | yes | |

UI: Create tour form; property/period/search filters; CSV export.

### Tenant Activity · collection hint: `tenant_activity`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Site property | ref | yes | → siteProperties |
| propertyName | Property | string | yes | display cache |
| tenant | Tenant | string | yes | masked when anonymization=Full |
| visits | Visits | number | system | scaled by period |
| lastVisit | Last visit | datetime | system | |
| topDestinationLocationId | Top destination | ref | yes | → locations |
| topDestination | Destination label | string | yes | display cache |

### Tenant Activity data controls · collection hint: `analytics_prefs` or report params
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| minimumVisits | Minimum visits | number | no | applied via Apply |
| anonymization | Anonymization | enum | no | Tenant only \| Full |

### Dwell-Time filter
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| minDwellMin | Min dwell | number | no | UI filter / report param |

---

## API & integrations

Interactive ERP pages: Clients (register / enable / disable), Keys (create / rotate / revoke), Usage (filters + export), Logs (detail + status filters), Access Integration (RFID settings + reader status). Prefer `organizationId` / `apiClientId` joins; `org` / `clientName` are display caches.

### API Clients · collection hint: `api_clients`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Name | string | yes | |
| organizationId | Organization | ref | yes | → organizations |
| org | Org name | string | yes | display cache |
| environment | Environment | enum | yes | Production \| Staging \| Development |
| createdAt | Created | date | system | |
| status | Status | enum | yes | Active \| Disabled |

UI filters: environment, status, search. Cross-nav: API Keys, Usage.

### API Keys · collection hint: `api_keys`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| apiClientId | Client | ref | yes | → api_clients |
| clientName | Client name | string | yes | display cache |
| prefix | Prefix | string | yes | public display prefix |
| keyHash | Secret hash | string | yes* | SHA-256 of full key; *required for newly issued keys |
| lastFour | Last 4 | string | no | recognition only |
| scopes | Scopes | string | yes | e.g. maps:read, routes:read |
| status | Status | enum | yes | Active \| Rotated \| Revoked |
| createdAt | Created | datetime | no | |
| lastUsed | Last used | string/date | system | updated by ERP API server |

UI: create / rotate (show full secret **once**) / revoke. Never re-display plaintext secret.

### API Usage · collection hint: `api_usage_stats` (aggregated)
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| apiClientId | Client | ref | yes | → api_clients |
| clientName | Client | string | yes | display cache |
| endpoint | Endpoint | string | yes | |
| requests | Requests | number | system | |
| errors | Errors | number | system | |
| p95Ms | p95 latency | number | system | ms |

UI filters: client, period; export CSV; cross-nav to Logs.

### API Logs · collection hint: `api_logs`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| timestamp | Time | datetime | yes | |
| apiClientId | Client | ref | yes | → api_clients |
| clientName | Client | string | yes | display cache |
| method | Method | string | yes | GET \| POST \| … |
| path | Path | string | yes | |
| status | HTTP status | number | yes | |
| durationMs | Duration | number | yes | ms |
| meta | Meta | object | no | written by ERP API server (requestId, sessionId, …) |

UI filters: client, method, status class (2xx/4xx/5xx), search path. Auto-refresh shows API_DEMO traffic.

### API Navigation Live · collection hint: `navigation_sessions`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| createdAt | Time | datetime | yes | |
| status | Status | enum | yes | Active \| Completed \| Failed |
| source | Source | string | yes | e.g. API_DEMO |
| apiClientId | Client | ref | yes | → api_clients |
| clientName | Client | string | yes | |
| complexId / complexName | Complex | ref/string | no | |
| buildingId / buildingName | Building | ref/string | yes | |
| floorId / floorLabel | Floor | ref/string | yes | |
| unitId / unitName / unitCode | Unit | ref/string | yes | |
| originMiles | Start offset | number | yes | currently 20 |
| outdoorDistanceMiles | Outdoor mi | number | yes | |
| outdoorDurationMin | Outdoor min | number | yes | |
| indoorWalkMin | Indoor min | number | yes | |
| trafficLevel | Traffic | string | yes | Light…Severe |
| weatherSummary / temperatureF | Weather | string/number | no | Open-Meteo |
| requestPath | Path | string | yes | /api/v1/navigate |

Written by `ERP_Full/server` on navigate; ERP UI polls Firestore. Client: `API_DEMO`.

### Access Integration · collection hint: `access_integrations`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| rfidEnabled | RFID enabled | boolean | yes | |
| readerMode | Reader mode | enum | yes | passive \| active |
| syncIntervalMin | Sync interval (min) | number | yes | |
| defaultPropertyId | Default property | ref | no | → siteProperties |

UI: save settings; reader online/lag KPIs; links to Property Codes / Mobile Sessions.

### Notifications / ERS · collection hint: `notification_rules` *(planned)*
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| enabled | Enabled | boolean | yes | |
| channel | Channel | enum | no | email \| webhook \| etc. |
| severity | Severity filter | enum | no | |

---

## System

Interactive ERP pages: Reports (queue / download), Audit Logs (filter / export), Alerts (ack / reopen), System Health (refresh + service detail), Settings (dirty save/reset), Help (FAQ + support ticket). Prefer FK joins (`actorUserId`, `serviceId`, `propertyId`).

### Reports · collection hint: `report_jobs`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| reportType | Report type | enum | yes | mapping\|routing\|mobile\|dwell\|api\|readiness |
| propertyId | Scope property | ref | no | → siteProperties; null/all = portfolio |
| propertyName | Property | string | no | display cache |
| period | Period | enum | yes | Today \| Last 7 days \| Last 30 days \| custom range label |
| status | Job status | enum | system | Queued \| Running \| Ready \| Failed |
| createdAt | Created | datetime | system | |

UI: Generate, Download CSV, Open live related page.

### Audit Logs · collection hint: `audit_logs`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| timestamp | Time | datetime | yes | |
| actorUserId | Actor user | ref | no | → users; null for system |
| actor | Actor name | string | yes | display cache |
| action | Action | string | yes | |
| target | Target | string | yes | |
| ip | IP | string | no | |

UI filters: search, action, actor; export CSV.

### Alerts · collection hint: `alerts`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| title | Title | string | yes | |
| source | Source | string | yes | |
| serviceId | Service | ref | no | → system_health_services |
| severity | Severity | enum | yes | Info \| Warning \| Critical |
| triggeredAt | Triggered | datetime | yes | |
| acknowledged | Acknowledged | boolean | yes | |

UI: severity/state filters; Acknowledge / Reopen; Ack all open.

### System Health · collection hint: `system_health_services`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| name | Service | string | yes | |
| health | Health | enum | yes | Healthy \| Degraded \| Down |
| latencyMs | Latency | number | system | ms |
| uptimePct | Uptime | number | system | 0–100 |

UI: Refresh (sample metrics); select card for linked alerts.

### Settings · collection hint: `erp_settings` (singleton or org-scoped)
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| codePrefixFormat | Code prefix format | string | yes | e.g. {PROP}-{CITY}-{YEAR} |
| defaultCodeExpiryDays | Default expiry (days) | number | yes | ≥ 1 |
| allowCodeReuse | Allow reuse | boolean | yes | |
| sessionTimeoutMin | Session timeout (min) | number | yes | ≥ 1 |
| dwellThresholdMin | Dwell threshold (min) | number | yes | ≥ 1 |
| anonymizeDeviceIds | Anonymize device IDs | boolean | yes | |
| apiRateLimitPerMin | Rate limit (req/min) | number | yes | |
| apiBurstLimit | Burst limit | number | yes | |
| keyRotationDays | Key rotation (days) | number | yes | |
| defaultSender | Default sender | string (email) | yes | |
| ersWebhookUrl | ERS webhook URL | string (url) | no | |
| digestFrequency | Digest frequency | enum | yes | hourly \| daily \| weekly |

UI: Save all / Reset unsaved; cross-nav to related ops pages.

### Help / Support · collection hint: `support_tickets` *(UI submit)*
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| topic | Topic | enum | yes | Account \| Mapping \| Mobile access \| API / integrations \| Other |
| subject | Subject | string | yes | |
| message | Message | string | yes | |
| status | Status | enum | system | Queued \| Sent |
| createdAt | Created | datetime | system | |

FAQ / troubleshooting search is UI-only.

---

## UI-only filters (usually not Firebase collections)

Search boxes, status dropdowns “All”, severity filters, platform filters, auto-refresh toggles, map layer checkboxes (unless saved as user prefs).

---

## Tour App Web UI (`TourAppWebUI`)

Visitor mobile tour flow. Mocked locally in v1; fields below are for future Firebase collections.

### Consent · collection hint: `tour_consents`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| location | Location consent | boolean | yes | geolocation |
| navigation | Navigation consent | boolean | yes | required for routing |
| tracking | Journey tracking consent | boolean | no | path / dwell analytics |
| askedAt | Asked at | datetime | system | |

### Property code entry · collection hint: `code_usages` / `property_codes`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyCode | Property code | string | yes | e.g. KEIROS-DEMO; QR scan fills same field |
| validatedAt | Validated at | datetime | system | |
| propertyId | Property id | string | system | from validation |

### Map download session · collection hint: `map_downloads`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| propertyId | Property id | string | yes | |
| mapVersionId | Map version | string | yes | when wired to backend |
| downloadedAt | Downloaded at | datetime | system | |
| deviceId | Device id | string | no | anonymize per settings |

### Destination search · collection hint: `tour_sessions` (selection)
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| query | Search query | string | no | UI filter |
| filterType | Amenity filter | enum | no | all \| unit \| gym \| pool \| club \| leas \| park \| other |
| unitId | Selected destination | string | yes | MapLocation id |
| complexId | Complex | string | no | |

### Journey tracking events · collection hint: `journey_events`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| sessionId | Tour session | string | yes | |
| kind | Event kind | enum | yes | location \| step \| dwell \| destination |
| label | Label | string | yes | |
| latitude | Latitude | number | no | |
| longitude | Longitude | number | no | |
| dwellSec | Dwell seconds | number | no | |
| at | Timestamp | datetime | yes | |

### Door / facility access · collection hint: `access_requests`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| facilityId | Facility id | string | yes | |
| facilityName | Facility name | string | yes | |
| status | Status | enum | system | pending \| granted \| denied |
| expiresAt | Access expires | datetime | no | |
| message | Result message | string | no | |
| requestedAt | Requested at | datetime | system | |

### Tour feedback · collection hint: `tour_feedback`
| key | label | type | req | notes |
|-----|-------|------|-----|-------|
| rating | Rating | number | yes | 1–5 |
| interestUnits | Interested units | string[] | no | unit names / ids |
| interestAmenities | Interested amenities | string[] | no | Gym, Pool, Clubhouse, … |
| comments | Comments | string | no | |
| contactOptIn | Contact opt-in | boolean | no | |
| email | Email | string (email) | conditional | required if contactOptIn |
| propertyId | Property id | string | yes | |
| sessionId | Tour session | string | no | |
| submittedAt | Submitted at | datetime | system | |

---

## Changelog

- 2026-09-13 — Tour App live dwell: `POST /api/v1/tracking/dwell` → `dwell_metrics` live fields; ERP Dwell-Time auto-refresh.
- 2026-09-13 — Tour App Web UI: consent, property code, map download, destination, tracking, door access, feedback fields.
- 2026-09-04 — Initial inventory from Auth + 40 ERP pages (forms present in UI).
- 2026-09-04 — Organizations Add org form activated (name, type, status, contactEmail, notes).
- 2026-09-04 — Organizations: Edit, Members, Activate/Pending/Suspend, filters; member fields documented.
- 2026-09-04 — User Management: Invite, Edit, Activate/Deactivate, filters, Export CSV; user fields documented.
- 2026-09-04 — Role Management: Create, Edit, Duplicate, Delete, matrix toggles; role/matrix fields documented.
- 2026-09-04 — Property hierarchy: interactive Complex, Building (including independent), Floor, and Location forms documented.
- 2026-09-04 — Location foundational address: physicalAddress + latitude, longitude, elevation required.
