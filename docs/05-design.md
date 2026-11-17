# Design decisions

## Style — chosen 16 Nov 2026

**Style A, "Ink & Lime".** Dark, bold, one bright accent. Picked by Raymond from three options ([screenshots](design/screenshots/)).

| Token | Value | Used for |
|---|---|---|
| Background | `#0E0F11` | Screen background |
| Surface | `#1A1C20` | Cards, icon tiles, menu bar |
| Line | `#272A30` | Dividers, outlines |
| Text | `#F4F5F2` | Main text |
| Muted | `#8B9096` | Secondary text |
| Accent / positive | `#C8F135` (lime) | Main buttons, "you are owed" |
| Negative | `#FF8A5B` (orange) | "you owe" |
| Font | Space Grotesk | Everything |
| Corner radius | 10 px (cards), 16 px (Add button), full (chips, menu bar) | |

Rules:
- Same flow as the reference app: four bottom tabs (Groups, Friends, Activity, Account), group list, expense list, Add button.
- Amounts: `IDR 265,000` — no cents for IDR and JPY, two decimals for SGD, MYR, THB, CNY.
- A light theme is also required in version 1; it will be derived from this palette.

## Screens

| Screen | Mock-up | Status |
|---|---|---|
| Home (groups) | [style-A-ink-and-lime.png](design/screenshots/style-A-ink-and-lime.png) | Approved with style |
| Group detail | same file | Approved with style |
| Add expense | [style-A-add-expense-and-split.png](design/screenshots/style-A-add-expense-and-split.png) | Approved 16 Nov 2026 |
| Adjust split | same file | Approved 16 Nov 2026 |
| Balances | [style-A-balances-and-settle-up.png](design/screenshots/style-A-balances-and-settle-up.png) | Approved 16 Nov 2026 |
| Record a payment | same file | Approved 16 Nov 2026 |
| Friends, Activity, Account, Create group, Group settings | — | No mock-up; built directly from the same patterns |

The data model in [06-data-model.md](06-data-model.md) was approved on 16 Nov 2026.

## App icon

Six options in [app-icons.png](design/screenshots/app-icons.png) (source: [app-icons.html](design/app-icons.html)). Choice: **icon 1, "Split coin"**, picked 16 Nov 2026 "for now" — Raymond may change it later, so keep the icon easy to swap.
