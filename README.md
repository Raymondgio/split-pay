# Split Pay

A personal expense-splitting Android app (`.apk`): same features as the app in the reference video, no ads, no paywall, fully customisable.

This project is **separate from VION**. Nothing here reads from or writes to `C:\Claude\VION`.

## Status

Phase 2 of 7 — Design. Requirements signed off by Raymond on 15 Nov 2026. Design finished 16 Nov 2026 (Style A, icon 1). Delivery changed to an **installable web app with a Rust core** (see [docs/03-requirements.md](docs/03-requirements.md)).

Phase 4 — Build core: first working version built and tested on the PC on 16 Nov 2026. See [app/README.md](app/README.md).

Version 1.1 (17 Nov 2026) — all of buckets A and B are built and tested on the PC:

- Version 1: onboarding, groups, members, add / edit / delete expense, five split methods, one or several payers, six currencies with rounding, balances, simplify debts, settle up, Friends, Activity, Account, dark and light theme, share summary as text or picture, non-group expenses, backup and restore, offline support, home-screen icon.
- Version 1.5: totals and charts, export to spreadsheet (CSV), search, repeating expenses, receipt photos, whiteboard, trip dates, conversion with typed exchange rates, app lock with PIN, own categories, saved people presets.

Not done or not verified yet:
- Renamed from "Split Pro" to **Split Pay** on 17 Nov 2026.
- Putting it on a phone: host = GitHub Pages from `github.com/Raymondgio/split-pay` (17 Nov 2026), live at `https://raymondgio.github.io/split-pay/`. Steps in [app/README.md](app/README.md).
- Only testable on a phone: the share sheet to WhatsApp, the camera for receipt photos, fingerprint unlock.
- Exchange rates are typed by hand; nothing is fetched from the internet.
- Bucket C (sync with friends, login, notifications, comments) — phase 7, started 17 Nov 2026 with Firebase. Plan: [docs/07-sync-plan.md](docs/07-sync-plan.md).

## Files

| File | What it is |
|---|---|
| [docs/01-app-analysis.md](docs/01-app-analysis.md) | What the reference video shows: screens, features, gaps |
| [docs/02-roadmap.md](docs/02-roadmap.md) | The 7 phases from idea to `.apk` |
| [docs/03-requirements.md](docs/03-requirements.md) | Decisions from the interview (filled one answer at a time) |
| [docs/04-apk-findings.md](docs/04-apk-findings.md) | What the reference APK shows: how it is built, extra features |
| [docs/05-design.md](docs/05-design.md) | Chosen style (A, Ink & Lime), colours, screen list |
| [docs/06-data-model.md](docs/06-data-model.md) | How data is stored, and the rules for money and splits |
| [docs/design/](docs/design/) | Mock-up pages and their screenshots |
| [app/](app/) | The app itself: Rust core and web screens |
| [docs/reference-screens/](docs/reference-screens/) | 14 screenshots taken from the video |

## One rule

Split Pay uses its own name, icon and colours. Features and flows can match the reference app; its name, logo and artwork are not copied.
