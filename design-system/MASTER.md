# PropPulse — Design System (Master)

> Generated 2026-08-11 by the **UI UX Pro Max** skill (v2.14.1) reasoning engine
> (`~/.claude/skills/ui-ux-pro-max/scripts/search.py`) for the product query
> `"proptech real estate housing ml analytics dashboard professional data"`,
> project `PropPulse`. This file is the Global Source of Truth; page overrides
> live in `pages/`.
>
> **Reconciliation verdict: the engine recommends a light "trust teal + blue"
> system; the shipped PropPulse frontend is a dark, amber-accent system. Both
> are legitimate — the engine's output is the Real-Estate-domain palette and the
> Financial/Analytics dashboard rules independently validate the dark-gold
> system PropPulse ships (§6). This doc records the engine output verbatim and
> the adoption decision.**

---

## 1. Canonical Engine Output (verbatim)

The skill's BM25 reasoning engine returned:

```
PATTERN: Real-Time / Operations Landing
   Conversion: For ops/security/iot products. Demo or sandbox link. Trust signals.
   CTA: Primary CTA in nav + After metrics
   Sections: Hero (product + live preview or status), Key metrics/indicators,
             How it works, CTA (Start trial / Contact)

STYLE: Real-Time Monitoring
   Mode Support: Light ✓ Full  Dark ✓ Full
   Keywords: Live data updates, status indicators, alert notifications,
             streaming data visualization, active monitoring, streaming charts
   Best For: System monitoring dashboards, DevOps dashboards, real-time
             analytics, stock market dashboards, live event tracking
   Performance: Good (real-time load) | Accessibility: WCAG AA

COLORS (Trust teal + professional blue):
   Primary #0F766E · On Primary #FFFFFF · Secondary #14B8A6 · Accent/CTA #0369A1
   Background #F0FDFA (light) · Foreground #134E4A · Muted #E8F0F3
   Border #99F6E4 · Destructive #DC2626 · Ring #0F766E

TYPOGRAPHY: Fira Code / Fira Sans
   Mood: dashboard, data, analytics, code, technical, precise
   Best For: Dashboards, analytics, data visualization, admin panels
   Google Fonts: css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700

KEY EFFECTS: Real-time chart animations · alert pulse/glow · status indicator
   blink animation · smooth data stream updates · loading effect

AVOID (anti-patterns): Poor photos + No virtual tours

PRE-DELIVERY CHECKLIST: no-emoji-icons · cursor-pointer · hover 150-300ms ·
   contrast 4.5:1 · focus states · prefers-reduced-motion · 375/768/1024/1440
```

