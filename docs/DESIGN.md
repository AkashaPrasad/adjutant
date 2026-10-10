# Adjutant Gate: Operator Console Design Spec

Scope: the approval and audit console (overview, run review, runs and effects tables, systems viewer, audit-packet verifier). This document is implementable as written. All colors listed were checked against WCAG 2.x contrast (ratios in the token notes).

## 1. Design principles

- Information first, chrome last. Every pixel of border, fill or color must encode state or structure. If removing it loses no meaning, remove it. (Linear limits chrome color and keeps UI neutral; Primer says do not use color as the primary emphasis.)
- One accent, three statuses. Blue is the only brand/interactive color. Green/amber/red appear only for status and only as small text, dot or tinted badge, never as large fills.
- Dense but legible. Default table row 32px, 13px body text, tabular numerals for every number. Density is a user setting (24/32/40), not a layout fork (Carbon row sizes).
- Flat surfaces separated by 1px borders, not shadows. Elevation is expressed by surface lightness and border only. Shadows exist only on floating layers (menu, dialog, toast).
- Every decision is traceable. Any risk level, decision, hash or timestamp on screen is copyable, has an exact value on hover/focus, and links to its source record.

## 2. Tokens

Define on `:root` for light and override under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`. Body gets an explicit `background: var(--bg-app)`.

### 2.1 Color

| Variable | Light | Dark | Use / contrast note |
|---|---|---|---|
| `--bg-app` | `#F6F7F9` | `#0E1116` | Page canvas |
| `--bg-surface` | `#FFFFFF` | `#151A21` | Cards, tables, panels, sidebar |
| `--bg-subtle` | `#EEF0F3` | `#1C222B` | Row hover, table header fill, code block |
| `--bg-muted` | `#E4E7EC` | `#252C37` | Pressed, selected row |
| `--border` | `#D8DCE3` | `#2A313C` | Dividers, card and table borders (decorative, exempt from 3:1) |
| `--border-strong` | `#B8BEC9` | `#3A4352` | Hovered borders, separators in toolbars |
| `--border-control` | `#7C8696` | `#6B7686` | Input, checkbox, select outline. 3.68:1 on white, 3.80:1 on dark surface (WCAG 1.4.11) |
| `--text` | `#14181F` | `#E6E9EE` | Primary text. 17.8:1 / 14.4:1 |
| `--text-2` | `#4A5260` | `#A9B1BE` | Secondary text, table body labels. 7.9:1 / 8.1:1 |
| `--text-3` | `#5F6877` | `#8B94A3` | Meta, axis labels, placeholders. 5.3:1 on app bg, 4.9:1 on subtle / 5.7:1, 5.2:1 dark |
| `--accent` | `#2457D6` | `#8CAEFF` | Links, active nav marker, focus ring, selected state text. 6.2:1 / 8.0:1 |
| `--accent-solid` | `#2457D6` | `#2F62DB` | Primary button fill, white text. 6.2:1 / 5.4:1 |
| `--accent-solid-hover` | `#1B46B0` | `#2753B8` | Primary button hover |
| `--accent-bg` | `#E8EEFC` | `#16233F` | Selected row tint, info badge. text on it 5.3:1 / 7.1:1 |
| `--ok` | `#17794A` | `#4CC38A` | Success text/dot. 5.4:1 / 7.9:1 |
| `--ok-bg` | `#E6F4EC` | `#12281D` | Badge fill. 4.8:1 / 7.0:1 |
| `--warn` | `#8A5A00` | `#E0A93B` | Needs approval, medium risk. 5.9:1 / 8.3:1 |
| `--warn-bg` | `#FBF1DC` | `#2B2210` | Badge fill. 5.3:1 / 7.4:1 |
| `--danger` | `#B42318` | `#FF7B72` | Blocked, high/critical risk, destructive. 6.6:1 / 6.9:1 |
| `--danger-bg` | `#FCE9EA` | `#341719` | Badge fill. 5.6:1 / 6.5:1 |
| `--focus-ring` | `#2457D6` | `#8CAEFF` | 2px outline, 2px offset |

### 2.2 Chart palette (muted, validated against both surfaces)

| Variable | Light | Dark |
|---|---|---|
| `--chart-1` (default single series) | `#3A5FBF` | `#7C9BEA` |
| `--chart-2` | `#6B7686` | `#8B94A3` |
| `--chart-3` | `#2E8B8B` | `#5DB8B8` |
| `--chart-grid` | `#E4E7EC` | `#232A34` |
| `--chart-axis-text` | `#5F6877` | `#8B94A3` |

