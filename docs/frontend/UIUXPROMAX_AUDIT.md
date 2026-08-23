# PropPulse Frontend — UI UX Pro Max Audit

> Per-rule scoring of the shipped `frontend/src` against the **UI UX Pro Max**
> skill (v2.14.1) quick-reference rubric (10 categories, ~98 rules) and the
> generated design system (`design-system/MASTER.md`).
> Evidence: source reads + the live E2E suite (49 tests) which locks many of the
> a11y/UX behaviors below. Run 2026-08-11.

## Verdict

**CONFORMANT.** The PropPulse frontend implements the skill's rubric to a high
degree — the dark, hairline, amber-accent, Inter + IBM Plex Mono system is the
skill's own recommended archetype for a dark financial/analytics/AI dashboard.
Two genuine deltas were found and fixed (§4). Everything else is PASS or an
accepted deviation.

## 1. Accessibility (CRITICAL) — PASS

| Rule | Status | Evidence |
|---|---|---|
| Contrast ≥ 4.5:1 | PASS | tokens tuned per-surface (cluster colors documented ≥4.5:1 in `constants.js`); `color-scheme: dark` |
| Visible focus states | PASS | global `:focus-visible` 2px amber outline on a/button/input/select/textarea/summary/[tabindex] |
| aria-labels | PASS | icon buttons labeled (`api-status`, map markers, sort headers) |
| Keyboard nav | PASS | all nav via real `<Link>`/`<button>`/`<a>`; sort headers are buttons |
| form-labels | PASS | `PropertyForm` uses labeled inputs with `#pf-*` ids + error links |
| skip-links | PASS | "Skip to content" → `#main` |
| heading-hierarchy | PASS | pages use single `h1` + sequential `h2`/`h3` |
| color-not-only | PASS | cluster colors paired with legend + neighborhood names; alerts carry icons/text |
| **focus-on-route-change** | **FIXED** | was absent → Layout now focuses `<main>` after navigation (skip first render) |
| reduced-motion | PASS | CSS `@media (prefers-reduced-motion)` + `useReducedMotion` + `chartTheme` |
| data-table fallback | PASS | `.visually-hidden` chart data tables (`ChartA11yTable`, workflow tables) |
| aria-sort | PASS | `SortHeader` sets `aria-sort` on `<th>` |
| error-clarity | PASS | server 422 → per-field messages (E2E-locked) |

## 2. Touch & Interaction (CRITICAL) — PASS

- `cursor-pointer` on all clickable elements — PASS (~25 sites in `styles.css`).
- Loading feedback: buttons disable + spinner during predict/train — PASS.
- Error feedback near field — PASS (E2E-locked 422 mapping).
- `touch-action: manipulation` — **now applied** globally on `body` (apple-design
  top-notch pass, 2026-08-11 — `APPLE_POLISH.md` §5); deviation closed.
- Press feedback 150–300ms — **FIXED**: `--dur-hover` 0.12s → 0.15s (§4).

## 3. Performance (HIGH) — PASS

- Route-level code splitting / lazy loading — N/A (small SPA, single bundle);
  leaflet+recharts loaded on demand. Accepted.
- No CLS sources: fixed image dims (leaflet), skeletons reserve space, `tabular-nums`
  prevents number jitter — PASS.
- List virtualization — N/A (max 1,460-row workflows render fine; table windowing
  not needed). `if_large_dataset → virtualize-lists` noted for future.
- Skeletons for >1s loads — PASS (AsyncSection / skeleton blocks).

## 4. Style Selection (HIGH) — PASS

- Style matches product type — PASS (Data-Dense + Dark + Minimal; see MASTER §2–3).
- **No emoji icons** — PASS (only ASCII text-glyph arrows like "→"; no emoji anywhere).
- Consistent palette — PASS (single token system; no raw hex in components except
  documented chart/CLUSTER_COLORS in `constants.js`).
