# Requirements — interview log

One question at a time. Each answer is written here as soon as it is given.

| # | Question | Answer | Date |
|---|---|---|---|
| 1 | Who will use Split Pay — only you, or you and your friends on their own phones? | Solo first, sync later. It will be used with friends, up to 10 people maximum. | 15 Nov 2026 |
| 2 | Android only, or should friends on iPhone be able to use it too? | Mostly Android. A web app is also fine for the group. | 15 Nov 2026 |
| 3 | Import your existing history from the original app, or start fresh? | Start fresh. No import needed. | 15 Nov 2026 |
| 4 | Which features are must-have for version 1, and which can wait? | Approved the four buckets below as proposed. | 15 Nov 2026 |
| 5 | Currencies: IDR only, or several (SGD, USD) with conversion? | Six currencies: IDR, SGD, MYR, THB, CNY, JPY. Assumed (to confirm): IDR is the default, each expense picks its currency, balances are kept per currency, conversion stays in bucket B. | 15 Nov 2026 |
| 6 | Look: same dark layout with new colours, or a different style? | Same flow (same tabs, same steps), but a different UI style. Claude chooses the colours; Raymond approves the mock-up in the Design phase. | 15 Nov 2026 |
| 7 | What do you want to customise that the original does not allow? | Add to version 1: (1) round amounts — whole numbers for IDR and JPY, two decimals for SGD, MYR, THB, CNY; (3) share a "who owes whom" summary to WhatsApp as text or picture. Assumed for version 1.5: own categories and icons, saved people presets. | 15 Nov 2026 |
| 8 | Backup: where should your data be saved if the phone is lost? | Manual backup file: a "Back up" button saves one file sent to Google Drive through the Android share menu; "Restore" reads it back. No login inside the app. | 15 Nov 2026 |

## Change after the interview (16 Nov 2026)

Raymond changed the delivery form: **an installable web app instead of an `.apk`**, with a one-tap home-screen icon on Android ("Add to Home screen"), built with **Rust for the money maths and normal web code for the screens**. Reasons: almost no setup on the PC, works for friends on any phone, updates by itself. It can still be wrapped into an `.apk` later. Everything else in this file is unchanged.

Questions may be added or dropped depending on earlier answers (for example, question 2 matters less if the answer to question 1 is "only me").

## Feature buckets (answer 4)

**A. Version 1**
1. Create groups (Home, Trip, Couple, Other) and add members by name (no accounts until sync).
2. Add expense: description, amount, date, note, category.
3. Five split methods: equally, exact amounts, percentages, shares, adjustment.
4. Paid by one person or several.
5. Expense list by month, edit and delete.
6. Balances per group and overall, with simplify debts.
7. Settle up (record a payment).
8. Friends tab and Activity tab.
9. Dark and light theme.
10. Rounded amounts: whole numbers for IDR and JPY, two decimals for the other currencies (answer 7).
11. Share a balance summary to WhatsApp as text or picture (answer 7).
12. Six currencies, IDR default, balances per currency (answer 5).
13. Back up to a file and restore from it (answer 8).

**B. Version 1.5** — built early, in version 1.1 on 17 Nov 2026, at Raymond's request ("finish features first"). Conversion uses typed rates.
1. Charts and totals.
2. Export to spreadsheet.
3. Search.
4. Repeating expenses.
5. Receipt photo.
6. Whiteboard notes and trip dates.
7. Conversion between currencies.
8. App lock (passcode, fingerprint).
9. Own categories and icons (answer 7).
10. Saved people presets (answer 7).

**C. With sync (phase 7)**
1. Login, invite by link or QR code.
2. Notifications and reminders.
3. Comments on expenses.
4. Web app for non-Android friends.

**D. Left out**
1. In-app payments, payment card, bank import.
2. Scanning a receipt and assigning items one by one.