Decision series in stacked charts reuse semantic colors (`--ok`, `--warn`, `--danger`) but at 70% label emphasis and always with a text legend; never rely on color alone (see section 4.5).

### 2.3 Non-color tokens

| Variable | Value |
|---|---|
| `--space-1..` | 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px (4px base; 8px layout rhythm, same ladder as Atlassian `space.050`..`space.800`) |
| `--radius-sm` | 4px (badges, inputs, buttons, chips) |
| `--radius-md` | 6px (cards, panels, tables, menus) |
| `--radius-lg` | 8px (dialogs only) |
| `--radius-full` | 9999px (status dots only) |
| `--border-w` | 1px |
| `--shadow-float` | `0 4px 12px rgba(16,24,40,0.12)` light; `0 4px 12px rgba(0,0,0,0.5)` dark. Menus, popovers, dialogs, toasts only. No other shadow exists. |
| `--sidebar-w` | 224px expanded; 48px collapsed |
| `--header-h` | 48px top bar; page header content area min 56px |
| `--content-max` | 1440px; page gutter 24px (16px under 640px) |
| `--dur-fast` | 100ms, `ease-out`. Only color/background/border transitions. Respect `prefers-reduced-motion`. |

## 3. Typography

Families: UI `Inter, system-ui, -apple-system, "Segoe UI", sans-serif` (self-host Inter via Google Fonts, weights 400/500/600); mono `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` (weights 400/500). Set `font-feature-settings: "tnum" 1, "cv11" 1` on tables, KPI values and any numeric column (`font-variant-numeric: tabular-nums`). Sentence case everywhere; no all-caps except 11px table column labels if desired (use sentence case by default). Line heights land on the 4px grid (Primer convention). Weights: use only 400, 500, 600. Do not use 700.

| Role | Size / line-height | Weight | Family | Notes |
|---|---|---|---|---|
| Page title (h1) | 20px / 28px | 600 | UI | Letter-spacing -0.01em |
| Section title (h2) | 15px / 24px | 600 | UI | Card and panel headings |
| Subsection (h3) | 13px / 20px | 600 | UI | |
| Body | 13px / 20px | 400 | UI | Default for all app text |
| Body large | 14px / 20px | 400 | UI | Dialog body, forms on mobile |
| Table cell | 13px / 20px | 400 | UI | Numerals tabular |
| Table column label | 12px / 16px | 500 | UI | `--text-2` |
| Meta / caption | 12px / 16px | 400 | UI | `--text-3` |
| KPI value | 28px / 32px | 600 | UI | tabular-nums, `--text` |
| KPI label | 12px / 16px | 500 | UI | `--text-2` |
| Badge | 12px / 16px | 500 | UI | |
| Code / hash / id | 12px / 20px | 400 | mono | Inline code has `--bg-subtle` fill, 2px 4px padding, radius-sm |
| Code block / diff | 12px / 20px | 400 | mono | |

Minimum text size anywhere: 12px. Measure for prose: 80 characters max.

## 4. Component rules

### 4.1 Layout and spacing
- 4px base grid, 8px rhythm for gaps between blocks. Card padding 16px (12px in dense mode). Gap between cards 16px. Page gutter 24px.
- Cards: `--bg-surface`, 1px `--border`, radius-md, no shadow, no inner gradient. Card header is a 48px row with h2 left and actions right, separated from body by a 1px border only when the body is a table.

### 4.2 Navigation (sidebar)
- Fixed left, 224px, `--bg-surface`, 1px right border. Collapsible to 48px (labels hidden, title attribute tooltips). Linear and Vercel both run a narrow, text-led sidebar; Stripe uses a top-level list with sub-items indented.
- Top: workspace/environment switcher (text only, 40px). Then groups: Overview, Runs, Effects, Systems, Audit. Optional group labels 12px `--text-3`.
- Item: 32px high, 8px horizontal padding, 13px/500 text `--text-2`, radius-sm, 2px gap. Hover: `--bg-subtle`. Active: `--bg-muted` fill, `--text` color, 600 weight not required; add a 2px `--accent` bar on the item's left edge. Do not use icons; text labels only. A numeric count (tabular, `--text-3`) may sit at the right edge, e.g. pending approvals.
- Bottom: user menu, theme toggle (Light / Dark / System), build id in mono 12px `--text-3`.
- Under 900px width the sidebar becomes an off-canvas drawer opened from a "Menu" text button in the top bar.

