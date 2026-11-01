# Focus timer Live Activity — feasibility and delivery plan

Feasible as a future native iOS companion, with a WidgetKit extension and a small shared Swift
package. Scriptable and the existing authenticated PNG API remain supported. This document is a
plan; this change does not introduce a native app, JSON endpoint, entitlements or APNs sender.

## 1. Scope and prerequisites

Build a `FocusTimerActivity` for an actual **running** focus block, on iOS 16.2+ using
`ActivityContent`. A scheduled block must not start a timer. Ship an iOS app target and WidgetKit
extension; a Swift package alone cannot register or display a Live Activity. Development needs
macOS, Xcode, an Apple signing team and a supported iPhone for device validation.
[Apple's ActivityKit overview](https://developer.apple.com/documentation/activitykit).

## 2. Data flow and endpoint contract

Prefer a new lightweight, read-only `/api/widget/focus` JSON route, keeping `/api/widget/image`
strictly PNG so existing Scriptable URLs and response types stay intact. Reuse the widget bearer
boundary, private/no-store headers, strict parameter validation and generic errors. Add the route
only with explicit proxy and auth tests. Store the user-provisioned read token in iOS Keychain;
never bundle it in the app, push payload, deep link or URL query.

Return `generatedAt`, timezone and `session: null` when no session is running. Otherwise expose
`sessionId`, task label, actual `startedAt`, planned `endsAt`, `totalDuration`, `elapsed`,
`remainingSeconds`, state and a revision/update timestamp. Derive seconds from server timestamps;
clamp at zero and preserve the distinction between timer expiry and completed work. Confirm the
product rule for sessions that start late or overrun before implementing duration semantics.
Fetch from the host app, since the Live Activity extension cannot access the network.
[Apple's Live Activity lifecycle and constraints](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities).

## 3. Shared Swift package and lifecycle

Share `FocusTimerAttributes: ActivityAttributes` between app and extension: immutable session ID
and initial total duration; `ContentState: Codable, Hashable` holds label, start/end timestamps,
state, elapsed-at-update and revision. Revised end times belong in content state. The app registers
`ActivityConfiguration` in its widget bundle, checks `ActivityAuthorizationInfo().areActivitiesEnabled`,
and calls `Activity.request(attributes:content:pushType:)` while foregrounded. Reconcile existing
activities by session ID after relaunch; never duplicate the same session. Use `ActivityContent`
with a meaningful `staleDate`; end the activity on actual cancellation/completion.

## 4. Native visual design

Use SwiftUI in the widget extension, with near-black surfaces, restrained cyan hairlines, Geist
where legible, tabular numerals and an accessible system-font fallback. Use SwiftUI materials,
gradients and `activityBackgroundTint` for the glass approximation. `UIVisualEffectView` is not
the rendering foundation for a WidgetKit Live Activity. Use a timer-based `ProgressView` (circular
where supported and visually verified) and system-rendered timer text. Let iOS control sizes,
contrast and update cadence; test Always-On and reduced luminance.

## 5. Accurate ticking and remote changes

Render a countdown from dates with `Text(timerInterval: start...end, countsDown: true)` rather
than decrementing a stored counter. Allocate a fixed width and monospaced digits to avoid layout
jumps. This keeps the system countdown independent of a running app process; a foreground `Timer`
is not a reliable background update mechanism.
[SwiftUI timer text](https://developer.apple.com/documentation/swiftui/text/init(timerinterval:pausetime:countsdown:showshours:)).

Use APNs ActivityKit pushes for start/end-time changes, cancellation and completion while the app
is suspended. Minute reconciliation is optional, budgeted and best effort, not needed for every
second of ticking. Register and rotate per-activity push tokens through a separately authenticated
write endpoint; the widget read token must never gain write privileges. Use APNs `liveactivity`
push type, correct topic, timestamp, event and content-state; handle out-of-order revisions,
revoked/expired tokens and delivery delays. Prefer low-priority reconciliation; do not promise
minute delivery. Apple budgets and can throttle updates. Live Activities have a finite lifetime;
handle the eight-hour activity limit. Timer expiry alone must not complete a dashboard task.
[Apple's APNs integration and update budgets](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications).

## 6. Dynamic Island and Lock Screen

Compact leading: focus icon. Compact trailing: remaining time. Minimal: small progress indicator.
Expanded: progress ring, readable task label, time remaining and session range. Lock Screen:
wider task label with explicit stale/ended state. Deep link to the focus screen without credentials.
Use system placeholders and no running activity when the session is absent. Include VoiceOver
labels that convey remaining time and actual state.

## 7. Validation

Simulate start, late start, time extension, cancellation, completion, no session, overdue session,
clock skew, airplane mode, relaunch, token rotation, delayed/out-of-order pushes, disabled Live
Activities and multiple simultaneous activities. Confirm ticking with the app suspended/terminated
and the phone locked; measure battery impact. Test compact, minimal, expanded and Lock Screen
presentations, long titles, accessibility sizes and devices without Dynamic Island. Verify that
expiry never checks off a task and unsupported devices retain the PNG widget fallback.

## 8. Signing, configuration and migration

Set `NSSupportsLiveActivities = YES` in the host app's Info.plist and register the widget extension.
Enable Push Notifications for the APNs version with the provisioned `aps-environment` entitlement,
using development/production APNs environments appropriately. There is no need to invent a custom
ActivityKit entitlement. Add App Groups/Keychain Sharing only if the eventual implementation needs
shared storage; prefer keeping credentials in the host app. `NSSupportsLiveActivitiesFrequentUpdates`
is optional and unnecessary for a date-driven countdown. Keep APNs signing keys server-side.

Delivery stages: (1) native local-session prototype, (2) authenticated JSON snapshot and foreground
reconciliation, (3) separately secured APNs registration and state changes, (4) TestFlight device
checks, (5) optional rollout. Existing users keep their Scriptable widgets; the native app adds an
opt-in focus Live Activity. Document Keychain setup, supported iOS versions, how to enable/disable
Live Activities and how to return to Scriptable. No production credentials or planner semantics
need changing for this widget redesign.

Sources checked against Apple's documentation on 2026-11-01.