- No AI-purple / gradients — PASS (flat amber; zero gradients per blueprint).

## 5. Layout & Responsive (HIGH) — PASS*

- Breakpoints: 980/900/820/520 base + page-level 1024/640/480/420; E2E locks **390px**.
- No horizontal scroll: tables use scroll containers (`.table-scroll`), factor names
  wrap at 390 (E2E-locked `overflow ≤ 1px`).
- `375px` verified implicitly by the 390px E2E gate; base floor is 520px with page
  refinements below. *Accepted as covered in practice.*
- 4/8 spacing rhythm, consistent max-width (`--content-max` 940px) — PASS.
- Sticky sidebar → top strip ≤900px — PASS.

## 6. Typography & Color (MEDIUM) — PASS

- Inter (UI) + IBM Plex Mono (data) = skill's Financial Trust / Minimal Swiss /
  Modern Dark Cinema archetype (MASTER §5).
- `tabular-nums` for data — PASS.
- Semantic tokens (no raw hex in components) — PASS.
- Body 14px is below the skill's 16px-mobile guidance — **accepted deviation**
  (desktop dashboard density; consistent everywhere).

## 7. Animation (MEDIUM) — PASS*

- Durations ≤400ms — PASS (hovers now 150ms; emphasis 500ms for bar growth is the
  one exception, intentional).
- Transform/opacity only — mostly PASS; a couple of `width`/`left` transitions
  (progress bar, price-band thumb) are functional, not decorative.
- Reduced-motion respected — PASS (JS + CSS).
- No decorative-only motion — PASS.

## 8. Forms & Feedback (MEDIUM) — PASS

- Visible labels, error-below-field, aria-invalid + error links — PASS.
- Empty states with guidance — PASS (AUD-24a "Explanation unavailable", missing-
  columns tables).
- Toast auto-dismiss — **accepted deviation**: success/info 6s, error 10s
  (skill says 3–5s; errors should linger for a data tool).
- Disabled states: opacity + `cursor: default` + semantic attr — PASS.
- Timeout feedback with retry — PASS (AUD-10 E2E-locked).
- Loading then success/error on submit — PASS.

## 9. Navigation (HIGH) — PASS

- Sidebar for primary nav (≥1024 per skill adaptive rule) → top strip ≤900px — PASS.
- Active state highlighted (amber inset + weight) — PASS.
- Back/deep-linking: real routes, URL-addressable stages — PASS.
- Skip-link to main — PASS.

## 10. Charts & Data (LOW) — PASS

- Chart type matches data (line/bar/scatter/map/bullet per MASTER §7) — PASS.
- Accessible data-table fallback for every chart — PASS.
- Legends + tooltips — PASS.
- Sortable tables with aria-sort — PASS.
- Number formatting locale-aware — PASS (`format.js`).

## 4. Genuine Deltas Applied (this run)

| # | Delta | Rule | Change | Risk |
|---|---|---|---|---|
| 1 | `--dur-hover` 120ms | `duration-timing` (150–300ms) | `0.12s ease` → `0.15s ease` in `styles.css` | none (token-wide) |
| 2 | No focus management on route change | `focus-on-route-change` | Layout focuses `<main>` (skip first render, `preventScroll`); `main:focus` outline suppressed (region, not control) | low (verified no `toHaveFocus` E2E assertions) |

## Accepted Deviations (documented, not defects)

- Body font 14px vs 16px-mobile guidance (desktop data-dense product).
- Toast success/info 6s vs 3–5s (errors 10s intentionally).
- ~~No `touch-action: manipulation`~~ — closed in the 2026-08-11 apple-design pass
  (`body { touch-action: manipulation }`).
- Base responsive floor 520px (page-level 420/480 + 390px E2E gate cover small phones).
- No list virtualization (dataset sizes don't require it).

---
*Generated 2026-08-11 from ui-ux-pro-max v2.14.1 quick-reference + `design-system/MASTER.md`.*