### 4.3 Page header
- Row 1: breadcrumb (12px `--text-3`, separator "/" , last crumb `--text-2`, not a link). Row 2: h1 left, primary action right. Row 3 (optional): meta line (status badge, run id mono, started time) and secondary tabs with 1px bottom border; active tab has 2px `--accent` underline.
- Primary action: exactly one filled button, right-aligned in the header row; secondary actions are outline buttons to its left. Filters live in a toolbar below the header, not in it.
- Header is not sticky except in run review where the decision bar is sticky (see 5.2).

### 4.4 Buttons, inputs, badges, focus
- Button height 32px (28px dense), padding 0 12px, radius-sm, 13px/500. Primary: `--accent-solid` fill, white text. Secondary: `--bg-surface`, 1px `--border-control`, `--text`. Danger: `--bg-surface`, 1px `--danger`, text `--danger`; filled danger only inside the destructive confirmation dialog. Disabled: 40% opacity text, no pointer events.
- Hover changes background one step (primary to `--accent-solid-hover`, secondary to `--bg-subtle`). Active: `--bg-muted`. 100ms.
- Inputs: 32px high, 1px `--border-control`, radius-sm, `--bg-surface`; placeholder `--text-3`. Error: border `--danger` plus message below in `--danger` 12px.
- Focus: every interactive element shows `outline: 2px solid var(--focus-ring); outline-offset: 2px` on `:focus-visible`. No removal of outlines, no glow or box-shadow rings.
- Badge: 20px high, padding 0 6px, radius-sm, 12px/500, 1px border in matching text color at low alpha is not allowed; use fill token + text token only. Contains a text label always; a 6px status dot (radius-full) may precede the label.

### 4.5 Status and decision conventions
Status is always dot (6px) + text; never color alone. Colors follow the convention used by GitHub Actions, Sentry and Stripe: green = success, amber = needs attention, red = failure/blocked, gray = neutral/pending/skipped, blue = info or in progress.

| Concept | Value | Token pair | Label |
|---|---|---|---|
| Decision | auto | neutral (`--bg-subtle` / `--text-2`) | Auto |
| Decision | needs approval | `--warn-bg` / `--warn` | Needs approval |
| Decision | blocked | `--danger-bg` / `--danger` | Blocked |
| Outcome | approved / executed | `--ok-bg` / `--ok` | Approved, Executed |
| Outcome | rejected | `--danger-bg` / `--danger` | Rejected |
| Run state | running | `--accent-bg` / `--accent` | Running |
| Run state | pending | neutral | Pending |
| Risk | low | neutral text, no fill | Low |
| Risk | medium | `--warn` text, no fill | Medium |
| Risk | high | `--danger` text, no fill | High |
| Risk | critical | `--danger-bg` / `--danger`, 600 weight | Critical |

Auto is deliberately neutral: routine allowed actions should not draw the eye. Amber and red are scarce and therefore scannable.

### 4.6 Tables
- Default row 32px, dense 24px, comfortable 40px (Carbon xs/sm/md). Header row same height as body rows, 12px/500 `--text-2`, `--bg-subtle` fill, 1px bottom border. Header is `position: sticky; top: 0` inside a scroll container with `max-height`.
- Row separators: 1px `--border` horizontal lines only. No zebra striping (hover highlight and borders suffice; Carbon treats zebra as optional, Stripe and Linear do not use it). No vertical lines except between a pinned column and the scrolling area.
- Hover: `--bg-subtle` on the full row, always on, even for non-clickable rows (Carbon). Selected: `--accent-bg` plus 2px left `--accent` bar. Row click opens detail; the first-column link carries the keyboard focus target.
- Alignment: text left, numbers and durations right-aligned with tabular numerals, status badges left, timestamps left in mono-free UI font with `--text-2`. Header alignment matches column content. Cell padding 0 12px; first column 0 12px 0 16px.
- Truncation: single line with ellipsis; `title` shows full value. Ids and hashes in mono, truncated as `abcd1234…ef90` (first 8, last 4) with a copy button on hover and focus (text "Copy").
- Footer: row count left ("1-50 of 1,284"), pager right ("Previous" / "Next" text buttons). Toolbar above: search (240px), filter selects, density switch, right-aligned export.
- Bulk selection: checkbox column 40px; selecting rows replaces the toolbar with a batch bar of the same height showing "N selected" and actions.

