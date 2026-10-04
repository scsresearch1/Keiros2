# Keiros ERP — User Manual

Use this manual to operate Keiros ERP. It follows the screens in the order you use them: sign in, set up the property, approve the map, publish it, and hand visitors a tour code.

Keiros ERP is where your team keeps indoor maps for a property. Visitors use a separate app, the Keiros Tour App. You prepare the map and the access code here. They follow the tour there.

---

## Contents

1. [Sign in and sign out](#1-sign-in-and-sign-out)
2. [Move around the product](#2-move-around-the-product)
3. [Start from the Home Dashboard](#3-start-from-the-home-dashboard)
4. [Set up the organization and the people](#4-set-up-the-organization-and-the-people)
5. [Build the property](#5-build-the-property)
6. [Look at a route](#6-look-at-a-route)
7. [Take a map from field work to published](#7-take-a-map-from-field-work-to-published)
8. [Let visitors into the tour](#8-let-visitors-into-the-tour)
9. [See what visitors did](#9-see-what-visitors-did)
10. [Connect another system](#10-connect-another-system)
11. [Reports, alerts, and settings](#11-reports-alerts-and-settings)
12. [Jobs you will repeat](#12-jobs-you-will-repeat)
13. [When something does not work](#13-when-something-does-not-work)

---

## 1. Sign in and sign out

### Open the product

1. Open the Keiros ERP site.
2. Choose **Sign in** in the top corner, or **Enter product** on the main screen.

Both buttons open the same sign-in card. The words Mapped, Approved, Published, Navigable, Trackable, and API-ready on the first screen are a short description of the product. They are not pages.

### Sign in

1. Enter your **Email address**.
2. Enter your **Password**.
3. Choose **Show** if you want to read the password, then **Hide** to cover it again.
4. Leave **Remember me** checked on a computer only you use.
5. Choose **Sign in**.

Wait while the product checks the sign-in. When it succeeds, the workspace opens on the last page you had open in this browser tab.

If a field is empty or the email is not a real email address, the card says **Check the highlighted fields and try again.** The password must be at least 8 characters.

If the email or password is wrong, the card says **Incorrect credentials. Access was not granted.** Correct them and choose **Sign in** again.

### Reset a forgotten password

1. On the sign-in card, choose **Forgot password**.
2. Enter the work email and choose **Send reset link**. The button reads **Sending…** while it works.
3. When the card says **Reset link sent. Check your work email.**, choose **Continue to reset password**.
4. Enter a **New password** of at least 10 characters.
5. Enter the same password in **Confirm password**.
6. Choose **Update password**. It reads **Saving…** while it works.
7. When you see **Password updated. Sign in with your new password.**, sign in with the new password.

If the two passwords do not match, or the new password is too short, the card asks you to check the highlighted fields.

**Back to sign in** leaves the reset without changing the password.

### Get help signing in

Choose **Need help?** or **Support**. The card shows:

- Email: support@keiros.ai
- Hours: Monday–Friday, 09:00–18:00 IST
- What to include: your work email and the message on the screen

Choose **Email support** to write to that address, or **Back to sign in** to return.

The Keiros logo at the top of the sign-in page returns you to the first screen.

### Sign out

1. Choose **Sign out** in the top bar.
2. Confirm **Sign out**, or choose **Cancel** to stay.

You will need to sign in again to continue.

**Session expired** in the top bar ends the sign-in immediately and returns you to a card that says **Your session expired.** Choose **Sign in again**.

Anything you had typed into a form and not saved is gone after you leave.

---

## 2. Move around the product

The left sidebar is the menu. The page you select fills the area on the right. Your email is in the top bar.

Select a group name to fold or unfold it. Select a page name to open that page. The open page stays highlighted.

On a narrow screen, use the menu button at the top left to open the sidebar. Click the dimmed area beside it to close the sidebar.

At the bottom of the sidebar, choose **Light** or **Dark**. The choice stays on this browser.

| Group | Open these pages |
| --- | --- |
| Overview | Home Dashboard |
| Organization | Organizations, User Management, Role Management |
| Properties | Complexes, Buildings, Floors, Units / Locations, Wayfinding Map, Route Management, Route Preview |
| Mapping | Field Mapping, Coordinate Review, Mapping Quality, Approval Queue, Correction Requests, Map Publishing, Map Versions |
| Mobile Access | Property Codes, Code Usage, Map Downloads, Mobile Sessions |
| Analytics | Journey Tracking, Dwell-Time, Tour Activity, Tenant Activity |
| API & Integrations | API Clients, API Keys, API Usage, API Logs, API Navigation Live, Access Integration, Notifications / ERS |
| System | Reports, Audit Logs, Alerts, System Health, Settings, Help / Support |

Most work pages follow the same pattern:

- A short note at the top tells you what the page is for.
- The numbers across the top count what is on the page.
- Search and filters only change the list you are looking at. They do not delete anything.
- The list is on the left. Details for the row you select are on the right.
- **Add**, **Edit**, and similar actions open a form. **Cancel** or the close mark leaves the form without saving. The primary button on the form saves it.

---

## 3. Start from the Home Dashboard

Open **Overview → Home Dashboard** at the start of a shift. This page is for reading. It does not edit the map.

You will see:

- **Properties, Published, In review, Readiness, Approvals, and Corrections** across the top.
- **Portfolio readiness**, a chart of each complex.
- **Work queue**, bars for field mapping, quality issues, active users, and mobile sessions.
- **Journey sessions** and **API request volume**.
- **Priority activity**, a table of Area, Property, Item, Owner, and Status. If nothing needs attention, the table says **No priority activity right now.**

Use the counts to decide where to go next. Open the matching page from the sidebar. The bars and the table on this screen do not open those pages for you.

---

## 4. Set up the organization and the people

Do this before you add a property. A person can sign in only when they have an organization and a role, and their status is Active.

### Add the organization

Open **Organization → Organizations**.

1. Choose **Add organization**.
2. Enter **Name**.
3. Choose **Type**: Owner, PMC, or Customer.
4. Choose **Status**. Use **Pending** until the account is ready. Use **Active** when people and properties should be linked to it. Use **Suspended** to stop new links without removing the history.
5. Enter **Contact email** and **Notes** if you have them.
6. Choose **Create organization**.

To change one later, select it in the directory, choose **Edit**, and **Save changes**. You can also set the status from the summary with **Activate**, **Pending**, or **Suspended**. Set the organization to Active before you attach properties or invite people.

**Members** on the selected organization lists the people already on that account. From that list you can add a person, or **Activate** / **Deactivate** someone. Sign-in access for the whole product is still controlled under User Management.

### Invite a person

Open **Organization → User Management**.

1. Choose **Invite user**.
2. Enter **Name** and **Email**. The email must not already be in use.
3. Choose **Role** and **Organization**.
4. Set **Status** to **Active** if they should sign in now, or **Inactive** if not.
5. Choose **Send invite**.

Select a person later to **Edit** them, **Activate** them, or **Deactivate** them. Deactivate blocks sign-in and keeps their history.

**Export CSV** downloads only the people that match the search and filters currently on the page.

### Decide what a role can do

Open **Organization → Role Management**.

A role is the set of permissions you assign to people. The matrix has six areas: Properties, Mapping, Analytics, Publishing, API, and Users. Each area has View, Edit, and Approve. A cell reads **Allow**, **Deny**, or **N/A**.

1. Choose **Create role** and name it.
2. Open the role.
3. Click a cell to switch it between Allow and Deny. Cells marked N/A do not change.
4. The change is kept as you click. You do not need a separate save on each cell.

**Duplicate** copies that access onto a new role with nobody assigned yet.

**Delete** works only when nobody has the role. Move those people to another role first.

---

## 5. Build the property

Enter places in this order. Each one hangs off the one before it.

**Complex → Building → Floor → Unit / Location**

A complex is the campus. A building can sit in that complex, or stand alone. A floor belongs to one building. A location is a place a person can be sent to, or a connection such as stairs or an elevator.

### Add a complex

Open **Properties → Complexes** and choose **Add complex**.

1. Enter **Name** and **City**.
2. Enter **Address** if you have it.
3. Choose the **Organization**. It should already be Active.
4. Choose **Status**: Draft, Mapped, Review, or Published. Leave it on Draft until the map has actually been published.
5. Save.

Search by complex, city, or organization. Filter by status. Select a row and choose **Edit** to change it. The summary on the right shows coverage and readiness for that complex.

### Add a building

Open **Properties → Buildings** and choose **Add building**.

1. Enter **Name**.
2. Choose whether it belongs to a complex or is independent. If it belongs to a complex, choose which one.
3. Choose **Status**: Active, Draft, or Inactive.
4. Enter **Floor count**.
5. Choose **Create building**.

An independent building has no campus, but it still has floors and locations. Use a complex when several buildings are managed together.

Search by building or complex. Filter by **In complex**, **Independent**, or a specific complex. Select a building and choose **Edit** to change it.

### Add a floor

Open **Properties → Floors** and choose **Add floor**.

1. Choose the **Building**.
2. Enter a **Label** people will recognize, such as L01.
3. Enter **Level** as a number. The lowest floor must have the lowest number. The tour walks upward from that floor.
4. Enter **Mapped %** only if you already know how much of the floor is mapped. Use a number from 0 to 100.
5. Choose **Create floor**.

Search by floor, building, or complex. Filter by building and complex. Select a floor and choose **Edit** to change it.

### Add a place on the floor

Open **Properties → Units / Locations** and choose **Add location**.

1. Choose the **Floor**.
2. Enter **Name**.
3. Choose **Type**: Room, Unit, Door, Amenity, Entry, Exit, Stairs, Elevator, Corridor, Pool, Gym, Lobby, or Parking.
4. Enter a short **Code** if your team uses one.
5. Enter the **Physical address** (street, unit or suite, and city).
6. Enter **Latitude**, **Longitude**, and **Elevation (m)**. All three are required. Elevation is what separates one floor from another on a route.
7. Turn on **Mapped** only when the point is ready to be used in a route.
8. Choose **Create location**.

Search by name, code, building, or floor. Filter by type, building, and floor. Select a place and choose **Edit** to change it.

Leave **Mapped** off while the point is still a draft. A route should start and end on places that are marked mapped.

---

## 6. Look at a route

### Try a path without saving it

Open **Properties → Wayfinding Map**.

1. Every list starts on **Select**. Choose the complex, then the building, then the floor. Each choice shortens the next list.
2. Choose **From** and **To**.
3. Read the steps to that place.

Use the zoom controls on the map. Choose the reset control to return to the starting view.

### Save a named route

Open **Properties → Route Management**.

1. Open **Create route**.
2. Choose the **Property**.
3. Enter a **Route name**.
4. Choose **From** and **To**. Both must already exist as locations on that property.
5. Choose **Status**.
6. Save.

The product fills in the path and the time from the coordinates. You do not draw the line yourself.

Search the list with **Search routes**. Select a route to read it or to edit it. Open **Preview** on the selected route to walk it.

### Walk a saved route

Open **Properties → Route Preview**, or open Preview from the route you just saved.

- The first view is the building blueprint, with the path drawn through the floors.
- Drag to turn the building. Scroll to zoom. Use the buttons on the map to zoom in, zoom out, or reset the view.
- Switch to the flat map when you want the street map instead of the blueprint.
- Turn on accessible mode when the path should prefer elevators.
- Read the steps under **Directions**.

---

## 7. Take a map from field work to published

Visitors only receive a map after it is published. Do the pages in this section in order.

### Queue the field work

Open **Mapping → Field Mapping**.

1. Create a job.
2. Choose the **Property** and **Floor**.
3. Choose the **Mapper**, the **Priority**, and the **Due date**.
4. Save. The job is **Queued**.

Select the job, then:

- **Open capture** when the mapper is on site. The job becomes In Progress. Use this from Queued or Blocked.
- **Mark complete** when the coordinates are ready for review.
- **Block** when the mapper cannot finish, for example because they cannot get into the space.
- **Reassign** to give the job to someone else, or to leave it Unassigned.
- **Send to review** after it is complete. That opens Coordinate Review.

Search by property, floor, or mapper, and filter by status, to find the job.

### Check the points

Open **Mapping → Coordinate Review**.

1. Choose the property, the floor, and the layer.
2. Select a place. Confirm the name, the type, and the coordinates.
3. Keep points on the grid. If a point is clearly in the wrong place, reject the floor or send it back as a correction.
4. Add **Review notes** if the next person needs them.
5. Choose **Approve coordinates** or **Reject floor**.

A rejection sends the floor back to mapping. The notes stay with the decision.

### Clear quality findings

Open **Mapping → Mapping Quality**.

Filter by severity. Clear **Critical** and **High** findings before anyone approves the package. If the fix needs someone to go back on site, log a correction and assign a mapper.

### Approve the package

Open **Mapping → Approval Queue**.

1. Filter to the items still waiting.
2. Select the package.
3. Add **Notes** if you want them kept with the decision.
4. Approve it, or reject it.

Approve only after coordinate review and the quality checks have passed. A rejection returns the package to mapping.

### Ask for a fix

Open **Mapping → Correction Requests** when a name or a point needs a field change.

1. Create a request.
2. Choose the **Property** and the **Location**.
3. Describe what needs to change.
4. Choose the **Assignee**.
5. Save.

Select the request and mark it **Assigned** when someone owns it. After the update has been checked again in Coordinate Review, mark it **Resolved**.

### Publish

Open **Mapping → Map Publishing**.

1. Choose the **Property**.
2. Choose the **Version**.
3. Choose **Staging** for a last check, or **Production** when visitors and other systems should receive it.
4. Write a **Release note**.
5. Choose **Validate only** if you want the checks without publishing.
6. Tick **I verified approval and checks.**
7. Choose **Publish**.

Publish stays unavailable until a version is selected and that box is ticked. Publishing to Production makes this version the live map and retires the previous live map for the same property.

### Keep the version history

Open **Mapping → Map Versions**.

Versions move from Draft, to Staging, to Live, to Archived.

- Filter by state.
- Pick **Compare A** and **Compare B** to look at two versions before you publish.
- Promote a version when the checks have passed.
- Archive a live version that has been replaced.

A property with an active tour code should have one Live version.

---

## 8. Let visitors into the tour

### Create the code

Open **Mobile Access → Property Codes** and choose **Generate code**.

1. Choose the **Property**.
2. Enter a **Label** your team will recognize, such as Lobby pedestal.
3. Set **Expires**, or leave the code without an expiry if it should last until you revoke it.
4. Choose **Generate**.

The page shows the code and a QR image. The visitor can type the code or scan the QR.

On the selected code:

- **Download branded QR** saves the image to print for the lobby, the leasing desk, or a model door.
- **Copy code** copies the text.
- **Revoke** stops an active code. Do this as soon as a code is posted in the wrong place or a campaign ends.
- **Reactivate** turns an expired or revoked code back on.

Search by property or code. Filter by **Active**, **Expired**, or **Revoked**. **Export** downloads the list you are looking at. **Usage** opens the page of scans.

How long a new code lasts, the prefix on new codes, and whether a code can be used again are set under **Settings**, in **Property code rules**. Those rules apply to codes you create after you save them.

### See who used a code

Open **Mobile Access → Code Usage**.

Filter by property and select a row. Use this when a visitor says the code failed. Then check the same code under Property Codes and confirm it is Active and not past its expiry date.

### See who downloaded the map

Open **Mobile Access → Map Downloads**.

Filter by **iOS**, **Android**, or **All**. Select a row to see the property, the map version, and the device.

Choose **Force sync** after you publish a new live map, so that device picks up the new package instead of the old one.

### See who is on a tour right now

Open **Mobile Access → Mobile Sessions**.

Filter by **Active**, **Idle**, or **Ended**. Select a session to see when it started and which map it is using.

- **Wake** brings an idle session back while the visitor is still on site.
- **End session** closes a session that is still open.

How long a quiet session stays open is set under **Settings**, in **Session timeout**.

---

## 9. See what visitors did

These pages are for reading. Filters change the charts. They do not delete visits.

### Paths people walked

Open **Analytics → Journey Tracking**.

Search by property or route. Filter by property and by period. Select a journey to read the steps.

A path also appears here when another system asks Keiros for directions and the request succeeds. If a test does not show up, look at API Logs, then come back.

### Time spent in a place

Open **Analytics → Dwell-Time**.

This page refreshes on its own about every 5 seconds, so you can leave it open during a live tour.

Search by zone or property. Filter by property and period. You can limit the list to visits longer than a minimum, and to tours that are live in the Tour App.

Open zone settings to rename a zone or to choose which places are watched. The zone name is what the chart shows. The place you attach is the unit or amenity on the map.

Visitors only send this timing if they choose **Enable** when the Tour App asks **Track time at each stop?** The minimum time that counts is **Dwell threshold** under Settings.

### Tours

Open **Analytics → Tour Activity**.

Search by tour or property, then filter by property and period.

To name a tour in the report, create one, enter the **Tour name**, choose the **Property**, and enter **Avg steps** if you want an expected length on the record.

### Repeat visits

Open **Analytics → Tenant Activity**.

Search by tenant or property. Filter by property and period. Set **Minimum visits** so a one-time guest stays off the list. Set **Anonymization** when the report should hide direct names.

To hide device identifiers across the product, set **Anonymize device IDs** to Yes under Settings.

---

## 10. Connect another system

Use this section when a leasing site, a kiosk, or another app needs to ask Keiros for a route.

### Register the other system

Open **API & Integrations → API Clients** and choose **Register client**.

Enter the name and the organization, then choose **Register**. The client should be Active before you create a key.

Select the client later:

- **Disable** stops every key on that client. Call history stays in API Logs.
- **Activate** turns it back on.
- **Manage keys** opens the key page.

### Create a key

Open **API & Integrations → API Keys**.

1. Choose **Create key**.
2. Select the client.
3. Choose **Issue secret**.

Copy the secret immediately and store it in the other system. It is shown once. If you lose it, you cannot open this page and read it again. Create a replacement with **Rotate secret**.

**Sync** reloads the list.

On an active key:

- **Rotate secret** issues a new secret and stops the old one. Copy the new secret into the other system before you leave the page.
- **Revoke** stops a key at once. A revoked key cannot be turned back on. Issue a new key if that system still needs access.

How old a key should be before you rotate it is **Key rotation** under Settings. The setting is the rule. You still rotate each key on this page.

### Watch the calls

Open **API & Integrations → API Usage**.

Read the request count, the errors, and how slow the calls are. Choose **Sync** or turn on auto refresh if you just ran a test and the numbers have not moved. **Export** downloads the view.

If errors climb, or calls get slow, open **API Logs** next.

Open **API & Integrations → API Logs**. Turn on auto refresh while you are testing. Filter by status when you are looking for failures. Open a row to read what was asked and how it ended. **Export** downloads the list you are looking at.

Open **API & Integrations → API Navigation Live** while someone is requesting a route. You can see the path that came back without reading the full log. From here you can jump to API Logs or Journey Tracking.

### Badge readers

Open **API & Integrations → Access Integration**.

1. Set **RFID enabled** to Yes or No.
2. Set **Reader mode** to Passive or Active. Passive checks on a timer. Active sends each event as it happens.
3. Set **Sync interval (min)**.
4. Choose the property that should receive a badge when it does not match a code.
5. Choose **Save settings**.

**Sync now** runs a check immediately. It is available when RFID is enabled. **Clear pending** drops events that are waiting.

If events arrive late, shorten the interval or switch the reader to Active, and confirm the reader is listed as online.

### Where alerts go

Open **API & Integrations → Notifications / ERS**.

Each rule sends to Email, to ERS, or to both. Typical rules are a failed publish, a spike in API errors, a mapping deadline, and a reader that goes offline.

Choose **Disable** to silence a rule without deleting it. Choose **Enable** when it should send again.

The sender address, the ERS address, and how often digests go out are under **Settings**, in **Notifications**.

---

## 11. Reports, alerts, and settings

### Download a report

Open **System → Reports**.

1. Choose one property, or all properties.
2. Choose the period.
3. Choose **Generate** on the report you want:
   - Mapping progress
   - Routing performance
   - Mobile usage
   - Dwell time
   - API usage
   - Property readiness
4. Wait until the job in **Job history** says it is ready.
5. Select the job and download it.

The job stays in the list until you download it. Generating a report does not change maps, codes, or people.

### Read the audit log

Open **System → Audit Logs**.

Filter by the person and the action. Select an event to read the detail. **Export CSV** downloads the events that match the filter. You do not edit these entries.

### Handle an alert

Open **System → Alerts**.

Open the alert, then **Acknowledge** it when someone is handling it. **Reopen** it if the problem comes back.

For a critical alert, open **System Health** and refresh it first. Acknowledge the alert when the related service looks stable.

### Check that the product is up

Open **System → System Health** and choose **Refresh**. Open a service to read its detail. Use this page before you tell someone that Keiros is down.

### Change the rules for the whole organization

Open **System → Settings**.

Edit the form, then choose **Save all**. **Reset** throws away edits you have not saved. The page says **Unsaved changes** until you save or reset. Saving does not rewrite old codes, old sessions, or old reports.

**Property code rules**

- **Code prefix format** is required. It shapes new codes.
- **Default expiry (days)** is used when you do not pick a date. Use at least 1.
- **Allow reuse**: Yes lets the same code be used again. No means the visitor needs a new code after it has been used.

**Tracking rules**

- **Session timeout (min)** is how long a quiet tour stays open.
- **Dwell threshold (min)** is the shortest visit that counts.
- **Anonymize device IDs**: Yes hides device identifiers.

**API limits**

- **Rate limit (req/min)** is the steady cap.
- **Burst limit** is the short spike allowed above that cap.
- **Key rotation (days)** is how old a key should be before you rotate it.

**Notifications**

- **Default sender** must be an email address.
- **ERS webhook URL** is where those alerts are delivered.
- **Digest frequency** is Hourly, Daily, or Weekly.

Each section has a button that opens the related page, such as Property codes or API keys.

### Ask for help

Open **System → Help / Support**.

1. Search the questions and the tips.
2. Open a question, then **Open page** to go to the screen it describes.
3. If you still need help, fill in **Contact support**:
   - **Topic**: Account, Mapping, Mobile access, API / integrations, or Other
   - **Subject**
   - **Message**: what happened, which property or client, and what you already tried
4. Choose **Submit ticket**. Subject and message are required. The page confirms the ticket was sent to support@keiros.ai and lists it below the form.

You can also email support@keiros.ai directly.

---

## 12. Jobs you will repeat

### Put a new property on the tour

1. Activate the organization.
2. Add the complex, or plan an independent building.
3. Add the building, then a floor for each level. Number the levels from the bottom up.
4. Add the lobby, the homes, the amenities, the stairs, and the elevators. Enter latitude, longitude, and elevation. Turn **Mapped** on when the point is checked.
5. Queue the field job, open capture, mark it complete, and send it to review.
6. Approve the coordinates, or reject them and fix them.
7. Clear Critical and High quality findings.
8. Approve the package.
9. Publish to Staging if you want a last look, then publish to Production. Tick the confirmation box first.
10. Create a route and open Route Preview.
11. Generate a property code, download the QR, and put it where visitors can see it.

### Replace a map visitors already have

1. Review and approve the new package.
2. Publish it to Production. The previous live map for that property is archived.
3. On Map Downloads, choose **Force sync** for devices still on the old map.
4. On Map Versions, confirm the property has one Live version.

### Give someone access to Keiros ERP

1. Confirm the organization is Active.
2. Confirm the role allows the work they should do.
3. Invite them with that role and organization, status Active.
4. They sign in with their email and password.

### Stop a code that leaked

1. On Property Codes, select the code and choose **Revoke**.
2. On Code Usage, see whether it was used after it leaked.
3. Generate a new code and download a new QR.

An expired code fails in the Tour App the same way a revoked code does. Check the date before you tell the desk the code is good.

### Find out where a visitor went

1. Mobile Sessions shows whether the visit is active, idle, or ended.
2. Journey Tracking shows the path.
3. Dwell-Time shows time in each zone, if the visitor turned timing on. Leave the page open during a live tour.
4. Tour Activity shows the named tour.

### Find a failed connection from another system

1. On API Keys, confirm the key is still active and the client is Active.
2. On API Logs, open the failed call and read the result.
3. On API Usage, compare errors with the previous period.
4. On Settings, check the rate limit if the calls are being refused for volume.
5. On System Health, refresh if many systems fail at the same time.

---

## 13. When something does not work

| What you see | What to do |
| --- | --- |
| **Incorrect credentials. Access was not granted.** | Check the email and password. The password must be at least 8 characters. |
| **Check the highlighted fields and try again.** | Fill the marked field. On a reset, use at least 10 characters and make both password fields match. |
| The map area is blank | Reload the page. If it is still blank, clear the browser cache and open Wayfinding Map again. |
| A role will not delete | Someone is still assigned to it. Move them to another role, then delete it. |
| **Publish** stays unavailable | Select a version and tick **I verified approval and checks.** |
| A visitor’s code is rejected | On Property Codes, confirm the code is Active and not expired. On Settings, check **Allow reuse** and the session timeout. |
| A visitor still has the old map | After you publish, open Map Downloads and choose **Force sync**. |
| Badge events are late | On Access Integration, shorten the sync interval or set the reader to Active, then confirm the reader is online. |
| Calls from another system fail | Open API Logs, then confirm the key and the client are Active. Check the rate limit under Settings. |
| Dwell time does not move during a tour | The visitor has to choose **Enable** on **Track time at each stop?** Confirm the zone is attached to the right place. |
| A critical alert is open | Refresh System Health. Acknowledge the alert when that service looks stable. |
| Settings will not save | Enter a code prefix. Expiry and session timeout must be at least 1. The sender must be an email address. |

If the table does not cover it, open **Help / Support**, search the questions, and submit a ticket with the property name and the message on the screen.
