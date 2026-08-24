/**
 * Workflow-scope inline SVG icons (design contract: inline SVG only,
 * currentColor, 1.4–1.5 stroke, round caps, 12–20px, aria-hidden). Shared by
 * the shell (stage-progress rail, locked state) and the bridge stages
 * (find-cards, CTA arrows) so every glyph in the workbench chrome comes from
 * one consistent set — no icon library, no emoji.
 *
 * Every icon is decorative: the accessible name always comes from the
 * surrounding text (link label, card title), so each svg is aria-hidden and
 * unfocusable.
 */

function Svg({ size = 14, className = '', children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className || undefined}
    >
      {children}
    </svg>
  )
}

/** Stage-progress "completed" tick. */
export function IconCheck(props) {
  return (
    <Svg {...props}>
      <path d="M2.75 7.5l2.75 2.75 5.75-6.5" />
    </Svg>
  )
}

/** Stage-progress "locked" + the locked-stage tile. */
export function IconLock(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="6.25" width="8" height="5.5" rx="1.2" />
      <path d="M5 6.25V4.75a2 2 0 014 0v1.5" />
      <path d="M7 8.5v1.25" />
    </Svg>
  )
}

/** Bridge-CTA directional affordance (inside .wf-bridge-cta). */
export function IconArrowRight(props) {
  return (
    <Svg {...props}>
      <path d="M2.5 7h9M8.25 3.5L11.75 7l-3.5 3.5" />
    </Svg>
  )
}

/* --- Bridge find-card glyphs (stages 10–12) ------------------------------ */

/** Map pin — micro-market map. */
export function IconMapPin(props) {
  return (
    <Svg {...props}>
      <path d="M7 1.75a3.25 3.25 0 00-3.25 3.25c0 2.6 3.25 7.25 3.25 7.25s3.25-4.65 3.25-7.25A3.25 3.25 0 007 1.75z" />
      <circle cx="7" cy="5" r="1.1" />
    </Svg>
  )
}

/** Scatter of points — micro-market segmentation. */
export function IconSegments(props) {
  return (
    <Svg {...props}>
      <circle cx="4" cy="4.25" r="1.6" />
      <circle cx="10" cy="5" r="1.6" />
      <circle cx="6.5" cy="10" r="1.6" />
    </Svg>
  )
}

/** Trend line — half-year trends. */
export function IconTrend(props) {
  return (
    <Svg {...props}>
      <path d="M2 11.5l3.25-4 2.5 2.5L12 4.5" />
    </Svg>
  )
}

/** Table — sortable directory. */
export function IconTable(props) {
  return (
    <Svg {...props}>
      <rect x="2" y="2.5" width="10" height="9" rx="1.2" />
      <path d="M2 5.75h10M7 5.75v5.75" />
    </Svg>
  )
}

/** Shield-check — service liveness. */
export function IconShield(props) {
  return (
    <Svg {...props}>
      <path d="M7 1.75l4.5 1.6v3.4c0 2.9-1.9 4.8-4.5 5.75-2.6-.95-4.5-2.85-4.5-5.75v-3.4z" />
      <path d="M5.1 7.1l1.35 1.35 2.45-2.7" />
    </Svg>
  )
}

/** Heartbeat — live traffic counters. */
export function IconPulse(props) {
  return (
    <Svg {...props}>
      <path d="M1.75 7h2.4l1.4-3.25 2.6 6.5 1.4-3.25h2.7" />
    </Svg>
  )
}

/** Diverging arrows — feature distribution drift. */
export function IconDrift(props) {
  return (
    <Svg {...props}>
      <path d="M5 3.75L2.25 7 5 10.25M9 3.75L11.75 7 9 10.25" />
    </Svg>
  )
}

/** Wave — prediction-stream drift. */
export function IconWave(props) {
  return (
    <Svg {...props}>
      <path d="M1.75 7.25c1.4-2.6 2.9-2.6 4.4 0s3.1 2.6 4.6 0" />
    </Svg>
  )
}

/** Trophy — the champion models. */
export function IconTrophy(props) {
  return (
    <Svg {...props}>
      <path d="M4.25 2.25h5.5v3a2.75 2.75 0 01-5.5 0v-3z" />
      <path d="M4.25 3.25H2.5a1.75 1.75 0 001.75 1.85M9.75 3.25h1.75a1.75 1.75 0 01-1.75 1.85" />
      <path d="M7 8v2M5 12.25h4M5.9 10h2.2" />
    </Svg>
  )
}

/** Gauge — performance & uncertainty. */
export function IconGauge(props) {
  return (
    <Svg {...props}>
      <path d="M2.25 10.75a4.75 4.75 0 019.5 0" />
      <path d="M7 10.75l2.5-3.75" />
    </Svg>
  )
}

/** Bars — global SHAP drivers. */
export function IconBars(props) {
  return (
    <Svg {...props}>
      <path d="M2.75 11.75V8.25M7 11.75V4.25M11.25 11.75V6.25" />
    </Svg>
  )
}

/** Open book — methodology & caveats. */
export function IconBook(props) {
  return (
    <Svg {...props}>
      <path d="M7 3.25C5.9 2.45 4.3 2.3 2.5 2.5v8.5c1.8-.2 3.4-.05 4.5.75 1.1-.8 2.7-.95 4.5-.75V2.5c-1.8-.2-3.4-.05-4.5.75z" />
      <path d="M7 3.25v8.5" />
    </Svg>
  )
}