### 4.7 KPI / stat tile
- Anatomy top to bottom: label (12px/500 `--text-2`), value (28px/600 tabular), delta line (12px; "+4 vs prior 24h" with `--ok` or `--danger` only if direction has a meaning, otherwise `--text-3`), optional 32px-high sparkline in `--chart-1` below. Padding 16px, card style per 4.1. No icon, no background color, no gradient fill under the sparkline (Grafana offers gradient and background-color modes; do not use them).
- Tile row: CSS grid, 4 columns at 1280px+, 2 at 640px+, 1 below; equal heights; tiles may be separated as one joined strip with internal 1px dividers instead of 4 cards.
- Value units appended in `--text-3` 14px/400 ("ms", "%"). Large numbers use thousands separators, never abbreviations that hide precision below 10,000.

### 4.8 Charts
- Library: any (uPlot, visx, or hand-rolled SVG). Rules below are library-independent.
- Default single series in `--chart-1`. Multi-series only when the question needs it; maximum 4 series; categorical palette is `--chart-1..3` plus `--chart-axis-text` gray.
- Horizontal gridlines only, 1px `--chart-grid`, 4 to 5 lines; no vertical grid, no chart frame/border. Axis text 11px is not allowed; use 12px `--chart-axis-text`, tabular numerals, y labels left-aligned to the plot edge, x labels at most 6 ticks.
- Time series: 1.5px line, no markers except on hover (4px dot), optional area at 8% opacity flat fill (not a gradient). Bar charts: 2px top radius max, bar gap 40%, zero baseline always included.
- Direct labels over legends where possible (Carbon); otherwise a text legend above the plot, 12px, swatch 8x8 square. Tooltip: floating surface with `--shadow-float`, 12px, tabular, shows exact value, timestamp, series name. Crosshair is a 1px `--border-strong` vertical line.
- No 3D, no donut/pie for more than 2 parts (prefer a stacked horizontal bar with numeric labels), no animated entrance, no dual y-axes.
- Every chart has a title (h2 in card header), unit in the label, and a "View as table" toggle that swaps in a 24px-row table.

### 4.9 Empty, loading, toasts, errors
- Empty state: centered in the container, max-width 360px, h3 title stating what is absent ("No runs match these filters"), one line of `--text-2` explaining the cause, one button for the next action (e.g. "Clear filters"). No illustration, no icon.
- Loading: skeleton blocks in `--bg-subtle`, radius-sm, matching the final row/tile geometry, with a 1.4s opacity pulse between 100% and 60% (no shimmer gradient). Show skeleton only after 200ms delay; keep stale data visible during refetch with a 2px indeterminate progress bar under the header.
- Toast: bottom-right, 360px, `--bg-surface`, 1px `--border`, `--shadow-float`, radius-md, 13px text, 4px left bar in status color is permitted, auto-dismiss 5s (errors persist), "Undo" or "Dismiss" text action. Stack max 3. `role="status"` (errors `role="alert"`).
- Inline errors: bordered block with `--danger-bg` fill, `--danger` title, body in `--text`, with the request id in mono and a "Retry" button.
- Confirmation dialogs: 480px, radius-lg, `--shadow-float`, backdrop `rgba(0,0,0,0.4)` flat. Destructive dialogs name the object being affected and use a verb-labeled button ("Reject action"), never "OK".

### 4.10 Code, diff, hashes
- Mono 12px/20px, `--bg-subtle` block, 1px `--border`, radius-md, padding 12px, horizontal scroll rather than wrapping. Line numbers `--text-3` right-aligned in a 40px gutter, `user-select: none`.
- Diff: added lines `--ok-bg` background with `--text` text and a `+` in gutter; removed lines `--danger-bg` with `-`; no color-only meaning because the `+`/`-` glyphs carry it. Hunk header row in `--text-3` on `--bg-muted`. Word-level highlight uses one step stronger of the same tint (`rgba` of `--ok`/`--danger` at 20%).
- JSON payloads are pretty-printed, keys `--text`, strings `--text-2`, no rainbow syntax theme; only three token classes (key, string/number, punctuation).
- Hash display: full value in `title`; visible form `sha256:abcd1234…ef90`; copy button appears on hover/focus; copy confirmation as a transient inline "Copied" label, not a toast.

