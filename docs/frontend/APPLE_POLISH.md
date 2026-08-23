# PropPulse Frontend — Apple-Design Polish

> Applied 2026-08-11 from the **apple-design** skill principles
> (`~/.claude/skills/apple-design/SKILL.md`): type-first, restraint,
> silky ease-in-out motion, soft shadows, "less but better".
>
> Scope: **CSS-only.** No DOM, no content, no behaviour change — text-identity
> E2E assertions (toHaveText/toContainText) are unaffected. Full regression:
> build ✓, lint ✓, E2E — see §4.

## Verdict

**Applied as a deliberate overlay on the existing dark, amber-accent, hairline
system.** Apple's language is light-mode-first (SF stack, `#000`/`#fff`,
monochrome, Apple Blue `#0066cc` links); wholesale adoption would have clashed
with the PropPulse dark-financial archetype (see `design-system/MASTER.md` §2–§5)
and re-litigated a closed decision. The polish below takes the *principles* that
transfer cleanly to a dark data product: type-first emphasis, softer elevation,
and Apple's system motion curve.

## 1. Deltas Applied (4, all CSS tokens/rules)

| # | Change | File | apple-design principle |
|---|---|---|---|
| 1 | `--shadow-pop` `0 8px 24px rgba(0,0,0,0.55)` → `0 8px 32px rgba(0,0,0,0.45)` | `styles.css` | Soft, diffuse elevation — larger blur, lower alpha |
| 2 | `--dur-emphasis` `cubic-bezier(0.2,0.7,0.2,1)` → `cubic-bezier(0.32,0.72,0,1)` | `styles.css` | iOS system curve — quick in, soft long out ("silky ease-in-out") |
| 3 | `.metric-value` font-weight `500` → `600` | `styles.css` | Type-first: data figures carry semibold emphasis |
| 4 | `.result-verdict.result-price` `30px/600/-0.02em` → `38px/700/-0.03em` | `styles/valuation.css` | Type-first: the estimate is the page's one big number |

## 2. Why these four (and not the rest)

- **Type-first weight/size** — Apple's most transferable principle to a dense
  dashboard: one dominant number per view, heavy + tight-tracked. Applied to the
  two highest-value figures: the valuation estimate and the KPI/metric cards.
- **Soft shadow** — the single `--shadow-pop` elevation is the app's only shadow
  (blueprint/audit hygiene); softening it keeps the floating-layer hierarchy
  without the old hard drop.
- **System motion** — Apple's emphasis curve is asymmetric (fast in, long soft
  out), which reads calmer than the previous symmetric ease on the 500ms
  bar-growth animation. `prefers-reduced-motion` still fully respected.

## 3. Deliberately NOT applied (documented deviations)

- **SF / SF Mono font stack** — not licensed for web; Inter + IBM Plex Mono are
  the shipped data/technical pairing (MASTER.md §6).
- **White / near-white monochrome + Apple Blue links** — the dark `#0F1110` +
  amber `#D9A63F` system is the validated financial-analytics instantiation
  (MASTER.md §5); introducing white panels or blue links would break the
  dark-amber identity and the "no AI-purple / no gradients" anti-pattern rules.
- **Squircle / rounded-3xl cards** — PropPulse is a hairline data tool, not a
  consumer surface; its 4–8px radii are the product-correct choice.
- **Hero marketing language** ("Touching and simple", big centric CTAs) —
  n/a for a workbench dashboard.

## 4. Verification

- `npm run build` — ✓ (15.8s, no CSS/Lint breakage)
- `npm run lint` — ✓ (eslint clean)
- Playwright E2E full suite — ✓ **49/49 passed (5.7m)** via
  `cd e2e && npx playwright test`. Includes the workflow comparison trace-truth
  fix (`workflow.spec.js` test 07 — asserts the "best" chip on the server-flagged
  row instead of assuming a clean sandbox).
- §5 top-notch pass re-verified (2026-08-11): build ✓ · lint ✓ · **E2E 49/49 ✓**
  (the gating-test 404 flake from the prior run is confirmed transient — see
  §5 notes).

## 5. Top-Notch Pass (2026-08-11 — UI UX Pro Max × apple-design)

A second, cross-skill pass. Every delta stays inside the validated dark-amber
hairline system (`design-system/MASTER.md` §5) and the UI UX Pro Max rubric
(`UIUXPROMAX_AUDIT.md`); all changes are **CSS-only and text-identity safe**
(no `toHaveText`/`toContainText` target is touched).

| # | Delta | File | Source |
|---|---|---|---|
| 5 | `--dur-hover` curve `ease` → apple curve `cubic-bezier(0.32, 0.72, 0, 1)` (duration stays 150ms) | `styles.css` | apple motion · UIUX `duration-timing` |
| 6 | `.page-head h1` / `.page-title` `27px/600/-0.02em` → **`30px/700/-0.03em`** | `styles.css` | apple type-first |
| 7 | `.btn` weight `500`→`600`, tracking `-0.005em`→`-0.01em`; `transform` joins the hover transition | `styles.css` | apple type-first |
| 8 | `.btn:active` physical press `translateY(1px)` (+ `transform: none` under `prefers-reduced-motion`) | `styles.css` | apple motion |
| 9 | `.table tbody tr` hover transition `0.1s ease` → `var(--dur-hover)` (one motion token) | `styles.css` | token consistency · UIUX `duration-timing` |
| 10 | `.step-label` tracking `-0.005em`→`-0.01em` (tighter sidebar labels) | `styles.css` | apple type-first |
| 11 | `body { touch-action: manipulation }` — closes the audit's last open touch deviation | `styles.css` | UIUX quick-reference touch rule |

**Why these and nothing else:** the audit (§1–§3) already cleared the skill
rubric; this pass closes the remaining craft gaps — display hierarchy vs the
14px body, physical press feedback, one shared motion curve, and the single
accepted touch deviation. Chart internals (Recharts SVG) were left untouched:
styling them is version-fragile and nothing there failed the rubric.

**Flake note (resolved):** The 2026-08-11 full-suite run recorded a gating-test
404 flake (`expectClean` failing with4× `"Failed to load resource: 404"` during
locked-stage navigations on a fresh upload). Reproduction on a cold browser
context produced zero404s; a subsequent full suite run confirmed **49/49 passed
(5.7m)**. The flake is transient (timing/state-dependent, triggered only during
the full serial suite when the backend is freshly respawned by `beforeAll`), and
is unrelated to the CSS changes in §5.

---
*Generated 2026-08-11. Principles: apple-design skill + UI UX Pro Max v2.14.1.
Prior audit: `UIUXPROMAX_AUDIT.md`.*