Why this came back: the query's "monitoring/analytics/data" tokens matched the
**Real-Time Monitoring** style, and the domain tokens resolved to the
**Real-Estate/Property (colors.csv #36)** palette — trust teal `#0F766E` +
professional blue `#0369A1`. The engine always emits a landing pattern; the
dashboard context is covered by its "Status/Key metrics" sections.

## 2. Product-Type Reasoning (why PropPulse is a hybrid)

PropPulse is a **B2B PropTech ML analytics dashboard**, not a consumer listings
site and not a pure ops monitor. The reasoning rules it inherits:

| Source (ui-reasoning.csv) | Role | What it contributes |
|---|---|---|
| **Real Estate/Property (#36)** | domain | Map integration (must-have), trust-teal + **gold** direction, professional-confident tone — the canonical palette above |
| **Analytics Dashboard (#7)** | primary UX | Data-Dense + Drill-Down, hover tooltips, chart zoom, filtering (must-have) |
| **Financial Dashboard (#6)** | secondary UX | **Dark Mode (OLED) + Data-Dense**, dark bg + red/green alerts, high-contrast (must-have); anti-pattern *light mode default* |
| **Banking / Traditional Finance (#42)** | trust | Minimalism + Accessible & Ethical, navy + **gold**, security-first |
| **Fintech/Crypto (#14)** | adjacent | `if_dashboard → use-dark-mode`; smooth transitions |

## 3. Pattern (adopted)

**Data-Dense + Drill-Down** (Analytics #7) over **Data-Dense Dashboard**
(Financial #6), with the engine's **status/metrics-first** signal (Real-Time #):
KPI cards on top, space-efficient grid, charts with hover tooltips/zoom,
filtering, drill-down map → neighborhood → comps, alert pulse on high-signal
changes. Landing pattern N/A (dashboard product).

## 4. Style (adopted: **Dark Mode + Data-Dense + Minimal**)

The engine's Real-Time Monitoring style is compatible with dark mode
("Dark ✓ Full"). PropPulse ships the **dark** instantiation, which the
Financial #6 rule mandates for financial analytics and Fintech #14's
`use-dark-mode` supports. Flat/hairline, no gradients, single elevation shadow
for floating layers.

**Anti-patterns avoided (all HIGH):** light mode default (Financial #6),
ornate design (Analytics #7), playful design + AI purple/pink gradients
(Fintech #14 / Banking #42), poor photos/no virtual tours (Real Estate #36 —
n/a for analytics; map integration present).

## 5. Colors — engine vs shipped, reconciled

| Token | Engine (canonical) | Shipped (PropPulse) | Reconciliation |
|---|---|---|---|
| Background | `#F0FDFA` (light) | `#0F1110` (dark) | **Dark adopted.** Financial #6 requires dark for financial analytics; Fintech #14 `use-dark-mode`; anti-pattern = light default. Engine's light bg is the "consumer listings" instantiation. |
| Primary | `#0F766E` trust teal | `#151816` surface | Teal is the Real-Estate domain voice; PropPulse is a data tool, not a listings brand — surface-led instead. Noted as alternate brand direction. |
| Accent | `#0369A1` blue | **`#D9A63F` gold-amber** | **Gold adopted.** Gold is the one accent both camps share: colors.csv Real Estate/Property "Trust Blue + Gold", Banking #42 "premium gold #A16207", Fintech #14 "Gold trust #F59E0B", Analytics #7 accent `#D97706` amber. PropPulse's amber is a valid member of that family and is AA-visible on dark. |
| Success | `—` | `#63A87D` | green family (Financial #6 `#22C55E`) ✓ |
| Danger | `#DC2626` | `#C65D55` | red family (Financial #6 `#EF4444`) ✓ |
| Muted text | `#E8F0F3` | `#9BA29A` | slate family ✓ |
| Border | `#99F6E4` | `#252A26` | hairline role ✓ |

**Decision:** keep dark `#0F1110` + amber `#D9A63F`. The engine's teal/blue is
the documented "light/consumer" alternative. No palette change applied.

## 6. Typography — engine vs shipped

| Engine (canonical) | Shipped (PropPulse) | Reconciliation |
|---|---|---|
| **Fira Code / Fira Sans** ("Dashboard Data" pairing) | **Inter / IBM Plex Mono** | Both are legitimate "data/technical/precise" archetype pairings. PropPulse's Inter = skill's *Minimal Swiss* (dashboards/enterprise) and *Modern Dark Cinema* (dark AI/fintech dashboards); IBM Plex Mono = *Financial Trust* ("excellent for data"). **Keep Inter + IBM Plex Mono** for consistency with the dark-financial archetype; no change. |

## 7. Key Effects (adopted where already present)

| Effect | Engine | Shipped |
|---|---|---|
| Real-time chart animations | ✓ | chart updates animate (Recharts default) |
| Alert pulse/glow | ✓ | `--dur-pulse` on degraded/alert states |
| Status indicator blink | ✓ | health pill + api-status states |
| Smooth data-stream updates | ✓ | metric updates |
| Loading effect | ✓ | skeletons + spinners |

## 8. Anti-Patterns (all PASS)

| Anti-pattern | Source | PropPulse |
|---|---|---|
| Light mode default | Financial #6 | **PASS** — dark-primary |
| Ornate design | Analytics #7 | **PASS** — hairlines, no ornament |
| No filtering | Analytics #7 | **PASS** — neighborhood/model/advanced filters |
| Playful design | Fintech #14 / Banking #42 | **PASS** — sober, product-grade |
| AI purple/pink gradients | Fintech #14 / Banking #42 | **PASS** — flat amber, no purple/gradients |
| Poor photos / no virtual tours | Real Estate #36 | **n/a** — analytics product; map integration ✓ |

## 9. Genuine Deltas Applied (this run)

1. **`--dur-hover` 120ms → 150ms** — checklist "Hover states with smooth
   transitions (150-300ms)" + `duration-timing` rule. `styles.css` token bump.
2. **Focus-on-route-change** — `focus-on-route-change` rule: Layout now focuses
   `<main>` after navigation (skip first render, `preventScroll`); region ring
   suppressed via `.app-body main:focus { outline: none }`.

Both regression-verified (build ✓, lint ✓, E2E 49/49 — see
`docs/frontend/UIUXPROMAX_AUDIT.md`).

## 10. Pre-Delivery Checklist

- [x] No emojis as icons
- [x] cursor-pointer on clickable elements
- [x] Hover states with smooth transitions 150-300ms (**now 150ms**)
- [x] Light mode text contrast ≥ 4.5:1 (dark is primary; contrast tuned per-surface)
- [x] Focus states visible for keyboard nav
- [x] prefers-reduced-motion respected (CSS + JS)
- [x] Responsive — real scale max-width 1024/900/820/640/520/420 (verified
      against the stylesheets, W2-B audit); 390px E2E-gated, no h-overflow.
      - 1024 — workbench multi-col grids stack (sample/candidates/step fields)
      - 900 — app shell collapses: sidebar → top bar, stepper → scroll strip;
        grid-2 / market map / preprocess samples stack; map canvas 460→380
      - 820 — page grids single-column (chart/predict/field/eval/cluster);
        metrics 2-up; sticky result panels de-stick; map canvas →320
      - 640 — label-column layouts wrap: monitor rows, validation checks,
        factor bars re-narrow, dataset chip truncates, train flow vertical
      - 520 — phone tier: gutters 24→18, trends chart 200px, card heads wrap,
        full-width buttons, card padding tightens
      - 420 — train phone gutters: cluster grid 1 col, config buttons full-width
      Plus min-width 1440 (wider content measure) and measured exceptions off
      the main scale: 980 (features-table Notes column hides), 480 (train
      tab-strip scroll fade — 432px tabs vs 358px scrollport at 390px), 400
      (tight-screen floor).

---
*Engine: ui-ux-pro-max v2.14.1. Reconciliation and adoption decisions in §2–§6.
Per-rule scoring: `docs/frontend/UIUXPROMAX_AUDIT.md`.*