### 4.11 Micro-interactions
- Hover: background step change only (100ms). No translate, scale, or shadow lift.
- Keyboard: `j`/`k` move row focus in lists, `a` approve, `r` reject in run review (with visible hint in the decision bar), `/` focuses search, `?` opens shortcut list. Linear-style speed is the target.
- Focus management: opening a detail panel moves focus into it; closing returns focus to the originating row. Sorting indicators are a text arrow in the header only on the sorted column.
- Respect `prefers-reduced-motion`: disable the skeleton pulse and progress animation.

## 5. Screen layouts

### 5.1 Overview
- Page header: h1 "Overview"; right side holds a time-range select ("Last 24 hours" default) and a refresh text button. Environment label as a gray badge.
- Row 1: four KPI tiles: "Pending approvals" (number, oldest age in delta line), "Actions evaluated" (24h count with sparkline), "Auto-approval rate" (percent), "Blocked" (count; delta in `--danger` only if increased). Joined strip with internal dividers.
- Row 2: two cards, 2/3 and 1/3 width. Left: "Actions over time" stacked bar by decision (auto neutral gray `--chart-2`, needs approval `--warn`, blocked `--danger`), hourly buckets. Right: "Decision mix" as one horizontal stacked bar with three numeric rows beneath (count, share).
- Row 3: two cards, equal. Left: "Pending approvals" table of top 8 (action, agent, risk, age) with "View all" link in card header. Right: "Recent blocked actions" table (time, agent, tool, rule).
- Stacks to a single column below 900px.

### 5.2 Run review
- Page header: breadcrumb Runs / run id; h1 is the run's short title; meta line: state badge, agent name, started time, duration, run id in mono with copy. Right: secondary "Export packet", no primary action here (decisions are per action).
- Two-pane body at 1280px+: left pane 420px "Proposed actions" list; right pane fills with the selected action's detail. Below 1024px the detail becomes a pushed view with a "Back to list" text button.
- Left pane: header with count and filter select (All, Needs approval, Blocked, Auto). Each list item is a 56px two-line row: line 1 tool.method in 13px/500 and the decision badge right-aligned; line 2 a 12px `--text-2` summary of the target with the risk word ("High risk") at the right in its risk color. Selected item: `--accent-bg` plus 2px left accent bar. Items sorted: needs approval first, then blocked, then auto, each by sequence number.
- Right pane sections stacked, separated by 1px borders: (1) Summary: key/value grid (tool, target system, risk with reason text, policy rule that fired, requested at); (2) Proposed effect: diff block or JSON payload per 4.10; (3) Agent rationale: plain text quote block with `--text-2`, left 2px `--border-strong` bar; (4) Decision history: compact table (time, actor, decision, note).
- Sticky decision bar at the bottom of the right pane (56px, `--bg-surface`, top border): left shows "Decision: Needs approval"; right shows "Reject" (secondary) and "Approve" (primary), plus a one-line note input. Blocked actions show a disabled bar with the blocking rule text and no approve button. Approve/Reject require the note when risk is High or Critical. After a decision, focus advances to the next item needing approval and a toast confirms with "Undo" for 5s.

### 5.3 Runs and effects tables
- Two tabs under the page header: "Runs" and "Effects" (also reachable from sidebar). Toolbar: search, filters (state, agent, decision, risk, time range) as select chips that show "Risk: High" when active with a text "Clear" button, density switch.
- Runs columns: Run id (mono, truncated, link), Title, Agent, State (badge), Actions (right, tabular), Needs approval (right), Blocked (right), Started (relative with exact on hover), Duration (right). Default sort Started descending.
- Effects columns: Effect id, Run (link), Tool, Target system, Operation, Decision, Outcome (badge), Risk, Executed at. Row click opens a right-side 480px detail panel (not a new page) with payload and result using 4.10.
- Sticky header, pager in footer, 50 rows per page; no infinite scroll.

### 5.4 Systems viewer (sandbox)
- Header: h1 "Systems", description line "Sandbox state the agents operate on. Read-only." in `--text-2`; right: "Reset sandbox" danger secondary button with confirmation dialog.
- Layout: left 280px list of systems (e.g. email, tickets, files, database), one row per system with name and record count right-aligned. Selected shows `--accent-bg`.
- Right: tabs per system view: "Records" (table per 4.6 with sticky header and JSON expand in a detail panel) and "Changes" (chronological list of effects applied to this system, each a row with timestamp, run link, operation, and a diff block collapsed by default, expand with a "Show diff" text toggle).
- A "Last changed" meta line and a "Snapshot" hash (mono, truncated) at the top of the right pane.

