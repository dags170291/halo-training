// HALO — service worker for offline/installable support.
// Bump CACHE_NAME whenever index.html changes so Chrome/Android picks up the new version
// instead of serving a stale cached copy forever. CACHE_NAME now tracks APP_VERSION in index.html
// 1:1 (pre-launch alpha: 0.x.y — MAJOR stays 0 until the real 1.0.0 launch, MINOR bumps for a new
// feature, PATCH bumps for a bug fix). History before this scheme: renamed from block5-v1 to
// halo-v1 when the app moved off file:// onto real hosting and got renamed HALO; new running-track
// icon set + monochrome variant for Android's Themed Icons feature; brand-new devices now go
// through onboarding instead of auto-seeding Dylon's training history; fixed misaligned
// side-by-side form fields when one label wraps to two lines and its neighbor doesn't; added an
// app version number to Settings; prompt to delete a linked race when deleting its plan; added
// reusable competitive-racer race-day gameplan (start-line positioning, warm-up, pacing mental
// cues) to the Race Day Strategy view for any A-race with a real pace target; made "Download Plan"
// work for any block (not just Block 5) by generating Markdown/PDF straight from a block's own
// session data, via jsPDF loaded from CDN; the race-day plan session now shows the exact same full
// breakdown as the race's own Race Day Strategy card, instead of a truncated pacing-only subset;
// Weekly Check-In is now its own real session type (icon, color, label) instead of being tucked
// inside an existing Stretch & Mobility day, so it shows up as its own row in the week list;
// onboarding now offers an optional email/password field to create the cloud sync account in the
// same step as the local profile, instead of a separate trip to Settings > Cloud Sync afterward;
// added a "Delete this session" action to the session detail sheet — permanently removes a single
// workout from its plan (distinct from Missed/Skip, which just record how it went); swapped the
// Weekly Check-In icon for the real Material check_circle glyph; race days in the calendar (day
// strip, pull-down month calendar, desktop week rail) now show the same flag icon as a race session
// instead of a star; fixed the race-card carousel being unscrollable while the pull-down calendar
// is expanded (the calendar's full-viewport scrim was swallowing every touch on it); switched the
// app's root height to 100dvh (with a 100% fallback) so the fixed bottom nav stays flush with the
// true bottom of the screen on iOS Safari instead of floating above a gap while not installed as a
// home-screen app; fixed two real iOS safe-area bugs seen on an iPhone 14: the topbar (avatar/
// title/icons) had no top safe-area padding so it overlapped the status bar/notch, and #app's
// bottom padding didn't account for the bottom nav's own safe-area padding, so the last card on
// Today ran in behind the nav bar instead of clearing it; found the actual root cause of that
// second one — border-box sizing meant the nav's fixed height already had the safe-area padding
// eating into it rather than growing the bar, squeezing icon+label into too little room. Nav height
// now explicitly adds the inset instead of just padding for it. Adding or switching plans no longer
// automatically marks the previously-active plan complete — a block now only becomes complete when
// you mark it yourself, or once a majority of its sessions are logged done and its linked race (if
// any) is also done. The app now always opens to Today instead of remembering whichever tab was
// open last. The docked session-detail pane on wide desktop windows now collapses to 0 width
// whenever nothing is selected instead of sitting there as a permanent empty box, and only claims
// its ~400px back once you actually open a session. Progress tab reordered and reworked: the streak
// card now fills the stat grid's empty 6th slot instead of a separate row; Activity Trends moved up
// to sit right under Block Progress; added a new Run Progression card (Long Run / Speed Work /
// Mileage tabs) showing the plan's own week-by-week prescribed workout next to Strength Progression,
// with the existing Mileage-by-Week bars now living inside it as a tab; Recent Logs renamed History.
// The calendar rail and docked session-detail pane now only show on Today/Schedule — every other
// tab (Progress, Recovery, Profile) was permanently squeezed by two panes it never actually used.
// On Today/Schedule at very wide windows, main is now capped to a sensible reading width instead of
// stretching edge-to-edge, and the detail pane grows to fill the leftover space instead of staying
// pinned to 400px. The permanent-dock breakpoint is also raised (was 1150px, now 1360px) so a
// browser window in that in-between range falls back to the slide-over popover instead of cramming
// sidebar+rail+main+pane into too little width. Fixed a dead gap of bare background at the
// browser's right edge on Today/Schedule at very wide windows when no session was open — main's
// container was capped to leave room for the pane regardless of whether the pane was actually
// showing, so with it collapsed nothing filled that leftover space. It now only gives up that room
// while a session is genuinely open, and fills the width itself otherwise. Fixed a font-distortion
// bug affecting the Shoe Rotation bar chart, the Activity Trends week labels, and the Block
// Comparison chart — all three drew their text inside an SVG with a fixed narrow viewBox stretched
// non-uniformly to the card's full width, which warped the lettering into wide, distorted glyphs
// once the card got wider than the viewBox assumed. The Shoe Rotation chart is now plain HTML/CSS
// bars; the other two keep their SVG line/area graphics but their text labels now render as real
// HTML positioned by percentage, so they stay crisp at any width. Fixed the race countdown
// carousel looking cut off on desktop — the 82% "peek the next card" sizing is a deliberate mobile
// swipe cue, but with no swipe gesture on desktop it just looked like a card was broken/chopped in
// half. Two or fewer upcoming races now split evenly to fill the row completely. Replaced the
// original fade-edge idea for 3+ races with rounded prev/next buttons instead — cards are a fixed,
// fully-visible width (scroll-snap-align:start) that always comes to rest whole, never mid-card,
// and the buttons page through exactly one card at a time, hiding themselves once there's nowhere
// further to go. Fixed the carousel opening scrolled past the first (soonest) race card with 3+
// races — the browser's default scroll-anchoring was likely compensating for the layout shift
// between the even-split and fixed-width modes and landing scroll position on the 2nd/3rd card
// instead of the 1st. The carousel now forces itself back to the start on every render and has
// scroll-anchoring disabled outright, so it always opens showing the next race first.
// Found the actual remaining cause of the carousel cut-off complaint — scroll-snap only controls
// where the carousel rests after scrolling (the leftmost visible card flush with the edge), it does
// nothing about the card at the trailing edge, which showed as a visible partial slice any time the
// carousel's own rendered width wasn't an exact multiple of (card width + gap). Clamping the
// carousel's own width to the nearest whole-card multiple fixed the slicing but traded it for a new
// problem — real dead space between the clamped carousel and the actual available width, with the
// nav button left floating out in that gap. The carousel now instead stretches the cards themselves
// to fill the full available width exactly (however many whole cards comfortably fit, capped at
// however many races actually exist), so there's never a fractional card AND never leftover blank
// space — re-measured on every render and on window resize.
// Nav buttons now stay invisible until you hover the carousel row (or reach it via keyboard focus)
// instead of sitting there permanently — sitting flush against the cards means they could otherwise
// block card content whenever they weren't actually needed. Fixed that reveal feeling inconsistent —
// the "nothing left to scroll to" hide was an untransitioned style.visibility flip fighting against
// the smooth hover-opacity fade. Both now go through the same opacity transition (lengthened to
// 280ms, eased out) so every appear/disappear animates the same smooth way.
// New: Generate a Plan — a rule-based (no external AI) periodized training-plan builder, right in
// the Plans sheet next to Upload Plan. Answer a short form (race distance, experience level,
// training period, training days, long run day, optional strength days and goal time) and a
// deterministic base -> build -> peak -> taper algorithm lays out the whole block — long runs,
// tempo/interval days, easy runs, rest, and an optional strength circuit — then feeds it straight
// into the exact same Add & Activate / Just Add import flow a manually-uploaded plan uses. Modeled
// after yearroundrunning.com's plan generator, which is itself upfront that it's an algorithm, not
// an AI model.
// Generate a Plan is now a Runna-style one-question-per-screen wizard (its own overlay, opened from
// a single button below Upload Plan) instead of a scrolling form living in its own tab — and it asks
// a lot more: a separate difficulty dial on top of experience level, optional weekly-volume and
// long-run caps for people who can't fit long sessions into their week, opt-in mobility days and a
// weekly check-in day, and — for strength training — a choice of available equipment, difficulty,
// and session duration, which now builds a real circuit from a small tagged exercise pool instead of
// a single fixed template. You can also choose whether the whole plan is guided by distance ("run
// 5 km, e.g. 1×400m repeats") or by duration ("run 30 min, e.g. 1×2min repeats") — the periodization
// math still runs in km internally either way, only the displayed prescription changes. Settings has
// a new Distance Units toggle (kilometers/miles) that now applies app-wide: Shoe Rotation, Progress
// stats and charts, Race Calendar/plan week totals, session logging (Quick Add and the session log
// sheet), and the plan generator's own distance entries all read and write through it, while every
// value is still stored internally in km so nothing about the existing math or historical data changes.
// Fixed a real bug in the wizard rewrite above: the period/goal-time/race-name/starting-volume
// fields were read straight from the DOM at generate-time, but each step wholesale-replaces the
// wizard body when you move on, so those elements no longer existed by the time you reached Review
// — answers you'd already given got silently dropped and the generator failed validation on
// questions you were never shown again. Those fields now sync into real state on every change, same
// as every other wizard answer already did, so nothing is lost between steps. Sessions can also stack
// now — strength, mobility, and the weekly check-in can share a day with a run (or with each other)
// instead of only being placeable on an otherwise-free rest day; the plan schema's day-uniqueness
// rule now only rejects a true duplicate (same day AND same session type), and the calendar rail/day
// dots show every stacked session on a date instead of silently hiding all but the first.
// Generate a Plan's wizard got a full UX rewrite. The custom-distance field is now a continuous
// slider matching the RPE widget's look, minus its discrete stop markers. The progress indicator is
// a row of segments — one per page — and every segment you've already visited is clickable, so you
// can jump straight back to any earlier page instead of stepping back one at a time. The ~20 separate
// one-question screens are now consolidated into 11-12 grouped pages (race, style, times, naming,
// days, speed, volume, mobility, checkin, strength, [strengthdetails], review) with a hard cap of 3
// questions per page; a conditional follow-up like "which days" now lives on the SAME page as its
// yes/no toggle (mobility, check-in, and strength all work this way) instead of its own separate
// screen. Strength equipment gained a pull-up bar and a bench, each with their own exercises, and a
// strength day's description now names every piece of equipment you picked instead of just one.
// Successfully uploading OR generating a plan now closes the Plans sheet and drops you on Today,
// instead of leaving you looking at Season Blocks. You can now name the plan itself before
// generating, separately from the race name. The old automatic "how many quality days" assignment is
// gone — you now pick the number of speed/quality workouts per week and which of your non-long
// training days they land on. Generated run distances round to clean whole numbers or tight ranges
// (e.g. "7-8 km", "10 km") instead of odd decimals like "7.4 km". And there's a new current-time
// question (a recent race or time trial) alongside goal time — it's the stronger fitness signal, so
// it drives pacing calculations first, with goal time as a fallback and an implied near-term goal
// pace derived automatically when only a current time is given.
// Progress tab's desktop two-column layout (see .progress-split) sizes each side to its own content
// height rather than stretching to match, so the left (stats) column used to end noticeably shorter
// than the right (charts/progression) side, leaving a big empty gap below it — especially early in a
// fresh block, before Week Recap has anything to show. It now also carries a compact "Current Block"
// glance card (name, dates, completion/km/streak — same stats the Profile tab's own block card shows)
// and a "Latest PB" badge when one exists, filling that column out with real, useful status instead
// of blank space.
// Fixed two real bugs on the desktop Race Calendar (list + detail split pane), both caught on video:
// clicking through races changed the edit form/Race Day Strategy on the right, but nothing in the
// list on the left ever showed which race that was — Season Blocks' own list already rings its
// currently-open card, race cards just never got the same treatment. And every click (or any other
// action) that re-rendered the Plans sheet replaced the whole scrollable list element from scratch,
// silently snapping its scroll position back to the top — jarring if you'd scrolled partway down a
// long list before clicking anything. Both now fixed: race cards ring the currently-open race the
// same way block cards do, and picking a different item (race or block), editing, saving, or
// deleting preserves wherever you'd scrolled to instead of resetting it — genuinely new lists
// (switching tabs, changing a filter) still reset to the top, since that's actually new content.
// Added a "How Your Plan Is Built" training-methodology guide — a new sheet reachable from Settings >
// About and from the wizard's Review step, explaining periodization (base/build/peak/taper), peak
// weekly volume by distance and experience, long-run sizing, speed/quality day defaults, the
// current-time/goal-time pace-priority model, and the clean-number rounding rule — all pulled live
// from the actual generator constants/functions so it can't drift out of sync with what Generate Plan
// really does. Leads with a clear "this is a calculator, not a coach" disclaimer and a nudge to stop
// and consult a professional for pain, illness, or injury rather than pushing through a prescribed number.
// Added mid-block plan adjustment — an "Adjust Plan" action on the active Season Block (Plans sheet
// and its desktop detail pane) for handling missed time (injury, illness, travel) without deleting and
// restarting the whole block. Two composable actions: Shift Remaining Schedule moves every not-yet-done
// session (and a linked race day) later or earlier by the same number of days, pure date arithmetic with
// zero content changes; Add Recovery/Maintenance Weeks inserts brand-new, honestly-labeled easier weeks
// (same day-of-week pattern as the last full week, at a chosen intensity %) right before the next
// upcoming week, then pushes that week and everything after — including race day — back by the same
// number of weeks. Both only ever touch sessions dated today or later; anything already logged is
// completely untouched.
// Added calendar (.ics) export — the existing Download Plan popup (PDF/Markdown) now offers a third
// "Add to Calendar (.ics)" option that turns a block's sessions, plus any linked race not already
// covered by a race-day session, into a standard RFC5545 calendar file importable straight into
// Google Calendar, Apple Calendar, Outlook, etc. Each session becomes an all-day event on its
// scheduled date with the session title/distance as the summary and its detail text (properly escaped
// per spec) as the description. Works for any block, including Block 5.
// Added session reminders — a new Settings > Session Reminders toggle using the browser's local
// Notification API to nudge you about today's not-yet-logged session at a chosen time, while HALO is
// open in a tab. No backend/push infra, so this is deliberately scoped to "while the tab is open" —
// a once-a-minute check compares the current time against your chosen reminder time and fires at most
// once per day (tracked per-device, not synced). Skips rest days and anything already logged done;
// includes a Send Test Reminder button to verify it's working without waiting for the actual time.
// Made the new-in-alpha training-methodology guide easier to actually find: replaced the sidebar's
// Shortcuts button with a Help button (opens the same guide) and moved Keyboard Shortcuts into
// Settings > About instead; added a matching help icon to the Your Plans sheet header; the Generate
// Plan wizard's very first page now leads with a short "rule-based algorithm, not AI, not a coach"
// briefing card linking into the full guide, instead of only surfacing it at the Review step; and the
// Upload/Generate header now also tells people who already have a plan from elsewhere that they can
// paste it alongside the same AI prompt and ask AI to convert it into HALO's format, rather than only
// covering "generate a brand-new plan from scratch."
// Fixed a real bug: clicking "See exactly how it works" on the wizard's first page opened the Plan
// Guide sheet, but it rendered completely hidden behind the wizard itself — #genplan-overlay has an
// elevated z-index (225) that the guide's default overlay z-index (200) couldn't beat, so nothing
// visibly happened. Plan Guide now gets an explicit z-index (230) above the wizard. Also redesigned:
// the wizard's briefing and the guide's own top disclaimer are now real alert banners (same visual
// family as the install/reminder nudges — icon, title, message, action button — just colored red
// instead of blue, to read as a warning rather than a routine tip) instead of a plain card with a bare
// text link; the guide's body now uses colored icon-badged sections (periodization, peak volume, long
// runs/speed, pacing, clean numbers, difficulty) instead of plain identical text blocks; and the help
// icon used in the sidebar, Your Plans header, and the guide's own header is now one consistent
// user-supplied glyph everywhere. Also shrank the race carousel's per-card baseline width (340px ->
// 300px) so 2 cards comfortably fit within 2/3 of a 14" MacBook Pro's display instead of needing
// slightly more than that.
// Fixed the "Need a plan? / Already have a plan?" tip text under Upload Plan/Generate a Plan reading
// like a floating, disconnected caption — it's now wrapped in a proper bordered box (matching the
// app's other info-card styling), left-aligned instead of centered, split into two separate readable
// lines instead of one run-on paragraph, with a small icon for visual weight.
// Fixed the Race Calendar's "Next Race" card border reading as if it were actively selected — it used
// the exact same full-saturated var(--accent) border the real desktop selection ring uses, so the
// next-up race always looked "clicked" even when nothing was actually open in the detail pane. Muted
// it to var(--accent2), the same softer tier the PB (gold2) and Complete (gr2) borders already use —
// genuinely selecting a race still shows the real, now-distinguishable accent ring via the existing
// !important .selected rule.
// Moved the sidebar Help button down so it sits directly above the divider line that precedes
// Profile/Settings, instead of leaving a large empty gap between Help and the bottom of the sidebar.
// The flex auto-margin that used to live on .sidebar-bottom-group (pushing that whole group to the
// bottom) moved onto the Help button itself (.sidebar-help-btn{margin-top:auto}), so all the free
// space now collects above Help and it sits flush against the line, with Profile/Settings unchanged.
// Added PWA home-screen shortcuts: manifest.webmanifest now has a "shortcuts" array (Log a Run,
// Race Calendar, Recovery), each pointing at index.html?action=<key> so long-pressing the app icon
// on Android jumps straight into that action instead of opening to Today and navigating manually.
// A new handleShortcutAction() reads that query param once on boot, fires the matching in-app
// action (openQuickAdd('run','easy') / openPlans('races') / switchView('recovery')), then strips
// the query string via replaceState so a later refresh doesn't keep re-triggering it.
// Added shoe replacement/mileage alerts: shoeAlertThreshold(key) returns an explicit per-shoe
// alertKm override if set, otherwise a name/note keyword heuristic (walk->900km, race->350km, else
// 550km default) so every existing shoe gets a sensible default with zero setup. Active shoes past
// that threshold now show a "Replace soon" pill in both the Shoes sheet and the Profile tab's Shoe
// Rotation card; each row also gets an "alert at Xkm" link (promptShoeAlertKm) that opens a small
// confirm-overlay form to override the threshold per shoe.
// Added a general race time predictor. The existing estimateRaceTime() only ever projected a 5K,
// assuming recent quality-session pace holds perfectly flat at any distance (badly overstates a
// half/marathon, understates a 1K). New riegelPredictSec()/knownPerformances()/
// predictedRaceTimeSec()/predictedFinishForRace() scale every known logged best effort (plus the
// existing quality-pace estimate as a synthetic ~5K candidate) to any target race distance using
// Riegel's formula (T2 = T1*(D2/D1)^1.06), averaging across all known candidates. Shows as a
// "Projected Finish" card in the Race Day Strategy view for any upcoming race with a parseable
// distance, comparing against the race's own target time when one is set ("inside" / "slower than"
// your target). Hidden for races that are already done or have nothing logged to project from yet.
// estimateRaceTime() itself and the Plan Overview "Estimated 5K Time" card are untouched.
// Added a training load / injury-risk flag using the Acute:Chronic Workload Ratio — a well-
// established sports-science signal for sudden mileage spikes. loggedRunKmInRange() sums logged
// running km over any rolling calendar window (every block's done sessions + Quick Add extra logs),
// independent of block week boundaries. acuteChronicWorkload() compares the trailing 7-day total
// against the trailing 28-day weekly average and buckets the ratio into low/sweet/moderate/high
// bands (Gabbett-style cutoffs: <0.8, 0.8-1.3, 1.3-1.5, >1.5). A new "Training Load" card
// (trainingLoadCardHTML) sits at the top of the Recovery tab's Durability sub-tab, with a link into
// the Injury log when the band is High. Returns/renders nothing until there's enough logged history
// to make the ratio meaningful.
// Surfaced the race time predictor much more prominently: it previously only showed up inside a
// specific race's own Race Day Strategy view, which turned out to not be discoverable at all. New
// racePredictionsCardHTML() shows a Strava/Runna-style "Race Predictions" card with all 4 standard
// distances (5K/10K/Half/Marathon) at once, reusing predictedRaceTimeSec() unchanged — placed near
// the top of the Progress tab's left column (right after the Personal Bests glance card), visible
// immediately without needing an upcoming race to exist at all.
// Redesigned the Add/Edit Shoe form to match Runna's own shoe-add flow: a Brand dropdown
// (POPULAR_SHOE_BRANDS, with an "Other" free-text fallback for anything not listed) instead of one
// bare free-text Name field, plus Model/Color/optional Nickname fields, and the replacement-mileage
// threshold is now a continuous Distance Goal slider (the same rpe-widget component the plan
// generator's custom-distance slider uses) set right at creation time, with advisory copy about
// typical shoe lifespan. The composite display name (nickname, else "brand model", else whatever was
// typed) is still stored as shoe.name, so every existing place that already reads shoe.name keeps
// working unchanged. Every shoe — including the ones seeded in before this feature existed — is now
// genuinely editable via a real Edit button (startEditShoe/saveShoeEdit), not just Retire-only; the
// previous one-off "alert at Xkm" quick-link/dialog (promptShoeAlertKm as a UI entry point) was
// folded into this same form instead of staying a separate control.
// Redesigned the Training Load card from a plain text-only block into something with real visual
// weight: a colored icon-badge header (the same 36px/var(--r10) convention planGuideSectionHTML's
// icon-badge sections use), a segmented low/sweet/moderate/high gauge bar with a marker dot at the
// current acute:chronic ratio, and two mini stat boxes for the raw Last-7-days/4-week-avg km instead
// of one dense text line. Also added trainingLoadStatChipHTML() — a compact chip reusing the exact
// .stat-card cell the Progress tab's main stat-grid already uses, showing up as a 7th grid cell
// there (band label + ratio, tap to jump into the Recovery tab for the full gauge/detail) instead of
// training load only ever being visible after navigating into Recovery > Durability.
// Fixed a real reported bug in the race time predictor: a runner with a locked 27:34 5K PB was
// seeing a ~50:48 5K projection. Root cause — knownPerformances() never looked at RACES_LIST at
// all, so real chip-timed race results were completely invisible to the predictor; it only ever
// inferred a race pace from training data, a much less reliable signal. Now RACES_LIST entries
// (status 'done' + a parseable actualTime/distance) are gathered as source:'race' candidates, and
// predictedRaceTimeSec() uses ONLY real race results when any exist instead of diluting them by
// averaging against cruder training-pace inference. Training-derived data remains the fallback when
// there's no real race result on file yet.
// Redesigned the Progress tab's Race Predictions card to match Strava's own "Performance
// Predictions" badge-tile layout: each of 5K/10K/Half Marathon/Marathon gets a circular badge
// (plain "5K"/"10K" text, or the numeric distance + KM/MI for Half/Marathon, unit-aware), a big
// central projected time, its per-km/mi pace, and a small delta chip comparing today's projection
// against the closest snapshot from ~30 days ago (green down-arrow if faster, neutral up-arrow if
// slower, hidden entirely for changes under 3 seconds). A lightweight daily snapshot history
// (RACE_PRED_HISTORY, capped at 400 entries, one entry per day) now persists in localStorage
// purely to power that trend comparison.
// Shoe manager overhaul (Task #128/#129): the Add/Edit Shoe form is now hidden behind a "+ Add
// Shoe" button (mobile) / list-header button (desktop split view) instead of sitting front-and-
// center above the list at all times — opening it (Add or Edit) is the only thing that reveals the
// form, and Cancel/Add/Save all collapse it straight back. Each shoe can now also have a photo:
// reuses the exact same pan/zoom crop-overlay the profile avatar has always used (generalized via
// a new CROP_TARGET so the same cropper can save into either PROFILE.avatarImage or a shoe's
// pending photo), shown as a small thumbnail in the form and in each shoe's list row once set. Like
// every other field in the form, a picked photo isn't written onto the shoe record until Add
// shoe/Save Changes is actually clicked, and can be cleared via a Remove Photo control.
// Filled the last blank cell in the Progress tab's stat-grid with three new chips (Task #130),
// making it a clean 10-cell, 5-row grid: Fitness Trend (% change in EF between the block's first
// and most recent week with a real EF reading — tap jumps into the Pace vs HR trend), Consistency
// Score (% of fully-elapsed weeks that hit at least 85% of that week's planned mileage — a week
// still in progress never counts against it), and Days to Next Race (a countdown to whichever real,
// dated, not-yet-done race is soonest across every block, tapping jumps to the Races tab).
// Redesigned Race Predictions to match Runna's own "Estimated Race Times" screenshot instead of the
// earlier Strava-style badge grid: a hexagonal distance badge per distance (5K blue/10K gold/Half
// green/Marathon red), a big hero range for the primary distance, and a Current vs "In N weeks"
// table — the forward column extrapolates the Fitness Trend chip's EF-%-change-per-week rate across
// the weeks remaining in the active block (clamped so a short/noisy trend can't blow up into an
// absurd projection), falling back to Current-only when there's no real trend yet.
// Moved the Profile tab's full Personal Bests section (hero PB card + full per-distance grid) into
// the Progress tab, replacing the smaller "Latest PB" glance card that used to live there — Profile
// no longer shows Personal Bests at all, so it's not duplicated in two places.
// The Progress-grid Training Load chip now spans the full grid width (was one of the small 2-up
// cells) and reuses the same icon-badge + gauge + band-pill layout the Recovery tab's fuller card
// uses, just at a smaller/minimized scale (thinner gauge bar, smaller marker, no zone-boundary
// labels, no mini stat boxes or note text) — tapping it still jumps into Recovery for the full card.
// Recovery tab overhaul (it was "underdeveloped and bare bones"): a new Recovery Overview card sits
// above all 4 sub-tabs, combining Training Load band, active injury count, this-week Prehab
// Consistency, and this-week Wellness average in one glance (with a cross-reference warning when
// load is high AND an injury is active) — each cell taps into its own sub-tab. Injury reports now
// have a real lifecycle (Active/Recovering/Resolved status + an optional expected return date,
// Active/Recovering sorting ahead of Resolved regardless of date). Prehab Consistency mirrors the
// Progress tab's mileage Consistency Score, tracking what % of fully-elapsed weeks hit that week's
// planned mobility/yoga count. A brand-new Wellness sub-tab adds a lightweight energy/sleep/soreness
// check-in log (intended weekly, nothing stops logging more often) with a rolling this-week average.
// Follow-up round of feedback on the above: Race Predictions dropped the hexagon distance badges
// entirely in favor of plain text labels ("forget the shapes and use just text") — the Current vs
// "In N weeks" forward-projection logic is unchanged. The Progress-grid Fitness Trend and
// Consistency Score chips now always render a visible "not enough data yet" state instead of
// silently disappearing when there isn't enough history yet, and both now appear BEFORE the
// full-width Training Load row instead of after it; the Days to Next Race chip (and its
// nextUpcomingRace() helper) is removed entirely now that Training Load covers that concern.
// Durability's rule list now renders each rule as an icon-badged row (green check for a standing
// routine, amber eye for a normal-but-worth-watching signal, red warning triangle for a hard
// stop-and-report signal) instead of plain numbered text. Prehab log entries (both self-logged
// Yoga/Mobility and plan-sourced Mobility days) now lead with the same icon-badge system already
// used for session types elsewhere in the app, instead of a plain text pill tag. The plan's Weekly
// Check-In sessions (freeform reflection Q&A) now merge into the Wellness sub-tab alongside the
// numeric energy/sleep/soreness log, in one combined chronological list.
// Race Predictions, round 3: distance labels now match the Personal Bests card's own naming exactly
// ("Half"/"Marathon", not "21.1"/"42.2" — Dylon pointed out the two cards disagreed on what to call
// the same distance). Every time now shows its pace alongside it, in the hero and in both the
// Current and "In N weeks" columns of each row. The card also got some color back: each row carries
// a colored left accent bar and the hero is now a colored gradient card (same 5K blue/10K gold/Half
// green/Marathon red coding the old hexagon badges used), addressing "give the predictor some more
// style and colour... it's a bit boring" without reintroducing any badge/shape.
// 15K is now a real distance, alongside the existing 5K/10K/Half/Marathon set, in both the Personal
// Bests card and the Race Predictions card (its own distinct purple accent color). Strides logged in
// the Strides table now count toward Progress totals as a fallback when the session's own Distance/
// Duration fields were left blank, instead of silently counting as zero — a real Distance/Duration
// value still wins outright with no double-counting, since that field is normally the whole
// continuous GPS activity and already covers every stride. The manual Walk quick-add now has a Shoe
// worn field, same as Run, and a walk's km now count toward that shoe's tracked mileage. Race
// Predictions, round 4: the colored left-border-bar per row is gone, replaced by a soft background
// gradient tint per row in the distance's own color; the hero card's rounded corners actually work
// now (it referenced an undefined CSS variable before); pace sits inline right next to its time
// instead of stacked underneath; and with no forward "In N weeks" column yet, the lone Current
// time+pace is right-aligned to the row's far end (with the now-redundant "Current" header hidden)
// instead of leaving a stretch of dead space trailing after it.
// Race Predictions, round 5: the free-text disclaimer paragraph under the table is gone entirely (no
// explanatory prose anywhere in the app, just the numbers); each row's per-distance "rainbow" tint
// is replaced by two tones alternating by row position, and the hero card always uses one consistent
// color regardless of which distance is the hero; a real gap now separates the hero card from the
// first row/table header below it (the old CSS rule was silently overridden by an inline style and
// did nothing). The "This is a calculator, not a coach" banner (Generate Plan wizard + Plan Guide)
// is now a softer amber caution style instead of the harsh red warning style. The training
// methodology/knowledge section (Plan Guide) now explains how Training Load works — the acute vs
// chronic mileage windows, the acute:chronic ratio, and what each of the four Easing Back/Balanced/
// Elevated/High bands means. Onboarding sign-in is now two separate steps instead of one combined
// page: step 1 is profile basics (name/DOB/location) plus an optional profile photo upload, with a
// Continue button; step 2 is the optional cloud-sync signup, with a Skip button that moves straight
// to the next step without creating an account and tells you sync can always be set up later in
// Settings. Fixed the shoe-photo crop overlay rendering behind the Shoes edit card when opened from
// within it — it now has an explicit z-index above every other overlay in the app. Every shoe in the
// Shoes list now shows a left-side avatar — its real uploaded photo if it has one, otherwise a
// colored initials monogram — instead of only shoes with a photo getting any visual element at all.
// Correction pass on the round-5 Race Predictions changes: the disclaimer caption Dylon actually
// wanted restyled (not deleted outright) is back under the card, as a small muted centered line
// instead of the plain paragraph it used to be; each row is now a fully solid fill in its
// alternating tint instead of a gradient fading to the card background; the hero's label/time
// sizing now matches the Personal Bests card's own "Latest PB" hero exactly (centered, same font
// treatment); and the Personal Bests distance list picks up that same alternating solid-color row
// treatment instead of a plain divider-line list.
// Fixed a real bug reported by a new user (Dylon's sister) on a brand-new device: SHOES was the one
// piece of app state that fell back to a hardcoded copy of Dylon's own real shoes instead of an empty
// list whenever nothing had been saved locally yet — every other data type already defaulted to
// empty. Same bug existed in Settings' "Reset all progress." Also fixed the cloud-sync signup flow
// (both onboarding and Settings > Cloud Sync): creating an account when email confirmation is
// required — the normal case for a real Supabase project — used to just show a toast that vanished
// in a few seconds and move on as if nothing notable had happened, giving no persistent indication
// that the account still needed email confirmation before signing in would work. Both places now
// show a persistent "check your email, then come back and Sign In" screen instead.
// New feature: Pace Calculator, a standalone tool combining a yearroundrunning-style Race Splits
// calculator (pick a distance, a goal time, and a pacing strategy — even, negative-split, or
// aggressive negative-split — to get a full km-by-km pacing plan) with a Strava-style Pace <-> Time
// calculator (enter a pace, see finish times across common race distances). Desktop: a dedicated
// sidebar button. Mobile: no room on the 4-slot bottom nav, so it lives behind a new "Tools" icon in
// the topbar (a small menu built to hold more tools later, even though Pace Calculator is the only
// entry today). Paces are always shown per km, matching the convention already used everywhere else
// in the app, regardless of the km/mi display-unit setting.
// Fixed the Pace Calculator's Km-by-Km Splits and Finish Times tables looking like bare text
// floating in the sheet with nothing framing them — both now sit inside a proper section-label +
// card, with bordered rows matching the Block Comparison card's table treatment elsewhere in the app.
// Pace Calculator's Pace <-> Time tab gained an optional custom distance field (the Race Splits tab
// already had one) — enter any distance and it's inserted into the Finish Times table in sorted
// order alongside the fixed 1 Mile/5K/10K/15K/Half/Marathon set, instead of only comparing against
// those fixed distances.
// New: Heart Rate Zone Calculator, a standalone tool (same entry-point pattern as Pace Calculator —
// dedicated sidebar button, a row in the mobile Tools sheet) modeled on yearroundrunning's Heart Rate
// Zone Calculator. Three methods — Karvonen/Heart Rate Reserve (recommended), %Max HR, and Zoladz —
// with Max HR estimated from age (Tanaka/Fox/Gulati formulas) and Resting HR estimated from a
// self-reported activity level when either isn't directly known. Shows the standard 5-zone breakdown
// (Recovery/Aerobic/Tempo/Threshold/Maximum) for the selected method plus a side-by-side comparison
// across all three.
// New: Guide Hub, a standalone library of 8 short, original explainers on run types and supporting
// training (Recovery/Easy/Long/Tempo Run, Interval Training, Other Forms of Cardio, Strength
// Training, Stretching & Mobility) — separate from the existing "How Your Plan Is Built" guide, which
// is specifically about how HALO's own plan generator works. Reachable from a dedicated desktop
// sidebar button ("Guides") and from Settings > About on mobile, right alongside "How your plan is
// built."
// Icon/layout polish pass on the three additions above: Pace Calculator, Heart Rate Zones, and
// Guides now sit together in their own visually separated sidebar section (a divider line), distinct
// from Plans/Races/Shoes above them. Heart Rate Zones (sidebar, its own sheet header, and its row in
// the mobile Tools sheet) now uses a dedicated ECG-heart glyph instead of a plain filled heart.
// Guides (sidebar button and the Guide Hub sheet's own header) now uses a dedicated
// book/guide glyph instead of a reused running-figure icon. In the Guide Hub itself: "Other Forms of
// Cardio" renamed to "Cross Training" with a new dedicated pool icon (was reusing the walk icon);
// Strength Training now uses a dedicated exercise icon (was reusing the app's session-logging
// strength icon) so Guide Hub's iconography no longer borrows session-type glyphs it doesn't need to.
// The mobile Tools topbar icon is now a dedicated "workspaces" glyph instead of reusing Pace
// Calculator's own icon (the two had been visually identical, which read as a mistake rather than a
// deliberate choice). Pace Calculator itself now uses a dedicated average-pace glyph (sidebar,
// its own sheet header, and its row in the Tools sheet), replacing the calculator/grid icon.
// Guide Hub moved into the mobile Tools sheet as a third row alongside Pace Calculator and Heart Rate
// Zones, and its separate Settings > About ghost button was removed — every secondary/tool-like
// feature now lives behind the one Tools entry point on mobile instead of being split across two
// places (Tools sheet vs. Settings). Desktop is unchanged: Guides keeps its own sidebar button,
// still grouped with Pace Calculator/Heart Rate Zones in their own separated sidebar section.
// New: Plan Generator (the existing Generate-a-Plan wizard) added as a fourth entry in the mobile
// Tools sheet, alongside Pace Calculator, Heart Rate Zones, and Guide Hub — tapping it closes Tools
// and opens the wizard directly, same as any other Tools row. "Guides" renamed to "Guide Hub"
// everywhere (sidebar button, Tools sheet row) for a clearer, more complete name now that it covers
// more than just guides. Guide Hub itself is now a single sheet with two tabs: "Training Guides" (the
// original 8 run-type/training explainers) and "How Your Plan Is Built" (the existing Plan Guide
// content, reused as-is — not duplicated). Plan Guide's other entry points (sidebar Help button,
// Settings > About, the wizard's own briefing card) are unchanged and still open that content
// directly; the new Guide Hub tab is an additional way in, not a replacement.
// Plan Generator's Tools-sheet row now uses a dedicated assignment/clipboard icon instead of a
// reused Plan Guide glyph. Guide Hub's two-tab layout replaced with a selectable list: opening Guide
// Hub now lands on a 2-row menu ("Training Guides" / "How Your Plan Is Built") instead of showing
// tabs — picking a row navigates into that content, and a back arrow in the sheet header returns to
// the list. Same two destinations and content as before, just reached as a drill-down menu instead
// of a tab switcher.
// Fixed a real layout bug in that back arrow: it was hidden via CSS visibility:hidden, which still
// reserves the button's space in the header's flex row, leaving a visible blank gap in front of the
// Guide Hub icon while on the landing list. Switched to display:none/flex so the icon sits flush left
// with no reserved space when the button isn't shown.
// New: Shoes added as a fifth entry in the mobile Tools sheet, alongside Pace Calculator, Heart Rate
// Zones, Guide Hub, and Plan Generator — tapping it closes Tools and opens the Shoes sheet directly.
// Shoes previously had no dedicated one-tap mobile entry point (only Settings > General > "Manage
// shoes" or the Progress tab's Shoe Rotation "Manage" link); both of those still work unchanged, this
// is an additional, faster path in. Desktop is unchanged — Shoes keeps its own sidebar button.
// Tools icon replaced (both the mobile topbar button and the Tools sheet's own header icon) with a
// dedicated category/shapes glyph. The old calculator-style icon wasn't showing up visibly for Dylon
// in the Tools sheet header, so rather than debug that specific rendering issue, both spots now use
// this new icon, which resolves it either way and keeps the two in sync as usual.
// New: Package/Bib Pickup for races, modeled on the RBC Race For The Kids confirmation email's own
// pickup section. Each race can now record a pickup date RANGE (start/end), a specific LOCATION
// (often different from the race start line — a running store, an expo hall — with its own Google
// Maps link, kept separate from the race's own location field), and free-text notes (hours, what to
// bring). Surfaced three ways: a Today banner nudge once pickup is within 3 days (or already open),
// the exact same lead time the browser notification below uses; a one-time browser notification (new
// "Race Package Pickup Reminders" toggle in Settings, its own on/off separate from Session Reminders,
// same no-backend Notification-API architecture — but unlike Session Reminders' once-per-DAY check,
// this fires once EVER per race, tracked via the race's own pkgReminderFired flag, reset only if the
// pickup start date is later corrected); and a small info card on the Race Day Strategy view
// alongside location/route link, for whenever you're already looking at that race's own logistics.
// Fixed a real reported bug: race-day plan sessions in Schedule/Today could show completely
// different details than the same race's own card in the Races tab. Root cause — the session's
// Details view (raceStepsFor) only recognized Block 5's two hand-seeded race sessions by hardcoded
// id, and fell back to a bare, disconnected view (just the session's own static text) for every other
// race on every other block, including anything from Generate Plan or an uploaded plan. Now a race-
// day session finds its RACES_LIST record by DATE instead of by id (raceForSession), so editing a
// race's target time, distance, goal, or package pickup info in the Races tab is reflected immediately
// in its own plan session — no more disparity, on any race. Also added a real "Edit Race Details"
// button to any race-day session's detail sheet, opening that race's edit form directly — race details
// are now editable from wherever a race day is actually encountered (Schedule, Today, or the Races
// tab), not only by finding it again in the Races list.
// Removed the "Weight check-in (kg)" field from a run/qual session's own logging form (Run Data
// section) — weight already had its own standalone entry point (Quick Add > Weight), so letting a
// session's log ALSO capture it was a redundant second place for the same number to live. Weight is
// now only ever logged standalone. Historical weight values already recorded this way on old
// sessions are left alone everywhere they're read (Progress weight trend, CSV export, History feed)
// — this only removes the ability to log it here going forward, it doesn't erase past entries.
// New: the first phase of turning HALO into a personal Strava/Google-Health replacement (see
// ANALYTICS_ROADMAP.md) — a new ACTIVITIES entity for raw recorded activities (from a watch file,
// eventually a live sync), independent of any planned session. A planned session can have zero, one,
// or several linked Activities (a warm-up walk, the run itself, a cool-down walk, and post-run yoga
// can all point at the same day), each with its own type and its own `role`: fulfillment (marks the
// session done), accessory (attached for a complete record, not a plan requirement), or unplanned (no
// link at all). Role is for completion-tracking only — every analytics total in later phases must sum
// across all activities regardless of role. This ships the data model and its helper functions only
// (normalizeActivityRecord, addActivity, linkActivityToSession, activitiesForSession,
// unplannedActivities, activitiesInRange) — no UI yet; the file importer and Activity Feed view are
// next (Phase 1).
// New: Phase 1 (first slice) of ANALYTICS_ROADMAP.md — you can now import a real TCX or GPX file
// exported from a watch (Google Health/Fitbit, Garmin, or COROS) via a new "+ Import Activity" button
// in Full History. A shared parser (parseTCXString/parseGPXString) reads GPS position, altitude,
// distance, heart rate, and cadence when present, and derives distance/duration/avg+max HR/elevation
// gain/pace from the raw stream regardless of which format it came from (FIT, Garmin's binary format,
// isn't handled yet — export TCX/GPX instead for now). Imported activities land as `unplanned`
// Activities (Phase 2 adds linking them to a planned session) and now show up right alongside your
// regular logged sessions and quick-adds in Full History — reused as the "every activity, planned or
// not" feed this phase calls for, rather than building a separate view. Charts, personal bests, HR/
// pace zones, and relative-effort scoring are the next slice of Phase 1.
// Fixed: a brand-new account (nothing logged yet) had no way to actually reach the Import Activity
// button — Full History's "View all" link only showed up once something existed to view, so it was
// hidden for exactly the account that would most need to import its first activity. That link is now
// always shown from Progress. Also added a second, independent Import Activity entry point straight
// on the Today tab's "Add Activity" grid, so it's reachable without going through History at all.
// New: a real reported gap — the imported-activity detail popup was just a one-line blurb. It now
// shows every parsed field as its own row (distance, duration, avg/max HR, elevation gain, calories),
// explicitly notes when a file had no GPS or cadence data rather than silently omitting those rows,
// and — the main ask — an imported activity's name is now editable right from that popup
// (activityDisplayName()/saveActivityName()), falling back to its type (Run/Walk/etc.) until you set
// one. Wiring imported activities into the existing weekly totals/trend charts, a dedicated Activity
// Feed view, and moving the manual-add buttons behind a FAB are bigger follow-up items, tracked
// separately rather than folded into this fix.
// Fixed: importing a file used to write it straight to your activity list the instant it parsed, with
// only a toast after the fact telling you what happened — no chance to catch a bad read or set a name
// before it landed. Now a confirmation card shows the same field-by-field breakdown as the detail
// popup (distance, duration, HR, elevation, whether GPS/cadence were present) plus a name field, and
// nothing is actually saved until you tap Import — Cancel discards the parsed file with nothing kept.
// Phase 1b of ANALYTICS_ROADMAP.md: imported/logged Activities now actually feed the existing
// weekly trend chart, Training Load (ACWR), Efficiency Factor trend, and Best Efforts by distance
// — the real gap Dylon reported ("the data dont get added to the current charts and graphs"). Also
// new: a Relative Effort (TRIMP-style) score and an HR zone time-in-zone breakdown per activity
// (both need the HR Zone Calculator to have been used at least once), a pace/HR/elevation chart
// over the activity's own distance, and intra-activity walk-break detection for run-type
// activities — all shown in the activity detail popup.
// Task 48: a dedicated Activity Feed (sidebar button on desktop, Tools sheet row on mobile) shows
// every activity, planned or not, one tap away instead of buried two taps deep inside Progress >
// History. Also: the Run/Walk/Weight/Strength quick-add buttons and Import Activity, which used to
// sit in an inline "Add Activity" grid on Today only, now live behind a single floating Add-Activity
// button shown on both Today and Schedule.
// Fixed: a file with no clear Sport label (blank or generic, e.g. some Google Health exports) used
// to always default to 'run' on import -- silently turning real walks into runs. inferActivityType()
// now falls back to average speed (~6.5 km/h cutoff) only when the sport string itself gives no
// signal at all; an explicit sport keyword still wins outright regardless of pace.
// Chart redesign batch, built from Dylon's own shared reference screenshots of a real running
// watch platform's charts: the TCX/GPX parser now also reads power, vertical oscillation, vertical
// ratio, stride length, and temperature whenever a device actually recorded them (Dylon's own Pixel
// Watch files won't have most of these, but a Garmin export will, and every consumer treats an
// absent field as "not available," never a false zero). The per-activity chart in the detail popup
// is now a filled-area chart with an Average/Best (or Average/Maximum, or Minimum/Maximum)
// stat-header row above it, and gained Cadence/Power/Vertical Oscillation/Vertical Ratio pills
// alongside the existing Pace/HR/Elevation ones -- each pill only appears when that activity
// actually has the data. Added a Run/Walk/Idle timeline chart classifying an entire run's pace into
// three states (idle under ~0.3 m/s, walk under ~2.2 m/s, run above it), distinct from the existing
// "N walk breaks" summary sentence. Relative Effort is now a segmented gauge with an Easy/Moderate/
// Hard/Very Hard band pill, matching the Training Load card's own gauge/pill visual language
// instead of a bare number. Added a best-effort weather/temperature backfill via Open-Meteo's free
// historical weather API for files/devices with no temperature sensor of their own -- runs
// automatically right after import using the activity's own GPS + date, never overwrites a real
// device reading, and shows an explicit "(estimated)" label plus a manual "Add Weather" retry
// button in the detail popup when it didn't have GPS to work with or the lookup failed.
// Fixed three real bugs Dylon reported right after v0.23.0 shipped: the per-activity chart's
// line/fill color was reading --accent from <html>, but --accent is only ever set on <body>
// (custom properties don't propagate upward), so it always silently fell back to a hardcoded blue
// that had nothing to do with the app's actual phase-colored theme -- now reads from document.body.
// The Run/Walk/Idle timeline classified every single stream interval by raw instantaneous speed
// with no smoothing, so real (noisy) GPS data fragmented into a flicker of one- and two-second
// state changes instead of a legible timeline -- segments under 15 seconds now get folded into a
// neighbor first. The per-activity chart gained real y-axis value labels at each gridline and
// x-axis distance labels, instead of only the Average/Maximum-style stat header implying a range.
// Four new Strava-style analytics pieces, all shown in the activity detail popup for a run: Grade
// Adjusted Pace (Minetti et al.'s public energy-cost-of-running-vs-grade formula, the same academic
// basis GoldenCheetah and other open running-analytics tools use for their own GAP), a new
// Grade-Adj. Pace stat row and chart pill; a per-km/mile auto-splits table (pace/HR/elevation gain
// per split); a true rolling-window best-effort search across a single activity's own GPS stream
// (finds a fast 1K/5K/10K/etc. hiding inside a longer run, not just whole-run PBs); and -- for a TCX
// file whose device recorded real lap presses -- a real Laps table reading straight from the file's
// own <Lap> elements, tagging each lap Interval or Recovery by pace, showing actual interval/rest
// structure instead of an even split. GPX has no native lap concept at all (confirmed via research),
// so a GPX import always falls back to the even Splits table instead of inventing fake laps.
// Removed the Run/Walk/Idle timeline entirely -- Dylon flagged it as unreadable/unused on real
// device data, and asked to just remove it if it wasn't earning its place rather than keep patching
// it. The one-line "N walk breaks detected" summary (unrelated, simpler logic) stays. Also recolored
// the HR zone time-in-zone bars with a distinct low-to-high intensity color per zone (blue -> green
// -> gold -> amber -> red) instead of every zone sharing one flat accent color, matching the zone
// view conventions in the Strava/Google Health reference screenshots Dylon shared.
// Best Efforts now shows a real Strava-style ranking line under each distance ("Fastest 5K
// all-time!" / "2nd fastest 5K of 4") -- a new allEffortsAtDistance() merges every hand-logged
// session/Quick Add whose own whole-run distance matches, plus a true rolling-window search
// (activityBestEffort) across every imported Activity's own GPS stream, so a fast effort hiding
// inside a longer run still counts. The Personal Bests card also now falls back to that same
// fastest logged training effort -- clearly labeled "best training run" so it's never confused
// with a verified race result -- for any standard distance bucket that doesn't have a manually
// entered race PB yet, instead of only ever showing "Not yet raced": Dylon -- "if i have 5 runs
// unless i have a pre entered pb shouldnt it be added from my run like how strava always tell you
// this is your 2nd or 3rd fastest 5k?" A real race PB always takes priority over the fallback.
// New Pace Zones time-in-zone bar chart on a run's detail popup, matching Strava's own Pace Zone
// Analysis: six zones (Active Recovery/Endurance/Tempo/Threshold/VO2 Max/Anaerobic), bucketed by
// Grade Adjusted Pace against an estimated threshold pace. HALO has no dedicated threshold test, so
// estimatedThresholdPaceSecPerKm() reuses the existing Riegel-based Race Predictions engine
// (predictedRaceTimeSec), anchored at 15K -- Strava describes Threshold as sustainable "for up to 60
// minutes," which lands close to a 15K-to-Half-Marathon effort for most recreational runners. Stays
// hidden entirely until there's at least one real known performance to project a threshold from.
// New Route map on a run/walk's detail popup -- Dylon: "I also want visual maps as part of the run
// as well," modeled on the colored-by-HR-zone route map in a shared Strava screenshot. Deliberately a
// self-contained SVG plotting the raw lat/lon GPS track (equirectangular projection, one uniform
// scale factor so the route's true shape is never distorted) colored by Pace or Heart Rate, with a
// Cooler->hotter legend -- NOT an embedded real-map-tiles view (Leaflet/OSM/etc.), confirmed directly
// with Dylon: HALO is an offline-first PWA with no backend, and fetching map tiles from a third-party
// server every time this view opens would silently break offline use for exactly this one screen.
// Streams beyond 300 points are stride-sampled down first (a real device stream can be one point per
// second -- confirmed against Dylon's own ~7150-point file -- which would otherwise mean thousands of
// individual line elements in the DOM for no real gain in the route's visible shape).
// v0.27.1: fixed Dylon's real "splits are broken, route is also broken" report on a fresh TCX import.
// Root cause was NOT the parser or the render functions -- both were proven correct against Dylon's
// exact file in his exact browser (direct console calls returned valid, non-empty splits/route
// markup every time). The actual bug: #confirm-sheet-inner (the activity-detail popup) carries class
// "sheet", a flex column with max-height:92vh. Per the CSS flex spec, a flex item's automatic minimum
// size is normally its own content size (so it won't shrink below that) -- UNLESS the item's own
// computed overflow is anything other than visible, in which case that protection drops to 0. The
// Route card (overflow:hidden) and the Splits/Laps cards (overflow-x:auto, which also forces
// overflow-y:auto) were the only two card types in the whole popup that set an explicit overflow --
// so once the popup's total content grew taller than 92vh, they were the only cards eligible to be
// squeezed toward zero height, while siblings like Best Efforts/Pace Zones (no overflow set) kept
// their full natural size. Fixed by adding flex-shrink:0 to all three cards' inline styles -- the
// standard fix for this exact quirk -- rather than removing the overflow (which each card still needs
// for its own reason: clipping the SVG's rounded corners, and letting a wide table scroll instead of
// forcing the popup wider than the screen). Worth remembering if any future card in this popup ever
// needs its own overflow style.
// v0.28.0: Route card now shows a REAL map when online, not just the flat colored SVG. Dylon: "the
// rout is really barebones and not like a map, any suggestions to make it more of a map maybe using
// a maping api once online and bare bones offline version when there is no internet ? also we need
// to reorder how the data is presented. the map should be at the top of the page like Google health
// and the pill shaped bottons below it." Two parts:
// (1) initActivityRouteLiveMap() uses Leaflet + CARTO's free, keyless Positron/Dark Matter basemap
// tiles (picked over stock OpenStreetMap tiles so the map matches HALO's own light/dark theme).
// Leaflet loads from CDN (see the <script>/<link> tags near the top of index.html) -- harmless if
// unreachable, same convention as the existing Supabase/jsPDF CDN scripts. The offline SVG route
// (activityRouteSVG) is always rendered FIRST and stays the visible one by default, so there's never
// a blank flash while Leaflet's CDN request is in flight; the live map only swaps on top of it after
// confirming Leaflet is actually available, the device isn't explicitly offline, and real tiles
// loaded successfully within 5 seconds (falls back to the SVG on a tile error or timeout too, since
// navigator.onLine only reflects the network adapter, not real connectivity). The point/color
// computation that both the SVG and the live map draw from was pulled out into its own function,
// activityRoutePointsColored(), so the two can never drift out of sync with each other.
// (2) Reordered the whole activity detail popup: the Route card (map + Pace/Heart Rate toggle pills,
// now BELOW the map instead of above it) is the first thing shown, ahead of the "Over the Activity"
// chart -- matching the map-up-top layout in the Google Health screenshot Dylon referenced, instead
// of the map being buried partway down the popup.
// v0.28.1: three real-usage fixes/polish items after v0.28.0 landed with a real device online.
// (1) The live map rendered as an empty gray box (Leaflet's own attribution/controls showed fine,
// tiles never painted). Cause: initActivityRouteLiveMap() was calling L.map(container,...) while
// container still had display:none (its default state, meant to be flipped visible only after the
// map was built) -- Leaflet reads the container's real pixel size at construction time, and a
// display:none container measures 0x0, so its tile grid/pan bounds were computed wrong from the
// start. Fixed by flipping the container visible (and hiding the SVG fallback) BEFORE constructing
// L.map(), plus an immediate map.invalidateSize() and a second one after a short delay as a
// belt-and-suspenders re-measure for the sheet's own mount animation.
// (2) The name field's input + full-width "Save Name" footer button were always visible, even though
// renaming is rare -- Dylon: "i dont want that i think those buttons are too big to always be
// visible there should just be an edit button to edit run details (not everything) and then see the
// option to save." Replaced with a compact "Edit Name" button by default (the sheet's own title bar
// already shows the current name, so no need for a second always-visible copy); tapping it swaps in
// the input plus an inline Save button (saveActivityNameInline(), which re-renders the popup in
// place instead of closing it, unlike the old footer button which always closed the whole popup as
// a side effect of going through showConfirm's buttons).
// (3) The "GPS route recorded / no cadence data" note and the role/source-file line moved from
// right under the stat rows (ahead of every chart/card) down to their own small caption at the very
// bottom of the popup, just above the sticky Delete/Close buttons -- Dylon: "this text ... should be
// in the footer of the entire sheet."
// v0.28.2: two more real-usage polish items after v0.28.1.
// (1) Delete/Close still felt like too much permanent chrome at the bottom of the activity popup --
// Dylon: "these buttons are still in the way can you move them to a more compact location in the
// upper right corner." showConfirm() gained an opt-in `opts.cornerBtns` flag (default false --
// every other confirm popup in the app is unaffected) that renders its buttons as small controls
// next to the title instead of the usual full-width stacked footer; a `btns[i].icon` (inline SVG,
// same convention as the existing `.sheet-close` buttons) renders that one as a circular icon
// button, otherwise it falls back to a compact text pill. Only openActivityDetail passes this today.
// (2) The live map's green/red start/finish dots had no explanation, and the existing pace/HR color
// legend actually disappeared entirely whenever the live map took over (it used to live inside
// #route-svg-<id>, which gets display:none'd in that mode) -- Dylon: "there should be a legend for
// the coloured dots on the route." Both the color-scale legend and a new Start/Finish key now render
// in their own block outside both #route-live-<id> and #route-svg-<id>, so they show correctly no
// matter which of the two is currently visible.
// v0.28.3: fixed "Total time logged" (Progress stat grid) growing to something like 60 hours after
// logging a completely normal run. Dylon: "when entering time specifically hours manually it gets
// converted to days if i enter i run as 1:02:36 meaning 1hour, 2mins 36 seconds i see my total
// training time up to 60 hours and that shouldnt be." Direct testing proved the parser itself was
// never the problem -- parseDurationSec("1:02:36") correctly returns 3756 sec (1h 2m 36s) in every
// code path that touches it. The real bug: totalLoggedTimeSec() summed EVERY Quick Add (EXTRALOGS)
// entry ever created across the app's entire history with no date bound at all, while its own
// neighbors in the same stat-grid row ("Sessions logged," "Block mileage complete") only ever count
// the CURRENT block. Months of accumulated test entries were silently baked into that one number the
// whole time, invisible until any new entry pushed the total somewhere that finally looked wrong.
// Fixed by scoping EXTRALOGS to the current block's own min/max session date -- the same pattern
// weekPrehabActual() already uses for its own extras-in-range check -- confirmed with Dylon as the
// desired behavior (scope to current block, matching its neighbors) over the alternative of just
// relabeling it as an intentional all-time stat.
// v0.29.0: Edit expanded from "just the name" to full run details, and Edit/Delete moved into the
// corner icon row -- Dylon: "Move the edit name icon to the right with delete and close and use the
// attached svgs for delete and edit. also edit should not just be for the name but also run details
// also shoes is missing from this as well so if we can add shoes, tags and rpe scale and all the
// other manually editable activity information just like stava to the run information."
// (1) The standalone "Edit Name" ghost button below the title is gone; Edit is now a third icon
// button in the same cornerBtns row as Delete/Close, using Dylon's own uploaded Material Symbols
// pencil icon. Delete switched from a text pill to Dylon's uploaded trash icon too, so all three
// corner controls are icon-only now. Tapping Edit doesn't close-then-reopen the sheet (which would
// flicker the slide-up animation) -- showConfirm's btns[] gained an opt-in `keepOpen` flag that skips
// the auto-close for a button whose fn just re-renders the same popup in place, the same way the
// existing Pace/HR toggle pills already do.
// (2) The Edit form itself grew from a single Name input to Name + Shoe worn + Perceived Exertion
// (RPE) + Tags + Notes -- the exact same fields and components a hand-logged run/walk's own Quick Add
// form already uses (shoeSelectOptions/rpeSliderHTML/QA_TAGS/tagPillsHTML), reused as-is rather than
// rebuilt, so an imported Activity can now carry the same "manually editable activity information"
// Strava lets you attach to an activity. normalizeActivityRecord() gained matching shoe/tags/rpe
// fields (same value shapes NOTES/EXTRALOGS already use for them), shoeBlockKm() now also sums
// ACTIVITIES by shoe so assigning a shoe to an imported run actually counts toward its tracked
// mileage/wear, and activityStatRowsHTML() gained read-only Shoe/RPE/Notes/tag-pill rows to display
// whatever's been set. One Save commits all fields at once via the renamed saveActivityDetailsInline()
// (was saveActivityNameInline(), name-only); ACT_NAME_EDIT/toggleActivityNameEdit() are renamed
// ACT_EDIT_MODE/toggleActivityEditMode() to match the wider scope, plus a new ACT_EDIT_TAGS Set/
// toggleActEditTag() for the tag chips (kept separate from Quick Add's own QA_SELECTED_TAGS so the
// two popups' tag state can never collide).
// v0.30.0: Phase 2 of ANALYTICS_ROADMAP.md -- multi-activity days & reconciliation. Dylon: "my 2.63
// run is actually my recovery run which is planned today so we should start working on either
// uploaded runs in sessions or connecting uploaded sessions with planned ones." Phase 0 already built
// the data model for this (linkActivityToSession/activitiesForSession/unplannedActivities) but nothing
// in the UI ever called any of it -- this batch is entirely new UI plus the suggestion engine behind
// it, no data-model changes.
// (1) New matching engine: candidateSessionsForActivity(activity) finds planned sessions near an
// activity's date across EVERY block (not just the active one), excluding rest days;
// candidateActivitiesForSession(session) is the reverse lookup for unplanned activities near a
// session's date. sessionTypeMatchesActivityType() adds a "likely match" badge but is deliberately not
// a hard filter -- an accessory attachment (a warm-up walk against a run day, the real Google Health
// export pattern recorded in ANALYTICS_ROADMAP.md §2) is very often a different type on purpose.
// (2) Activity-side picker: openActivityDetail's popup now shows either the current plan link (with an
// Unlink action) or, if unplanned with a nearby candidate, a "Link to a planned session" prompt that
// expands into the candidate list -- each offering both "Fulfills this" and "Attach as extra" so Dylon
// picks the role himself.
// (3) Session-side picker: openLog's sheet gained an Activities card listing anything already linked
// (with its own Unlink), plus a "+ Attach Activity" toggle that expands into nearby unplanned
// activities with the same two role actions. Both pickers call the same linkActivityToSession() Phase
// 0 already built, so the STATUS='done' side-effect for a 'fulfillment' link can never apply
// inconsistently between the two entry points.
// (4) Activity Feed gained a "Needs Review" filter pill (with a live count) -- the roadmap's "unmatched
// activities inbox," literally just the feed filtered to unplanned activities that actually have a
// nearby candidate session; a genuinely unplanned one-off with nothing planned nearby stays out of it
// entirely rather than cluttering the count.
// Deferred to a later pass: replacing the typed-in prewalk/postwalk numeric fields with real attached
// accessory-Activity data, per the roadmap's own Phase 2 scope -- a bigger, separate change (touches
// the log form, CSV-style field lists, and existing sums) kept out of this batch to ship the core
// reconciliation flow first.
// v0.30.1: two real-usage bugs found immediately after Phase 2 reconciliation shipped.
// (1) "when you attach an activity it combines the total volume so it gets doubled." A session
// already logged by hand (NOTES.dist typed in, marked done) plus a real Activity now linked as its
// 'fulfillment' counted toward weekly volume (weekMetricTotal), Training Load (loggedRunKmInRange),
// and Block mileage (loggedDist/weekActualKm/cumulativeActualKm) TWICE -- once from the hand-typed
// number, once from the Activity's own distanceKm. New sessionHasFulfillingActivity(sessionId) helper
// now suppresses a session's own hand-typed metric in sessionMetric()/loggedRunKmInRange() once a
// fulfilling Activity exists (letting the real Activity's number stand alone), and loggedDist() falls
// back to the fulfilling Activity's distance when NOTES.dist was left blank rather than double-adding
// it. An 'accessory' link deliberately does NOT trigger any of this -- only 'fulfillment' means "this
// Activity IS this session," so only that role should suppress the session's own number.
// (2) "activity type needs work when importing i tried to import a mobility session and it still
// identified it as a run . make activity type editable." inferActivityType() had no mobility/stretch
// detection at all, so a GPS-less mobility session fell through every sport-string check and the
// distance/duration speed check straight into the old blanket "return 'run'" fallback. Added explicit
// "mobility"/"stretch"/"flexib" sport-string detection, and changed the true last-resort fallback (no
// sport match AND no distance/duration signal at all) from 'run' to 'workout' -- the existing generic
// catch-all -- since guessing 'run' with zero evidence either way was the actual bug. The
// distance/duration speed-based run-vs-walk inference itself (Task 59) is unchanged. Also added a Type
// select to the activity edit form (openActivityDetail/saveActivityDetailsInline) so any import that's
// still misdetected is one tap to correct by hand, same as shoe/RPE/tags/notes already are.
// v0.31.0: three more real-usage fixes/requests after Phase 2 reconciliation shipped.
// (1) "some places that should not have attach an activity, the weekly check in should not have an
// attach an activity button." sessionActivitiesHTML() now returns '' outright for ty==='checkin' --
// a reflection Q&A has nothing to attach an Activity to.
// (2) "we had in or plan to add an activity directly from within a planned activity and the manual
// activity should consume the data of the planned activity. i feel like all our activities should have
// one design the design across activities dont seem coheisive. when i add a run to my panned run i
// should still see all my metrics from within the planned run." Asked Dylon how far this unification
// should go (real Activities vs. richer display of the existing manual logging vs. a narrower
// manual-entry button only) -- he picked the full unification. First pass wired "+ Add Activity" to a
// hand-typed entry form; Dylon corrected this immediately: "no no the add activity is supposed to
// upload the activity (tcx, gpx files and complete the data" -- the button was always meant to trigger
// a file upload, reusing the existing import pipeline, not a typed form. Implemented (corrected):
//   - A new "+ Add Activity" button sits alongside "+ Attach Activity" in the session's Activities
//     card (sessionActivitiesHTML). It calls triggerActivityImport('sess-add-activity-import-input',
//     s.id) against a hidden per-session <input type=file accept=".tcx,.gpx">, reusing the exact same
//     handleActivityImportFile/confirmActivityImport/finalizeActivityImport pipeline the Activity Feed
//     and FAB already use -- not a new one-off form.
//   - triggerActivityImport(inputId, forSessionId) takes an optional second param and stashes it in a
//     new module-level PENDING_IMPORT_SESSION_ID; every other existing call site (which passes only
//     inputId) automatically clears any stale session-linking context.
//   - confirmActivityImport() pre-fills the #import-name-input with the session's own title and shows
//     a "Will be linked as fulfilling ..." note when PENDING_IMPORT_SESSION_ID is set -- "consume the
//     data of the planned activity."
//   - finalizeActivityImport() sets role:'fulfillment' + linkedSessionId on the parsed activity before
//     addActivity(), persists via saveState(), and re-opens the session sheet in place if it's already
//     showing, so the import's real metrics appear immediately -- marking the session done the same
//     way linking an existing Activity already does.
//   - sessionActivitiesHTML() renders each linked Activity's FULL stat rows (activityStatRowsHTML --
//     the exact same renderer openActivityDetail's own popup uses) directly inline in the session
//     sheet, instead of the old one-line title/date summary -- "I should still see all my metrics from
//     within the planned run." Tapping the title still opens the full popup (route map, charts, edit
//     form); the inline block means the core numbers no longer require leaving the session sheet at
//     all. Whether an Activity got there via file import from the session, from the Activity Feed, or
//     via "+ Attach Activity" linking, it now looks and behaves identically everywhere -- the "one
//     design" ask.
// v0.32.0: two more requests on top of the Phase 2/v0.31.0 reconciliation work.
// (1) "add a new ability to the FAB to upload training plans." A plan-upload mechanism already
// existed (triggerPlanUpload/handlePlanUploadFile/confirmImportPlan, reachable from the Plans sheet's
// "Upload Plan" button) -- Dylon wanted it reachable from the Today/Schedule FAB too, not a new import
// format. triggerPlanUpload(inputId) now takes an optional input id (mirrors triggerActivityImport's
// own inputId/forSessionId param), defaulting to the Plans sheet's '#plan-upload-input' so that button
// keeps working unchanged. The FAB gained its own "Upload Plan" menu item (fabUploadPlan()) and its own
// hidden `<input type="file" accept="application/json,.json" id="fab-plan-upload-input">` -- a
// dedicated input rather than reaching for '#plan-upload-input', since that one only exists in the DOM
// while the Plans sheet has actually rendered planUploadHeaderHTML(), which isn't true while the FAB
// lives on Today/Schedule. Both inputs share the exact same handlePlanUploadFile() handler.
// (2) "in the planned sessions when a user uploads an activity via tcx or gpx there should be the same
// charts and graphs found in the original activity files in history. user should also be able to do
// the same edit activity with shoes etc. essentially the planned activity and the activity found in
// the activity section needs to coincide. the user must be able to view the same information
// regardless of where they are viewing it." Traced this first: tapping a linked activity's title
// inside a planned session already opened the exact same openActivityDetail() popup (route map,
// charts, splits, HR zones, editable shoe/type/tags/RPE) as tapping it in History/Activity Feed -- same
// shared function and data either way. Asked Dylon whether that (one tap away) was enough, or whether
// the full analytics should render inline with no tap required -- he picked full inline. Implemented:
//   - sessionActivitiesHTML() now renders activityAnalyticsHTML(a,'sess-') (route map, pace/HR/
//     elevation chart, splits/laps, best efforts, pace zones, effort) directly under each linked
//     Activity's stat rows, in addition to the existing inline stat rows from v0.31.0 -- not a
//     separate, parallel renderer, the literal same one openActivityDetail's popup uses.
//   - renderActivityRouteMapHTML(a,idPrefix) and activityAnalyticsHTML(a,idPrefix) gained an optional
//     idPrefix param (default '', unchanged for the popup). The Route card's three ids
//     (route-card-<id>/route-live-<id>/route-svg-<id>) are keyed only by activity id, and the session
//     sheet can stay open behind the popup at the same time (openLog's #log-overlay and
//     openActivityDetail's #confirm-overlay are different overlays) -- so without namespacing, the
//     SAME activity's Route card would exist twice in the DOM with duplicate ids the moment both were
//     open together, and initActivityRouteLiveMap's getElementById('route-live-'+a.id) (only ever
//     called by the popup) could silently grab the wrong (inline) element. sessionActivitiesHTML
//     passes 'sess-' so its copy's ids never collide with the popup's own unprefixed ones -- covered by
//     a dedicated test confirming exactly one unprefixed route-card element exists even with both
//     views rendered simultaneously.
// v0.32.1: Dylon, after using v0.32.0 for a bit -- "I still think there is too many descreprencies
// with planned data and uploaded data. when i edit the uploaded data and edit the rpe and shoes these
// things needs to be translated to the planned data as well ... What I am aiming for is uploaded data
// completes the planned data once planned data gets a linked upload or linked activity it becomes 1
// activity editing it once covers everything." Traced this to a real, separate data model: a planned
// session has always had its OWN hand-typed NOTES[id].shoe/.rpe/.dist/etc (edited via "Edit Logged
// Data"), completely independent from a linked Activity's own shoe/rpe/distanceKm (edited via the
// Activity's own Edit form) -- editing one never touched the other, so they could silently drift apart
// or double-count. Asked Dylon how far to take the fix; he confirmed: once a session has a linked
// Activity, the Activity becomes the one editable copy -- "if there is no linked activity and it is
// manually logged thats fine but once an activity is linked the activity is now the main activity."
// Found and fixed FOUR separate rollup functions that read NOTES[s.id] directly without the
// sessionHasFulfillingActivity guard already used by loggedDist()/sessionMetric()/
// loggedRunKmInRange() (the v0.30.1 double-count fix never touched these, since they predate or sit
// outside that pass):
//   - shoeBlockKm(key) -- a fulfilled session's stale NOTES.dist/.shoe would count AGAIN on top of its
//     linked Activity's own shoe/distanceKm (already summed separately in the same function) -- could
//     even split one real run's mileage across two different shoes if the two shoe fields disagreed.
//     Now skips a session's own NOTES-based contribution entirely once sessionHasFulfillingActivity()
//     is true.
//   - computeBlockStats(b).actualKm (the Block Comparison table's Mileage column) read NOTES[s.id].dist
//     directly instead of loggedDist(s.id) -- so it silently UNDER-counted (not double-counted) any
//     session whose distance now lives only on its linked Activity, which is the normal case for the
//     file-upload workflow going forward. Switched to loggedDist(), which already has the correct
//     fallback.
//   - allEffortsAtDistance(km) and bestEffortsByDistance() could each list a fulfilled session's stale
//     NOTES-based entry AND its Activity's own entry as two separate ("duplicate") efforts at the same
//     distance. Both now skip the NOTES-based entry once sessionHasFulfillingActivity() is true.
//   - historyItems() pushed a plain 'session' item for every completed session AND a separate
//     'activity' item for every Activity -- so a fulfilled session showed up TWICE in History/Activity
//     Feed, often with the session's own copy blank ("Logged, no metrics entered") right next to the
//     Activity's real numbers. Now skips the 'session' item once sessionHasFulfillingActivity() is
//     true; the Activity's own item (which already shows "Completes a session") represents it alone.
// On top of the rollup fixes, made the EDITING surface actually single once linked, not just the
// numbers: openLog() now hides the session's own "Edit Logged Data" toggle/form entirely once
// sessionHasFulfillingActivity() is true (showing a short note pointing at the linked Activity above
// instead) -- rather than leaving two independently-editable copies of shoe/RPE/notes/etc sitting side
// by side. Un-linking doesn't delete the old NOTES data; the form simply reappears as it was if you
// ever do. confirmComplete() got the same guard for the edge case of clearing a fulfilled session's
// status and tapping Complete again by hand -- it now shows a short confirmation instead of re-opening
// the manual data-entry form on top of an already-linked Activity.
// v0.32.2: Dylon shared a real backup file (HALO Backup July 26 2026.json) after spotting "60h 46m
// Total time logged" again on Progress -- a similar-looking bug shipped and fixed before (v0.28.x, see
// test_total_time_scope.js), but this time the EXTRALOGS date-scoping from that fix was working fine.
// Traced the ACTUAL number through totalLoggedTimeSec()/sessionDurationSec()/extraLogDurationSec() and
// found it: one real Quick Add walk logged with duration "3215" (no colon). parseDurationSec()'s bare-
// number branch always treated a colon-less number as MINUTES ("45" -> 45 min), so "3215" became 3215
// minutes (53.6 hours) -- almost certainly meant as "32:15" (32 min 15 sec) typed on a phone with the
// ":" key skipped. Fixed with a sanity bound: a colon-less 3+ digit bare number that works out to more
// than 12 hours now gets reinterpreted as compact mm:ss (last two digits = seconds, the rest =
// minutes) instead of accepted at face value -- 12 hours is deliberately generous so it never misfires
// on a real long bare-minutes entry (a multi-hour ultra event, say), only on results no single logged
// session could plausibly be. This one fix corrects every consumer of parseDurationSec() at once
// (Quick Add, the session Log sheet, sessionDurationSec, extraLogDurationSec, totalLoggedTimeSec).
// Also this round, from the Progress tab's Activity Trends card:
// (1) "In the week breakdown merge same dates distances eg there are 3 entries on sund 26 but only
// 1.9km. what should happen is if i had 3 walks on sunday 26 cumulate all the walks on that day and
// only show the total. if there is no walks then hide the date. same for runs." renderTrendDayRows()
// used to render one row per underlying session/Quick-Add entry, including a "-" placeholder row for
// every session in the week with nothing logged for the selected trend. It now groups every
// contributor (planned sessions + Quick Add extras) by calendar date, sums them into one row per date,
// and drops any date with nothing logged for that trend entirely (a "Nothing logged this week" note
// shows if the whole week comes up empty).
// (2) "also remove dead hang filter dead hangs should be classified as a strength training exercise."
// TREND_TYPES no longer has a separate 'hang' entry -- it was never really its own training category,
// just one exercise logged inside a Strength session's own fields (NOTES.hangsets/.hangsec), same as
// squat/RDL/calf raise, none of which get their own pill either. The logged data itself is untouched.
// v0.32.3: three more Activity Trends fixes, spotted after using v0.32.2 for a bit.
// (1) "When i click a week in the activity trends the total doesnt change for past weeks." The big
// number/label above the chart ("X · Week N (currently viewing)") always read from twk=CURR_WK (the
// current in-progress week) regardless of which week's point was actually tapped -- CURR_TREND_WK (the
// tapped week) only ever fed the breakdown list below it, so the two could visibly disagree. Now
// twk=CURR_TREND_WK||CURR_WK||1, so tapping a past week updates the big number too, same week the
// breakdown already shows.
// (2) "also uploaded data isnt added to the activity trends breakdown" -- renderTrendDayRows() (the
// per-day breakdown) only ever summed NOTES-based sessions and Quick Add extras, never
// activitiesForWeek() -- so the big weekly total (weekMetricTotal(), which DOES include Activities)
// could show a real number while the breakdown underneath it said "Nothing logged this week." Added
// the same Activities handling weekMetricTotal() already has (run/walk by distanceKm, str/mob by
// count) to renderTrendDayRows(), plus a missing 'mob' Quick Add extras branch that had the same gap.
// (3) "best efforts by distance shouldnt log every distance let's use strava same distances instead."
// bestEffortsByDistance() used to bucket by Math.round(km) -- any distance, rounded to the nearest
// whole km, got its own group. BEST_EFFORT_SEARCH_DISTANCES (already used for the per-activity rolling-
// window search) is now also the canonical checkpoint list here, extended with 2 Mile/10 Mile/20K/30K/
// Marathon. A new closestStandardDistance(km) snaps a real logged distance to its nearest checkpoint
// within a generous ±7% tolerance (covers ordinary GPS wobble); anything further off any checkpoint is
// left out of the card entirely rather than getting its own bucket. knownPerformances() (which feeds
// race-time projections) updated from the old numeric g.bucket to the new {label,km} shape.
//
// v0.32.4 -- immediate follow-up after Dylon actually used v0.32.3: "best efforts are now gone from
// the progress." Traced with his own backup data: his real logged runs are ordinary prescribed
// training distances (5.85/6.1/5.1/8.1/2.67km), not races, so almost none of them landed within ±7% of
// a real Strava checkpoint under the v0.32.3 change above -- the card went from "one bucket per every
// rounded km" (too noisy) straight to "almost entirely empty" (too strict), losing real data along the
// way. New bestEffortDistanceLabel(km) fixes this with a hybrid: a genuine standard-distance match
// still gets the real label ("5K"), but anything that doesn't match falls back to the OLD nearest-
// whole-km bucket ("~6km") instead of vanishing -- so every logged run is visible somewhere, honestly
// labeled, and near-duplicate distances (5.85 and 6.1, both rounding to 6) still merge into one bucket
// like the original request wanted. bestEffortsByDistance()'s three add() call sites (sessions,
// EXTRALOGS, ACTIVITIES) all switched from calling closestStandardDistance() directly to calling
// bestEffortDistanceLabel() instead.
// v0.32.5 -- Dylon looked at the fixed-up v0.32.4 card and said "no but you had a card in progress
// labelled best efforts. bring back that card but use standard distances like those found in strava
// best efforts screen. this screen have tabs with top 3 efforts per distance that also linked to the
// activity. i want this feature," with two Strava screenshots showing a horizontal distance-tab row
// (400m/1K/1 Mile/.../5K/10K/...), a big "PR" hero for the selected distance, a ranked list of 2nd/3rd
// place efforts underneath, and each entry tapping through to its source activity. Full rebuild of
// renderBestEffortsByDistance(): a tab row (one button per bestEffortsByDistance() group, including the
// "~Nkm" fallback groups from v0.32.4) drives a module-level CURR_BESTEFF_DIST, defaulting to the
// shortest distance with real data (defaultBestEffDistLabel()); the active distance's fastest entry
// renders as a big PR hero, its remaining top-5 entries rank underneath (2nd, 3rd, ...). Every entry
// (hero and ranked rows alike) now carries a `source` object (added to bestEffortsByDistance()'s three
// add() call sites: DATA sessions, EXTRALOGS, ACTIVITIES) and taps through via new
// bestEffortEntryOnclick() to openLog()/openQuickAdd()/openActivityDetail() respectively -- the same
// three functions History/Activity Feed already use, so a Best Efforts entry opens exactly like it
// would from anywhere else in the app.
// v0.32.6 -- Dylon, right after the tabbed Best Efforts card shipped: "here are the distances i want to
// show best efforts for 400m 800m 1k 1 mile 2 miles 5K 10k 15k half marathon marathon. if i have never
// run a distance then i have no data to show only show data i have until i run the distance. you can
// also make best efforts accessable from the profile tab and give it it's own section in progress i.e.
// separate it from the trends." Three changes: (1) BEST_EFFORT_SEARCH_DISTANCES replaced with exactly
// those 10 distances (dropping the old 2 Mile/10 Mile/20K/30K set, adding 400m/800m) -- shared by both
// the per-activity rolling-window search and the cross-history card, so both now only ever look for
// this fixed set. The "only show data I have" behavior needed no new code -- both features already
// only ever produce a result/tab for a distance with a real match. (2) The Best Efforts by Distance
// section in Progress no longer lives inside `if(CURR_TREND==='run' && CURR_RUN_SUBTAB==='pace')` --
// it's now unconditional, right after the Activity Trends card closes, so it stays visible regardless
// of which trend pill or Run subtab is selected. Given its own id="best-efforts-section" anchor. (3)
// New openBestEffortsFromProfile() and a "Best Efforts → View" row in renderProfile() (next to the
// existing Race Goals/Shoe Rotation quick-access rows) call switchView('progress') then scrollIntoView
// the new anchor, matching the "Personal Bests moved to Progress" precedent of not duplicating the same
// list twice, just adding a way to reach it from Profile.
// v0.32.7 -- Dylon looked at the newly fixed-list card and said "why is each tab still showing 3k,
// 8km, 6k? the tabs should be specific to the specified list. if the distance is 6km for a run you are
// only checking 5km of that run and pulling the best 5km segment from it not checking close to 5km."
// Two real fixes: (1) removed the v0.32.4 "~Nkm" fallback bucket entirely (bestEffortDistanceLabel is
// gone) -- a hand-logged session/Quick Add entry (no GPS stream, just a total distance+duration) now
// either genuinely matches one of the 10 fixed BEST_EFFORT_SEARCH_DISTANCES checkpoints via
// closestStandardDistance(), or contributes nothing at all, full stop. (2) For a real imported Activity
// WITH a GPS stream, bestEffortsByDistance() no longer matches on the activity's own whole-run distance
// either -- it now runs activityBestEffort(a,d.km) (the exact same rolling-window search the per-
// activity "Best Efforts in This Activity" card already uses) for every one of the 10 fixed distances
// the stream actually covers, so a single 6km+ run can correctly surface a genuine 5K result (the real
// fastest 5K-long stretch inside it) even though the whole run itself was never close to being a 5K --
// and can in fact surface several distances at once from one run, same as a real race can set a 5K AND
// 10K PR simultaneously. An Activity with no real stream (manually added with just a distance/duration,
// no GPS trace) falls back to the same whole-run match sessions/extras use, since there's nothing to
// search inside. Caught along the way: normalizeActivityRecord() always gives every Activity a `stream`
// object (empty arrays by default, never null) so a naive truthiness check couldn't tell "has real GPS
// points" apart from "no stream at all" -- fixed to check `.length` instead.
// v0.32.8 -- Dylon reversed the v0.32.0 "full analytics inline in a planned session" feature: "ok so i
// have some changes i want to make originally i asked for the ability to see the charts in line when i
// upload an activity to a planned session. I want to revert that since one activity can have many files
// added to it the stream can get quite long so lets have just the basic info but when i click in to
// each part of the activity i get taken to the run data. there should be a button however as opposed to
// clicking the title that says analyze activity next to the uploaded activity." sessionActivitiesHTML()
// no longer calls activityAnalyticsHTML(a,'sess-') at all -- back to just activityStatRowsHTML's basic
// numbers. The activity title/name is no longer clickable (removed its cursor:pointer/onclick); a new
// "Analyze Activity" button (calling the same openActivityDetail()) sits below the stat rows instead,
// opening the exact same full-analytics popup Activity Feed's own entries already use -- so nothing
// about the popup itself changed, only how a planned session's own view reaches it.
// v0.32.9 -- Dylon, looking at a session sheet with the plan's target Distance/Shoe row sitting right
// at the top (above the linked activity): "move this information into the run details portion below
// the uploaded activity it seems out of place here as this is information needed before the run. also
// remove the shoe tag as well." In openLog()'s body builder, the `quickStatsHTML(s)+equipRowHTML(s)`
// call moved from right after the workout-title field to right after the "Details" header (i.e. below
// sessionActivitiesHTML() and the fulfilled-note/Edit-Logged-Data block) -- Distance/Shoe (or Strength
// Type/Time, Rest, etc, depending on session type) now introduces the Details/steps breakdown instead
// of leading the whole sheet. equipRowHTML()'s run-type branch (`else { eqs=[[s.shoe||'Running Shoe',
// 'shoe']]; }`) changed to `else { eqs=[]; }` -- no equip-chip pill for a run/easy/long/qual/race session
// at all now, since it just duplicated the Shoe value quickStatsHTML already shows right next to it.
// Strength/rest/mobility sessions' own equipment chips (Rings/Dumbbell/Bodyweight/Bar/Jump Rope) are
// untouched -- only the shoe chip was ever in scope.
// v0.32.10 -- five small fixes/asks in one batch from Dylon:
// 1) "the time and the km logged doesnt seem to change after uploading walks" -- totalLoggedTimeSec()
//    never looked at ACTIVITIES at all, only DATA/EXTRALOGS, so a standalone imported walk (or any
//    activity not hand-typed into NOTES) contributed nothing. Now sums every ACTIVITIES entry dated
//    inside the block's range too (same scoping as EXTRALOGS), skipping fulfillment-linked ones since
//    those are already covered by sessionDurationSec()'s own new fallback -- a session fulfilled purely
//    by an uploaded activity, with no hand-typed NOTES.duration, now counts that activity's real
//    durationSec (mirroring the fallback loggedDist() already had for distance). Confirmed directly with
//    Dylon that "km logged / planned" should stay run-mileage-specific (compared against the block's own
//    MILEAGE_PLAN, same reasoning Week Recap already uses to split "km run" from "km walked") --
//    cumulativeActualKm() is intentionally untouched, only Total time logged changed.
// 2) "rename upload plan in the fab to Import Training plan" -- the FAB's fabUploadPlan() button label
//    changed from "Upload Plan" to "Import Training Plan" (the Plans-sheet's own "Upload Plan" button,
//    a separate piece of markup, is untouched).
// 3) "remove the scrollbar seen in img 2" -- the Best Efforts distance tab row (renderBestEffortsByDistance)
//    had a bare `overflow-x:auto` div with no scrollbar-hiding treatment; now uses the existing
//    `.chip-scroll` utility class (already shared by the Plans-sheet filter chip rows) for the same
//    "scrollable but no visible scrollbar" look everywhere else in the app.
// 4) "make the detail area of a run collapsable one activity is completed or added" -- the Details
//    section (target quick stats + step-by-step breakdown, under the "Details" header in openLog) is now
//    collapsible: tap the header to toggle. New LOG_DETAILS_OPEN state (null until the user explicitly
//    taps) drives a default via logDetailsOpen() -- collapsed once activitiesForSession(id).length>0 (a
//    real Activity has been completed/added for the day, nothing left to plan for), expanded otherwise.
//    Resets to null (falls back to the default again) whenever a different session is opened, same
//    pattern as LOGGED_DATA_OPEN/SESS_ATTACH_OPEN.
// 5) "add 100m and 200m as a best effort distance (helpful for strides data)" -- prepended to
//    BEST_EFFORT_SEARCH_DISTANCES ({label:'100m',km:0.1},{label:'200m',km:0.2}), ahead of 400m -- strides
//    are logged well short of 400m, so without these the rolling-window search had nothing short enough
//    to find inside a strides rep.
// v0.32.11 -- Race Predictions redesigned per Dylon's own hand-drawn, Strava-inspired mockup: "there
// is a new selector option that changes based on distance prediction click it and the hero changes and
// reveals the current time, the predicted time by the end of the training block ... the +/- and a
// chart showing the progress of the prediction over time. the axis of the graphs are labelled distance
// against time to show the progress." Confirmed 3 open questions with Dylon before building: (1) the
// new pill selector fully REPLACES the old "every distance stacked as a row" table, no dual mode; (2)
// the trend chart reconstructs REAL history (not just accumulating forward from a snapshot log) by
// recomputing the prediction as of each past week, using only what was logged by then; (3) the
// Strava-style range bar ships in this same pass, scaled to a block's own length.
// predictedRaceTimeSec/knownPerformances/estimateRaceTime/bestEffortsByDistance all gained an optional
// `cutoffDate` param (every existing call site untouched -- defaults to no filtering) so a past week's
// prediction can be recomputed using only data logged by that point. racePredictionTrendForDistance(km)
// walks the block week by week reconstructing {date,sec,projected:false} history, then appends
// {date,sec,projected:true} forward-extrapolated points from today through the block's final week using
// the same clamped per-week rate racePredictionRows() already computes (factored into a shared
// racePredPerWeekPct()). filterRacePredTrendByRange(points,'2w'|'4w'|'block') trims the visible window
// (forward-projected points always stay regardless of range). renderRacePredTrendChart() draws an
// INVERTED y-axis (a faster/smaller time plots HIGHER -- "up" reads as "getting faster," matching the
// mockup and Strava's own chart) with real calendar-date x-axis labels, and renders the projected
// segment dashed with hollow dots, visually distinct from the solid real-history line.
// racePredictionsCardHTML() rewritten: distance pill selector (CURR_RACE_PRED_DIST, same "sticky
// selection with a sensible default" pattern as CURR_BESTEFF_DIST) replaces the old table entirely; a
// new Current/In-N-weeks/+- three-column comparison block (.rpred-cmp) replaces the old two-column row;
// the trend chart sits below that; a Today/1M/3M/6M-style range bar (CURR_RACE_PRED_RANGE, '2w'/'4w'/
// 'block') sits under the chart, scaled to a training block's own ~8-12 week length rather than a
// literal 6 months. racePredRowHTML/racePredLabelHTML/RPRED_RUN_ICON (the old table row's own
// rendering) are gone entirely; racePredRowColorMeta/RACE_PRED_ALT_COLORS are NOT dead code though --
// personalBestsSectionHTML() still reuses them for its own alternating row treatment.
// Building the trend chart surfaced a real, independent bug: currentRealWeek()/weekForDate's
// nearest-session-date fallback (built to answer "which week's phase should Today show," not "how many
// weeks have elapsed") routinely resolves to a week that hasn't actually happened yet whenever today
// sits closer to next week's session date than last week's -- caught via direct testing, where it
// produced the SAME today-capped trend point three times over, and would have silently put the hero's
// "In N weeks" figure out of sync with the chart's own final plotted point. Fixed with a new,
// date-only racePredWeeksElapsed() that both racePredictionRows() and racePredictionTrendForDistance()
// now share, so the two numbers always agree exactly.
// v0.32.12 hotfix (2026-07-27) -- Dylon: "the entire ui broke," seeing the Schedule tab as a totally
// unstyled flat list (no card backgrounds, spacing, borders, or rounded corners). Root cause: the big
// explanatory comment added above the Race Predictions CSS in v0.32.11 listed old class names using
// "cur*/" as shorthand -- that's a literal `*/` sequence, which closed the CSS comment early. Everything
// from there to the NEXT real `*/` (several lines of comment prose) then got fed to the browser's CSS
// parser as if it were actual rules, which it obviously couldn't parse, corrupting/dropping a large
// chunk of the stylesheet and taking every card's styling down with it -- not scoped to Race
// Predictions at all, which is why the whole Schedule tab lost its layout. Fixed by rewording that one
// line so no comment ever contains an accidental `*/`; verified by walking the entire <style> block
// char-by-char confirming comment open/close counts now match (59/59, previously 59 opens vs 60
// closes) and by loading the real file in jsdom and confirming all ~460 CSS rules parse, including
// .rpred-hero through .rpred-range-btn.active which were the ones silently getting eaten before.
// v0.32.13 -- two small follow-ups. (1) Dylon asked whether the Race Predictions trend chart actually
// updates with real performance: "i want it to be a live chart like strava... when i improve again
// plot on the chart again." It already did -- the solid history line is recomputed from real logged
// data on every render, the dashed forward line's slope shifts with the current Fitness Trend rate --
// but nothing on the chart explained which points were which. Added an Actual/Projected dot legend
// under the chart (shown only when both kinds of point actually exist) and reworded the caption to say
// it updates automatically. (2) Dylon shared a star icon and asked for "coloured badges to the top 3
// best efforts... gold for top best, silver for second and bronze for third" on the Best Efforts by
// Distance card -- added new --silver/--bronze theme colors alongside the existing --gold, a shared
// bestEffortMedalSVG(size,colorVar) icon helper (same star shape, just recolored per rank), and placed
// it on the PR hero (gold) and the first two ranked rows underneath it (silver, bronze) -- ranks 4-5
// keep their plain ordinal number, unchanged. Also confirmed for Dylon: the Best Efforts card already
// caps its ranked list at exactly top 5 (hero + 4 ranked rows via runs.slice(1,5)), no change needed.
// v0.32.14 -- a Progress tab cleanup batch plus two bug fixes, all from one message. Bugs first: (1)
// the Race Predictions footer caption was appended AFTER the card's own closing </div>, floating
// outside it instead of being part of it -- Dylon: "place the footer text inside of the card remember
// we dont want floating texts" -- moved inside. (2) Dylon: "the 2w 4w block switch doesnt seem to
// work" -- the underlying selectRacePredRange()/filterRacePredTrendByRange() logic was already
// correct (confirmed via a real DOM click-through test), what actually looked broken was the
// browser's default blue tap/focus ring drawing around the whole segmented control on every tap;
// killed it with outline:none + -webkit-tap-highlight-color:transparent on .rpred-range-btn.
// Reorg, per Dylon's own numbered list: (1) Personal Bests moved back to Profile (it had moved to
// Progress in an earlier batch); (2) Training Load removed from the Progress stat-grid entirely --
// stays in Recovery only; (3) Week Recap moved from Progress (where it always showed last week) into
// Schedule's own week-detail panel, generalized to take an explicit wk so it recaps whichever week you
// actually click into; (4)+(5) the old standalone "Block Progress" section's completion bar is now
// merged directly into the Current Block card (blockProgressCardHTML deleted), the redundant
// "Completion %" stat box removed since the bar itself already shows that, and Best Streak moved up
// to share one row with km Logged; (6) Activity Trends moved to render immediately after the
// stat-grid instead of further down the page.
// v0.32.15 -- Dylon: "Don't make weekly check in count towards progress / data." Weekly Check-In is
// a reflection day (freeform text answers, no distance/pace/effort of its own), not a training
// session -- confirmed scope directly: it should stop affecting Sessions logged/Missed on Progress,
// the Current Block done/total + progress bar, streaks, week-complete checks, and Week Recap's
// sessions-done count, while still showing up normally as an ordinary session in Schedule/Today and
// still logging its own reflection answers as before. Added one shared isCheckinSession(s) predicate
// and applied it everywhere that math lives: countDone()/totalSessions()/the Progress "Missed" stat,
// dayHasActivity() (day/current/longest streaks), blockLongestStreak() (per-block streak used by
// Block Comparison), computeBlockStats() (doneCount/totalCount/missedCount/completionPct -- feeds the
// Current Block card, Profile's own block card, and Block Comparison), weekIsComplete() (feeds the
// Schedule hero-track's "weeks complete" count), and weekRecapHTML() (Sessions-done numerator AND
// denominator, plus the empty-state check that decides whether a recap shows at all).
// v0.32.16 -- Dylon (right after v0.32.15 shipped): "i am still seeing blank bar streaks due to not
// logging check in. the weekly checkins are not for stats its more of a training journal." v0.32.15
// stopped the Weekly Check-In from affecting Progress/streaks/Week Recap, but missed one more spot:
// the per-session dot bar and "Total Workouts" count on each Schedule week card (weekListCardHTML) and
// its week-detail panel (renderWeekDetailHTML) still built their dots from every session including the
// Check-In, so an unlogged Check-In showed up as a permanently blank/grey dot and inflated the workout
// count -- reading as a "broken streak" even though every real session was actually done. Both
// functions now filter with isCheckinSession(s) into a separate statSessions list before building the
// dot bar and the Total Workouts (and, in the detail panel, "X done") counts, while the day-by-day
// list underneath still shows and lets you log the Check-In exactly as before -- only the dot bar and
// counts are affected.
// v0.32.17 -- Dylon: "the coaches note is just floating give it some style please." The .coach-note
// block (Schedule's week-detail Coach note, a session's own coach note, and Race Day Strategy's
// mindset note all share this one CSS class) set background:var(--s2) with no border -- in the light
// theme --s2 (#F7F8FA) sits almost indistinguishable from --bg (#F4F5F7), so it read as plain
// unbounded text rather than a card, especially next to the real cards above/below it (dot bar, Week
// Recap). Changed .coach-note to background:var(--s1);border:1px solid var(--b1) -- the exact same
// background+border .card itself uses -- so it now reads as a proper card everywhere it's used, in
// both themes.
// v0.32.18 -- Dylon: "let weight and body fat in the profile take its data when i manually add weight
// and body fat. this also means that we have to add body fat when we log weight manually. in the
// progress tab place run progression before strength progression." Three changes: (1) Quick Add >
// Weight now has a Body fat (%) field next to Weight, saved onto the EXTRALOGS entry as bodyFat --
// previously body fat only existed as a disconnected, manually-typed field in Profile with nothing
// feeding it. (2) Profile's Weight/Body fat are no longer their own separate, manually-typed inputs --
// clarified directly with Dylon: they're now a read-only display of latestWeighIn() (new helper --
// most recent EXTRALOGS weight entry, falling back to legacy NOTES-based weight on old sessions from
// before weight had its own standalone Quick Add flow), tappable straight into Quick Add > Weight to
// log a new one, which is the only way to update it now. (3) In renderProgress(), Run Progression's
// html+= now runs before Strength Progression's (was the other way around) -- no visibility-condition
// changes, Strength Progression still only shows when the active block has strengthProgression data.
// v0.32.19 -- fixed a real, silent data-loss gap flagged from earlier debugging work (never reported
// directly by Dylon, caught while reviewing what to tackle next): buildSyncPayload()/
// applySyncPayload() -- the one shared function backing BOTH the file-based backup/restore flow and
// cloud sync push/pull -- never included ACTIVITIES (imported/synced watch files, Phase 0) at all. A
// backup restored on another device, or a fresh device pulling from cloud sync, would come back with
// every session status/note/block/race intact but zero imported activities, with no error or warning
// anywhere. Root cause: ACTIVITIES persists to its own localStorage key (saveActivitiesList(), the AK
// constant) rather than through saveState() like everything else, which is exactly why it was easy to
// leave out of both functions. Fixed by adding activities:ACTIVITIES to buildSyncPayload()'s return,
// and in applySyncPayload(), if(data.activities){ ACTIVITIES=data.activities; saveActivitiesList(); }
// -- the explicit saveActivitiesList() call matters, since just assigning ACTIVITIES in memory
// wouldn't persist past the current session. An old-format backup with no "activities" key at all
// (from before this fix) is left alone, same as the existing blocks/seasons guard already does, so
// restoring an old backup can't wipe out activities already on the device. Real side effect worth
// flagging: since this payload is shared with cloud sync, activities -- including their full
// per-second GPS/HR streams -- now also sync across devices on every push, not just backup/restore;
// a genuine increase in per-push payload size for anyone with a lot of imported activities, but the
// alternative (activities never reaching a second device at all) was strictly worse.
// v0.32.20 -- Dylon: "let's finish off leftover phase 2." The one piece of Phase 2
// (ANALYTICS_ROADMAP.md) never actually built: "replaces the current typed-in prewalk/postwalk
// numeric fields with real attached accessory-Activity data ... stop typing an approximation where
// real recorded data can live instead" -- the same kind of change as the earlier run-data weight-field
// removal. The two typed km inputs (id="l-prewalk"/"l-postwalk") are gone from
// sessionLogFieldsHTML's "Walk & Extras" section, replaced with a hint pointing at "+ Attach
// Activity" (which already existed on every session). A warm-up/cool-down walk attached there as an
// accessory Activity shows its own real distance/duration/pace via the same activityStatRowsHTML row
// sessionActivitiesHTML already used for every other linked Activity -- no new display code. It was
// also already being summed into weekly walk totals regardless of role (weekMetricTotal's
// activitiesForWeek() call, since role is completion-tracking only) -- no new aggregation code either;
// the only real gap was the UI still offering a typed-number shortcut instead of pointing at the real
// feature. captureLogFields() no longer writes new prewalk/postwalk values; sessionMetric() keeps a
// legacy-only read of NOTES[id].prewalk/postwalk so already-logged old sessions don't silently drop
// out of past Week Breakdown/Activity Trends numbers. Skipped entirely for Weekly Check-In, matching
// the existing "no Activities card on a reflection day" decision.
// v0.32.21 (2026-07-27) -- Dylon: "lets do phase 3" (then picked all four remaining pieces at once).
// Closes out ANALYTICS_ROADMAP.md's Phase 3: a Fitness & Freshness card (CTL/ATL/TSB, the same
// recursive-EMA model real training-load apps use, built on Phase 1's own Relative Effort score --
// sits in Recovery > Durability alongside Training Load, hidden until there's both HR Zone Calculator
// data and at least one day of real training impulse to compute from); PB Progression, a per-distance
// "how has my fastest known time moved over the block" line reusing the existing race-prediction
// trend chart (faster=higher) since a PB is always historical, never projected; Weekly Zone Time
// Trends, a stacked bar chart (HR zones or Pace zones, toggle between them) showing time-in-zone per
// week rather than only per-activity, skipping any week with no eligible activity instead of a
// misleading empty bar; and a smaller-polish pair -- the route map now colors a detected walk break
// (already used for the "N walk breaks detected" sentence) a dedicated fixed color instead of letting
// it fall wherever the pace/HR gradient happens to put it, and Training Load's existing acute:chronic
// ratio gets a second, additive "Effort Load" reading weighted by real Relative Effort instead of
// distance, so a week of easy long walks and a short week of hard hilly tempo runs can now read
// differently even when their raw km are similar.
// v0.32.22 (2026-07-27) -- next-up pick after Phase 3 shipped: FIT (Garmin's native binary export
// format) import. Closes a gap flagged since Phase 1a shipped -- only TCX/GPX were parseable, so a
// Garmin/COROS device had to be told to export one of those explicitly instead of handing over its
// default FIT file. New parseFITBuffer() (index.html, ~line 4103) reads a FIT file's own Definition/
// Data Message stream directly (no XML involved at all) into the exact same {sport,stream,calories,
// laps} shape parseTCXString/parseGPXString already return, so buildActivityFromParsed() and every
// downstream analytics feature needs zero format-specific changes. Wired in via a new
// importActivityBinary()/isFitBuffer() pair alongside the existing importActivityText() path --
// handleActivityImportFile now always reads a file as an ArrayBuffer first, then decides which parser
// applies (FIT direct, or TCX/GPX after a text decode) rather than needing two separate FileReader
// flows. Every "+ Import Activity" entry point across the app now accepts .fit alongside .tcx/.gpx.
// Deliberately not implemented: developer fields (third-party sensor data) and CRC-16 validation --
// see parseFITBuffer's own comment for why neither was worth the added complexity for a v1.
// v0.32.23 (2026-07-27) -- Dylon: "oh u know what i wanted? ability to upload and review multiple
// files at once." Every general-purpose "+ Import Activity" input (FAB, Today, Activity Feed) now
// has the native `multiple` file-picker attribute (the session-specific "+ Add Activity" input stays
// single-file on purpose -- one planned session can only be fulfilled by one activity). Selecting
// more than one file now shows a review list, one card per file, each with its own editable name and
// an include checkbox (checked by default) -- a file that fails to parse shows its error right there
// instead of silently vanishing from the batch, and nothing is saved until Import is tapped, same
// "review before it's real" contract the single-file flow already had. New
// confirmActivityImportBatch()/finalizeActivityImportBatch()/cancelActivityImportBatch() (index.html,
// alongside the existing single-file confirmActivityImport()) plus shared
// readFileAsArrayBuffer()/parseActivityBuffer() helpers both paths now read through.
// v0.32.24 (2026-07-27) -- bug fix. Dylon re-imported Block 5's Week 1-2 via the new multi-file
// import feature, splitting real watch data for a single day into several files (warm-up walk, the
// run itself, strides, cool-down walk) -- Dylon: "the total mileage (km logged) still doesnt
// calculate correctly." Root cause: loggedDist()/sessionDurationSec() (index.html) both used
// ACTIVITIES.find() to pull a session's fulfilling Activity, which only ever grabs the FIRST
// role:'fulfillment' Activity linked to a session and silently drops the rest -- worst case, a long
// run's warm-up walk (1.1km) matched first and its actual 8.15km run vanished from the block total
// entirely. Both functions now sum every fulfillment-role Activity for a session instead of taking
// the first (accessory-role warm-up/cool-down Activities are still correctly excluded from the sum).
// v0.32.25 (2026-07-28) -- Dylon: "when i set up my heart rate zones it works but then it disappears
// after reload... the freshness and fitness chart is always visible but without data there should be
// a message informing user to do the heart rate calculator... there should be a button asking the
// user to save to their profile." HRZONE_LAST (index.html) was always just the calculator's own
// in-memory live preview -- it reset to null on every reload, so Fitness & Freshness, Weekly Zone
// Time, and per-activity HR breakdowns all silently lost their data too. New currentHRZones() reads
// PROFILE.savedHRZones instead -- a real persisted field, set only by the calculator's new "Save to
// Profile" button (saveHRZonesToProfile()) -- and every one of those three features now reads through
// it. Fitness & Freshness is now always visible with a clear "set up your zones" prompt when there's
// nothing to show yet, the Profile tab has a new Heart Rate Zones card once they're saved, and a
// staleness nudge (hrZoneNudgeHTML(), 90-day threshold) suggests recalculating periodically since
// fitness drifts over time.
// v0.32.26 (2026-07-28) -- very serious bug fix. Dylon: "my uploaded activity is no longer present in
// the planned sessions after I reload. Week one information stays, but week two moves... in the local
// version I actually see no activity at all." Root cause: every imported Activity (index.html) keeps
// a full 1Hz GPS/HR/pace stream, so a single ~75min run's stream JSON alone can run 600KB+; Dylon's
// real Block 5 activities together hit ~5.8MB in one localStorage key, past the browser's quota. The
// old safeSet()'s bare catch(e){} swallowed the resulting QuotaExceededError with zero visible error --
// saveActivitiesList() looked like it worked, but nothing past the point the quota was first crossed
// ever reached disk, so it vanished on the next real reload while earlier, smaller saves stayed put.
// Fix: new downsampleStreamArrays() caps every stream to STREAM_MAX_POINTS (1000) before it's
// persisted -- plenty of resolution for splits/GAP/best-efforts/the route map -- and safeSet now
// reports success/failure so saveActivitiesList can warn via showToast if a save still fails even
// after compaction, instead of pretending it worked.
// v0.32.27 (2026-07-28) -- Dylon: "when downloading the training plan via pdf it renames the file
// to the current week. the plan should be renamed using the following convention
// 'athlete-trainingplantitle'." New shared planDownloadFilename(b,ext) (index.html) + a slugify()
// helper build every plan-download filename (PDF/Markdown/ICS, both Block 5's own hardcoded
// downloader and the generic one every other block uses) from PROFILE.name + the block's planTitle
// (falling back to its short name) instead of each download function picking its own ad hoc name.
// v0.32.28 (2026-07-28) -- new weekly sleep tracking (index.html), per Dylon's design: sleep is now
// captured in hours instead of a 1-5 rating. gpCheckinDay() and stepsFor()'s checkin fallback both
// gained a new sleepHours question (type:'number'), which renderStepsHTML() now renders as a real
// number input instead of a textarea. The ad hoc Wellness Check-In form (openWellnessForm/
// saveWellness) swapped its 1-5 "Sleep Quality" select for an "Average Sleep (hours)" number field --
// editing an old entry preserves its legacy 1-5 sleep value rather than deleting it. New
// resolveWeeklySleepHours() implements Dylon's confirmed fallback chain for "this week's sleep": the
// Weekly Check-In's own sleepHours answer wins if present, else the average of any Wellness Check-Ins
// with sleepHours logged in the same rolling 7-day window, else no data point at all -- a missing
// week is left as an explicit gap, never a fabricated 0. wellnessEntryScore() drops from a 3-factor
// (energy+sleep+soreness) to a 2-factor (energy+inverse-soreness) average, applied uniformly across
// old and new entries alike, since sleep no longer shares the 1-5 scale with the other two fields.
// v0.32.29 (2026-07-28) -- Dylon: "with regard to the pdf issue thats fine but replace the pdf in
// my plan with this version" (following up on the stale-Block-5-PDF gap flagged in v0.32.27's
// writeup). BLOCK5_PLAN_PDF_B64 (index.html) -- Block 5's own hardcoded "Download Plan" PDF blob,
// which had been frozen since before this session's plan revisions -- is now the base64 of Dylon's
// own freshly reconciled PDF ("2026 Block 5 Training Plan Durability Ignition (1).pdf"), byte-for-
// byte round-trip verified. No code changes; data-only swap, so Block 5's PDF download still goes
// through the same downloadBlock5PlanPDF()/planDownloadFilename() path from v0.32.27 unchanged.
// v0.32.30 (2026-07-28) -- Dylon: "before my speed intervals in my plan i didnt notice any warm up
// jogs" -- w2d3 (Fartlek Bridge, the block's very first quality session, week 2) had no warm-up
// prescribed anywhere -- not in its det text, not in QUALITY_CFG (index.html), which only had entries
// starting at w3d3, so it fell through to genericStep() with no structured Warm Up/Cool Down at all.
// Then Dylon: "but i see walks as warm up in my other quality sessions" -- w3d3's own QUALITY_CFG
// entry said "1.5 km easy walk + drills" while every other quality session (w4d1 onward) says "easy
// jog + drills"; nothing in the plan's own narrative doc supports a walk-only warm-up before interval
// pace, so this read as a leftover inconsistency rather than intentional. Fix: QUALITY_CFG gained a
// new w2d3 entry (jog warm-up, reps/repDist/pace matching its own det text's 12x30s/1min-jog-recovery
// structure), and w3d3's wu field was corrected from "walk" to "jog" -- every quality session in the
// block now warms up the same way.
// v0.32.31 (2026-07-29) -- Dylon: "on the activity import screen after selecting the file outside of
// just renaming the activity i want the ability to edit other details like RPE and shoes before
// saving... there are too many steps to having to edit shoes and other details." Both the single-file
// import screen and every card of the multi-file batch review now get the same Type/Shoe/RPE/Tags/
// Notes fields the post-save activity detail popup already had (new importEditFieldsHTML()/
// readImportEditFields() pair, index.html), so those can be set before an activity is ever saved
// instead of only after. Separately, the multi-file batch review is now a swipeable one-card-at-a-time
// carousel instead of a long stacked list -- Dylon: "instead of a long list of all the files we are
// trying to import, make it a swipeable card... swipe across or click navigation buttons left and
// right to go between each card" -- built on the same scroll-snap approach the Today race countdown
// carousel already uses (new .ibatch-carousel/.ibatch-card CSS, scrollImportBatchCarousel()/
// commitBatchCardEdits()/wireImportBatchCarousel()). Also: double-checked and confirmed Progress's
// "km logged" stat is deliberately plan-only by design (a standalone/unplanned walk never counted
// toward it) -- Dylon: "does it also include walks... display runs as the large number as it
// currently is but only runs and walks as a minor number in the same card." New
// totalLoggedKmRunsWalks() adds a small secondary "X km incl. walks" line under that same stat card
// (only shown when it actually differs from the plan-only figure), without changing the card's size.
// v0.32.34: the HR-zone donut chart moved off Profile entirely -- Dylon: "the zones in the profile
// stay stagnant and the one in the activities are more catered for a pie chart feature." Profile's
// Heart Rate Zones card reverted to a plain static list (vertical color bar + name + bpm range,
// Zone 5 -> Zone 1, "Rest"/"Max" at the open ends -- closer to Strava's own Training Zones settings
// page). The donut/callout/chip-row chart (activityHRZoneDonutSVG/activityHRZoneDonutOverlayHTML/
// activityHRZoneChipRowHTML/activityHRZoneChartHTML) now lives on each activity's own "Effort" card
// in activityAnalyticsHTML, replacing its old flat list of zone bars -- wedges are sized by real
// time-in-zone seconds from activityHRZoneBreakdown(), so the center readout can show an actual
// "Zone 3 / 50%" the way Strava's own chart does, which Profile's static reference never could.
// v0.32.35: two follow-ups to the HR-zone chart move. (1) Dylon: "I liked how you had what each
// zone is meant for previously, so if you could include that again, perhaps under the heart-rate
// zone in the profile" -- each zone's "best for" text is back under its name/range row in
// profileHRZonesCardHTML's static list. (2) Dylon: "I want to move activities out of Progress --
// give them their own main tab. So we now have five tabs: Today, Schedule, Activities (or Feed),
// Progress, and Recovery." New primary tab (renderActivities/#view-activities/CURR_VIEW==='activities'),
// consolidating what used to be THREE separate UIs on the identical historyItems() query -- Progress's
// embedded "History" card + "Full History" sub-screen (PROGRESS_SUB/HISTORY_FILTER/openHistory/
// closeHistory/renderHistoryHTML, all removed) and the standalone "Activity Feed" sheet
// (actfeed-overlay/openActivityFeed/ACTFEED_FILTER, also removed) -- into this one tab.
// v0.32.36 -- Dylon shared a screenshot of Runna's Activities tab: "wee need to redesign the
// activities to look more presentable as a home page tab take a look at runna stream to redesign it
// with a preview of data give each activity it's own card as well dont use the coloured line on the
// outside of runnas card though you may colour each card base don activity." Each history item
// (planned session, extra log, or imported activity) now renders as its own real .card instead of
// every item sharing one big wrapper (historyItemCardHTML), grouped under a Runna-style month header
// row showing that month's total distance (activitiesMonthGroups). Each card previews up to 3 labeled
// stats -- Distance/Time/Avg Pace where that applies, falling back to HR/RPE/weight otherwise
// (historyItemStatsHTML) -- instead of one packed text line. Cards are colored per activity type via
// a soft full-card gradient tint (activityTypeIcoCls/ICO_CARD_TINT), reusing the exact same sess-ico
// color pairs Today/Schedule already use, rather than Runna's own outer accent bar, which Dylon
// explicitly ruled out.
// v0.32.37 -- Dylon, after the Activities tab's card redesign shipped, shared Runna's own activity
// detail screen: "great job on the activity feed design. can you update the session details to be
// just as clean as well i am sharing runna's session detail screen for inspiration. take special not
// of font sizing and spacing specifically." The activity detail popup (openActivityDetail) now leads
// with a big bold hero stat grid (Distance/Time/Avg Pace, then Elevation Gain/Avg HR/Calories),
// demoting everything else to a spaced-out Details list below it (activityStatRowsHTML's new
// opts.hero, opt-in so the import-confirmation cards and a planned session's inline Activities list
// keep their original compact rendering). Every section header (Route, the per-metric chart, Splits/
// Laps, Best Efforts, Pace Zones, Effort) now uses a bigger, more generously-spaced header (actHdr)
// instead of the small uppercase .section-lbl eyebrow style, card padding was bumped up throughout,
// and the per-metric chart is now headed by the metric actually showing (e.g. "Pace") instead of a
// generic "Over the Activity" label, sitting inside a real card like every other section now does.
// v0.32.38 -- Activities-tab toolbar redesign: the inline "+ Import Activity" button is gone,
// replaced by the same shared Add-Activity FAB Today/Schedule already had; a real search box now
// filters the list by title, with the filter pills tucked behind a toggle icon instead of always
// showing; and "Needs Review" moved from a filter pill to its own flag icon with a count badge,
// opening a sheet that also lets a genuinely standalone activity be dismissed from review for good.
// v0.32.39 -- two follow-up fixes: Today reverted from the center tab back to leading the nav (Dylon
// didn't like the v0.32.38 move), and the FAB icon's color changed to white for contrast against its
// accent-blue background; the Needs Review icon also changed from a hand-authored flag to a bookmark.
// v0.32.40 -- every icon touched across v0.32.38/39 got replaced again with Dylon's own supplied SVGs:
// the FAB now shows a real plus/X pair swapped by open state (not one static icon), the filter toggle
// uses a proper filter-list glyph, Needs Review uses a dedicated review icon (not the bookmark), and
// the Activities tab's own nav icon uses its own dedicated glyph instead of borrowing the FAB's.
// v0.33.0 -- Dylon: "Turn races into an actual page instead of just a pop up. give it a search field
// and filter similar to activities as well." Races moved out of the Plans sheet's old "Race Calendar"
// tab into its own real page (#view-races, same architecture Profile already used -- reached via the
// desktop sidebar's Races button and a new mobile Tools-sheet row, not a new bottom-nav tab), with a
// search box (matches name + location) and the existing block/distance filter chips now tucked behind
// a toggle icon, mirroring the Activities tab's own pattern. Plans is Season-Blocks-only now.
// v0.33.1 -- three follow-up fixes/requests on the new Races page. (1) Fixed: "Manage Races" from a
// block card or the block detail pane did nothing visible -- openRaces()/openRaceDetail() never
// closed the still-open Plans sheet before switching views, so the Races page rendered underneath it,
// invisible. (2) Dylon: "make the add race form a pop up" -- the add/edit form is a real overlay
// (#race-form-overlay) now instead of rendering inline on the Races page. (3) Dylon: "add the ability
// to add races from the FAB as well" -- the Add-Activity FAB has a new "Add Race" item that opens the
// same popup from any page, no need to navigate to Races first.
// v0.33.2 -- Dylon (with a screenshot): "plot points on graphs are blown up when in desktop mode."
// The Weekly Volume, Race Predictions/PB Progression, and Block Comparison charts all stretch a
// fixed-width SVG to the card's fluid width via preserveAspectRatio="none" -- correct for the lines/
// area fill, but their point-marker <circle>s lived in that same coordinate space and got stretched
// into wide ellipses once the real rendered width (desktop) grew well past the chart's 320-unit
// viewBox. Moved the dots out of the SVG into real, absolutely-positioned HTML circles -- the same
// fix already applied to these charts' own text labels in an earlier version, just missed for the
// dots at the time.
// v0.34.0 -- five follow-up requests from a single message, with screenshots of mismatched km-logged
// numbers and Strava's own time/streak UI. (1) Fixed a real bug: loggedDist()/sessionDurationSec()
// (driving the "km logged"/"Total time logged" stats) prioritized a session's own stale hand-typed
// NOTES value over a linked fulfilling Activity's real one -- the opposite priority from
// sessionMetric() (driving the weekly trend chart) -- so the two numbers could genuinely disagree for
// a session that kept an old hand-typed figure after later getting a real Activity linked. Both now
// defer to a fulfilling Activity first, matching sessionMetric()'s own priority. (2) Fixed a second,
// distinct dot bug beyond v0.33.2's "blown up" fix: renderRacePredTrendChart's padding-right:32px
// wrapper meant its dot overlay's 0%-100% coordinate space (measured against the padded box per the
// CSS spec) didn't match the SVG's own narrower rendered width, drifting dots right of the line --
// fixed by nesting an unpadded inner wrapper around just the SVG + dot overlay. (3) Added a Time view
// to Activity Trends -- Dylon: "strava has time in activity I will like a graph that shows time per
// activity (Run, walk, Strength, and Mobility)" -- Run gets a 4th subtab, Walk/Strength/Mobility get a
// new Weekly Volume/Time toggle, both driven by the same renderTrendAreaChart used everywhere else in
// this card. (4) Built a real Strava-style streak page (reached by tapping the existing streak stat
// card in Progress): a big current-streak number, longest-streak/active-days stats, a month calendar
// with a small activity-type icon on every logged day, month navigation capped at the real current
// month, and a Share button -- built entirely on the app's existing, unmodified streak math. (5)
// Verified, not built: editing an imported activity's type on the import confirmation screen was
// already fully implemented and tested (importEditFieldsHTML's Type select) before this request.
// v0.34.1 -- two follow-ups on v0.34.0. (1) Dylon: "in the activity trends i see my mobility that i
// upload dont get included... activity trends is supposed to give data for all actities entering the
// app whether it is part of the training block or not." Root cause: weekMetricTotal()/
// weekDurationTotal() bucketed standalone EXTRALOGS/ACTIVITIES entries by weekForDate() -- which finds
// the nearest PLANNED session by date-diff. A sparse plan week can nearest-match a standalone log
// logged near a week boundary into the WRONG adjacent week -- not dropped, just silently miscounted
// in a week you weren't looking at. New trendCalWeek() buckets these by pure Monday-anchored calendar
// math off the block's own week-1 start instead, used only by Activity Trends (every other
// weekForDate() consumer is untouched). (2) Dylon: "add a right chevron on the streak card that shows
// if you click it that it has more data. I also want to track both daily and weekly streaks in the
// same card... split that card into week and day. give it a new design." The Progress streak card
// moved out of the 2-column stat-grid into its own full-width row showing a Day streak and a new Week
// streak (currentWeekStreak()/longestWeekStreak() -- a week counts if any day inside it has activity)
// side by side, with a right chevron to the Streak page, replacing the old "Current streak · Longest:
// N days" line. The Streak page's own hero shows the same Day/Week split.
// v0.34.2 -- two more follow-ups, right after v0.34.1. (1) Dylon: "the streak card is to remain the
// same size as the other cards in the grid just split in 2 to fit both week and daily streaks" -- the
// streak card moved back inside the 2-column .stat-grid as one normal-sized cell (same footprint as its
// neighbors), with a compact Day/Week split and a small chevron instead of the short-lived full-width
// card from v0.34.1. (2) Dylon: "i have 2 strength sessions marked off but 1 only recorded i also have
// several post run mobility but those dont get loaded in... the point is with activity trends i get to
// track how many activities and time in activity i have recorded." Root cause, confirmed with a direct
// reproduction: a session used to bail out of Activity Trends entirely once ANY fulfilling Activity was
// linked, trusting a separate loop to re-add its number by matching that Activity's own `.type` field --
// fragile, since an imported/logged Activity's `.type` is often something generic like 'workout'
// (inferActivityType()'s own fallback for a file with no GPS/sport-string match), silently dropping the
// whole session. Fixed: a session's own contribution now always comes from sessionMetric()/
// sessionDurationSec() (which already pull a linked Activity's real numbers regardless of its `.type`),
// and the Activities loop only independently adds non-fulfillment (accessory/standalone) Activities, so
// nothing is ever double-counted either.
// v0.34.3 -- two more follow-ups on the same Progress screenshot. (1) Dylon: "there is enough room for
// the icon, please put it back" -- the compact streak card's flame icon, dropped entirely in v0.34.2's
// resize for space, is back at the card's leading edge (a small .streak-mini-flame wrapper), with the
// Day/Week split's inner gap tightened from 8px to 6px to make room. (2) Dylon, still seeing wrong
// running totals after v0.34.2's fix: "I don't know why we are getting the activity trends so wrong the
// running km that is. why is it so hard to just add up individual running stats?" Root cause: a bug I
// introduced myself while fixing the previous week's misattribution issue. v0.34.1's new trendCalWeek()
// bucketed standalone activities into Monday-Sunday calendar weeks, but a block's real week boundaries
// are NOT necessarily Monday-Sunday -- parsePlanJSON() (and every hand-authored block) assigns each
// planned session's date as BLOCK_START + (week-1)*7 + day, anchored to whatever weekday BLOCK_START
// itself falls on. Block 5's real seeded BLOCK_START (2026-07-19) is a Sunday, not a Monday, so forcing
// Monday-anchored weeks shifted every standalone log's bucket away from the plan's own actual week
// boundary. Fixed: trendCalWeek() now uses the same (days since BLOCK_START)/7 day-offset formula the
// plan itself uses, so a standalone log always lands in exactly the same week a planned session on that
// same real date would. mondayOfDate() is untouched and still used (correctly) by the week-streak
// functions, which are a genuinely different, plan-independent concept.
// v0.34.4 -- two corrections after the v0.34.3 round turned out to have partly chased the wrong
// problem. Dylon, with a screenshot proving the Activity Trends weekly numbers were right all along
// (matching what he saw on Strava): "how u were calculating the data wasnt incorrect infact that
// version lined up perfectly to what i was seeing on strava. the issue is the total km logged (in the
// activity grid) was giving incorrect figures 28 in week 1 and 20 in week 2 is 48km but the total km
// logged was 53. that is incorrect." Real root cause: weekActualKm() (feeding the "km logged / planned"
// stat, weeklyConsistency(), and Mileage by Week -- all explicitly "run-plan-specific" by design)
// summed every session marked done in a week with no session-type filter at all, unlike the correct
// Activity Trends weekly total, which only ever looks at run-type sessions. A non-run session (Strength,
// Mobility) that happened to have a distance attached silently inflated "km logged" past the true
// running total -- nothing to do with week-bucketing, which was already fixed and correct. Now filtered
// to run-type sessions only. (2) Dylon on the streak card, after three rounds of progressively-shrunk
// redesigns: "the streak card the icon is now too small and the you removed the colour. all that was
// required was to add the week streaks in place of the sub text." Reverted to the original
// single-hero-number layout -- a real colored icon badge next to the big day-streak number -- with only
// the old "Longest: N days" subtext swapped for the week streak.
// v0.34.5 -- the real fix for "when i imported mobility sessions i.e. post run stretch this data didnt
// get loaded in the activity trends," found after asking Dylon directly what Type the affected activity
// showed as (rather than guessing again): "It already says Mobility." That ruled out import
// misclassification and pointed at the counting logic. Root cause, reproduced directly: a correctly
// Type-confirmed 'mobility' Activity attached with role:'fulfillment' to a RUN session (e.g. a post-run
// stretch imported as its own file and marked "Fulfills this" on that day's run, instead of "Attach as
// extra") was completely invisible to the Mobility trend. Every Activities-loop in weekMetricTotal/
// weekDurationTotal/renderTrendDayRows/renderTrendDurationDayRows skipped EVERY fulfillment-role
// Activity outright, assuming its number is always already folded into its linked session's own
// contribution -- true when a Strength Activity fulfills a Strength session, but the run session's own
// sessionMetric('mob') is null (it's not a mobility session), so nothing ever counted this Activity's
// real number. Fixed with activityFulfillmentAlreadyCounted(a,type): a fulfillment-role Activity is only
// skipped now when its OWN linked session actually matches the trend type being computed.
// v0.34.6 -- two corrections after Dylon laid out his exact real logged data by hand. (1) Activity
// Trends week totals: "you may be counting mon-sun but the figures are actually incorrect you are
// inflating the numbers in the weekly trend." v0.34.3's BLOCK_START-anchored trendCalWeek() (BLOCK_START
// 2026-07-19, a Sunday) put week 1's boundary at Saturday, misattributing Sunday's Recovery Run into
// "Week 2" -- inflating it by 2.7km relative to the real Monday-Sunday split Dylon's own data proved
// correct (Mon 20 - Sun 26 = 28.2km exactly, Mon 27 onward = the next week). The block's own plan data
// even says so directly: BLOCK_START is described as a prep day, "the block runs Monday to Sunday."
// trendCalWeek() now anchors to the first real Monday on-or-after BLOCK_START instead of BLOCK_START's
// own weekday. (2) Streak card: Dylon designed and sent his own exact mockup -- "here is the design you
// are to use" -- a wide standalone hero card (icon badge, big "N DAYS", divider, "N WEEKS", chevron) on
// a soft amber gradient, replacing the grid-cell version from every prior round.
// v0.34.7 -- Dylon: "the streak card is too wide it should be the same size as the other grid items
// without changeing the design." The exact v0.34.6 mockup (icon badge, N DAYS, divider, N WEEKS,
// chevron, amber gradient) moved back into a normal .stat-grid cell, scaled down to fit -- no design
// elements removed, just resized. He also reported still seeing wrong weekly run km and no mobility in
// Activity Trends on the live site; both the trendCalWeek() Monday-anchor fix (v0.34.6) and the
// fulfillment-type-mismatch fix (v0.34.5) were re-verified this round against his exact real logged
// data and still hold (28.2km/14.5km weekly split, mobility-fulfilling-a-run-session counted) -- see
// git history/deploy notes: this and every prior fix back to v0.34.1 had never actually been pushed to
// the live GitHub Pages site, which is the far more likely explanation for "still incorrect" reports
// than a residual code bug.
// v0.34.8 -- testing locally (not the undeployed live site) confirmed the streak card's own layout, but
// Dylon: "the streak card still isnt designed properly the main streak can be larger to match the other
// cards and the weeks treak to match the sub text." Resizing the card down to grid-cell width in v0.34.7
// had shrunk its text way past what the grid's own type scale uses. .streak-hero-days now matches
// .stat-num exactly (22px/800, same as "13/90" or "47.2" on the neighboring cards), .streak-hero-weeks
// now matches .stat-lbl (12.5px, same as "Sessions logged"/"km logged / planned"), and the badge/chevron
// were sized back up in proportion so the card still reads as one cohesive design at the new type scale.
// v0.34.9 -- Dylon root-caused his own reported Run trend inflation (Week 1 showing 30.5km against a
// real 28.2km, Wed 22 at 7.6km instead of 6.2km, Sat 25 at 9.3km instead of 8.2km): "so i found the
// error, some walks were added as activity and not as extras is there some way we can ensure that this
// dont happen when we add walks (warm up or cool down) and even add mobility post run that they get
// added to their designated activity type even if it is attached to a planned session?" Root cause:
// loggedDist()/sessionDurationSec() summed EVERY fulfillment-role Activity linked to a session with zero
// regard for that Activity's own .type -- a warm-up/cool-down walk marked "Fulfills this" on a run
// session had its distance/duration folded straight into the run's own number (inflating the Run trend)
// while ALSO still counting correctly under its own Walk trend -- a genuine double-count. Fixed with
// activityIsNativeToSession(a,s): a fulfilling Activity's number only folds into its session's own total
// now when its type is native to that session's type (run session -> 'run' Activity only; Strength ->
// 'strength' only; Mobility -> 'mobility'/'yoga' only; the generic unclassified 'workout' fallback still
// always counts, preserving the earlier v0.34.2 fix). A walk or post-run mobility session attached to a
// run session still marks it done, but its own ground covered/time now only ever shows up once, under
// its own real type's trend.
const CACHE_NAME = 'halo-0.34.9-alpha.1';
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icon-512-monochrome.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the app shell so you always get the latest edits when online,
// falling back to the cached copy the instant you lose signal (so it still opens offline).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