### 5.5 Audit-packet verifier
- Header: h1 "Verify audit packet". Single column, 720px max-width, plus a results area.
- Input card: drop area as a 1px dashed `--border-control` box, radius-md, 120px high, text "Drop a packet file here or choose a file" with a "Choose file" secondary button; alternative paste textarea (mono 12px, 8 rows) under a "Paste JSON" tab. Primary button "Verify".
- Result card: top line is a single status badge ("Verified" `--ok`, "Failed" `--danger"). Then a checks table, 32px rows: Check (e.g. "Schema valid", "Hash chain intact", "Signature valid", "Event count matches"), Result (badge), Detail (mono expected vs actual hashes, truncated, copy on hover). Failures expand to show the first mismatching entry index and a diff of expected vs actual. Below: packet metadata key/value grid (run id, issued at, entries, root hash).
- Result is announced via `aria-live="polite"`. Verification runs show skeleton rows while pending.

## 6. Do not

- No gradients (backgrounds, buttons, charts, skeletons, text, borders), no glow, no blurs, no glassmorphism, no colored shadows.
- No box-shadow on cards, tables, tiles or sidebar. Shadow is for floating layers only.
- No decorative icons, no icon-in-colored-circle tiles, no illustrations, no emoji, no mascots. Text labels carry meaning.
- No marketing copy, taglines, exclamation marks, or "Welcome back" greetings. Labels are nouns and verbs; empty states state facts.
- No radius above 8px, no pill buttons (pills only for status dots), no more than one border radius per element.
- No more than one accent color; no purple/teal brand fills; no colored page backgrounds; no colored table headers.
- No zebra stripes, no vertical grid lines in tables, no full-width colored row fills for status (use badge and, at most, a 2px left bar).
- No color-only meaning; always pair with text or glyph. No red/green-only distinction in charts.
- No text below 12px, no weight 700, no centered body text in tables, no all-caps headings, no letter-spaced uppercase labels.
- No donut/pie/3D charts, no chart animation on load, no dual axes, no vertical gridlines, no more than 4 chart series.
- No animations other than 100ms state transitions and the skeleton pulse; no hover lift or scale.
- No modal for non-destructive tasks (use a side panel); no toasts for errors that require action (use inline error blocks).
- No `outline: none` without a visible replacement; no focus glow.

## 7. Sources

Consulted directly in this pass (fetched):
- GitHub Primer, Typography: https://primer.style/foundations/typography (rem tokens, unitless line heights on a 4px grid, weight variables, no color as primary emphasis, left-aligned text, 80-char measure)
- IBM Carbon, Data table usage: https://carbondesignsystem.com/components/data-table/usage/ (row heights 24/32/40/48/64px, header matches row height, row hover always on, zebra optional)
- IBM Carbon, Chart anatomy: https://carbondesignsystem.com/data-visualization/chart-anatomy/ (restrained graph frame, direct labels over legends)
- Radix Colors, Understanding the scale: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale (steps 1-2 backgrounds, 3-5 component states, 6-8 borders, 9-10 solid, 11-12 text; used to structure the surface/border/text token ladder)
- Atlassian Design System, Spacing: https://atlassian.design/foundations/spacing (8px base, 4px half step, token ladder)
- Linear, How we redesigned the Linear UI: https://linear.app/now/how-we-redesigned-the-linear-ui (limited chrome color, neutral themes, Inter, denser navigation, contrast as a variable)
- Vercel Geist, Colors: https://vercel.com/geist/colors (100-300 backgrounds, 400-600 borders, 700-800 high-contrast, 900-1000 text; solid gray borders; avoid overlapping alpha borders)
- Grafana, Stat panel: https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/stat/ (value/title/sparkline/percent-change anatomy; sparkline auto-hides when small; gradient modes deliberately not adopted)
- Stripe Apps, Design: https://docs.stripe.com/stripe-apps/design (limited custom styling for consistency and contrast; header with view name and top-level actions; list, details and home surfaces)

Not independently fetched in this pass (conventions below are from general familiarity with the products and should be treated as design inspiration, not verified citations): Datadog, Retool, PostHog, Sentry, GitHub Actions UI, Shopify Polaris (the Polaris typography URL now redirects to https://shopify.dev/docs/api/polaris), and the exact Stripe Dashboard type and spacing values. The hex values in section 2 are original to this spec; their contrast ratios were computed with the WCAG 2.x relative-luminance formula and all text pairs meet at least 4.5:1, control borders at least 3:1.
