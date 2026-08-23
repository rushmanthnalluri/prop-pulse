/**
 * chartTheme — the recharts skin for the PropPulse design system
 * (docs/frontend/PLACEMENTPREDICT_UI_BLUEPRINT.md §6). Plain objects meant to
 * be spread onto recharts components, so every chart inherits the same
 * chrome without a wrapper library:
 *
 *   import {
 *     CHART_PALETTE, cartesianGridProps, xAxisProps, yAxisProps,
 *     tooltipProps, getAnimationProps, legendProps,
 *   } from '../components/shared/chartTheme'
 *
 *   <BarChart data={rows}>
 *     <CartesianGrid {...cartesianGridProps} />
 *     <XAxis dataKey="name" {...xAxisProps} />
 *     <YAxis {...yAxisProps} />
 *     <Tooltip {...tooltipProps} />
 *     <Bar dataKey="value" fill={CHART_PALETTE.accentFill}
 *          stroke={CHART_PALETTE.accent} radius={1.5}
 *          {...getAnimationProps(reduced)} />
 *   </BarChart>
 *
 * `reduced` comes from ./useReducedMotion — animation drops to 0ms under
 * prefers-reduced-motion, matching the CSS rule.
 *
 * Rules carried over from the reference: Plex Mono 10px ticks #8A9189, grid
 * rgba(235,236,232,0.06) on the y axis only, axis borders off, ~6–7 ticks,
 * tooltip = raised panel with a hairline border and no colour chips, 450ms
 * ease-out animation. One flat amber accent; slate is the second-series /
 * random-forest colour; danger marks missing values and the negative class.
 */

export const MONO_FONT = "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace"

export const CHART_PALETTE = {
  accent: '#D9A63F',
  accentFill: 'rgba(217, 166, 63, 0.55)',
  slate: '#6E8FA0',
  slateFill: 'rgba(110, 143, 160, 0.45)',
  neutral: '#8A9189',
  neutralFill: 'rgba(138, 145, 137, 0.4)',
  danger: '#D36B62',
  dangerFill: 'rgba(211, 107, 98, 0.55)',
  /** Negative segment in donut / outcome splits. */
  negativeSegment: '#3A403B',
  grid: 'rgba(235, 236, 232, 0.06)',
  tick: '#8A9189',
  text: '#EFF0EB',
  text2: '#A2A8A0',
  tooltipBg: '#202521',
  tooltipBorder: '#3A403B',
}

/** Fixed per-model series colours (blueprint §6) — never reassign. */
export const MODEL_COLORS = {
  logistic_regression: '#8A9189',
  random_forest: '#6E8FA0',
  gradient_boosting: '#D9A63F',
}

/** Donut / binary-split fills: positive amber, negative segment. */
export const DONUT_COLORS = [CHART_PALETTE.accent, CHART_PALETTE.negativeSegment]

/** Tick text style shared by both axes. */
export const axisTick = {
  fill: CHART_PALETTE.tick,
  fontSize: 10,
  fontFamily: MONO_FONT,
}

/** Y-only hairline grid; x grid off. */
export const cartesianGridProps = {
  stroke: CHART_PALETTE.grid,
  vertical: false,
}

/** recharts `tickCount` is approximate — 7/6 reads as the reference's
    maxTicksLimit 7/6. Axis borders and tick marks stay off. */
export const xAxisProps = {
  tick: axisTick,
  axisLine: false,
  tickLine: false,
  tickCount: 7,
  tickMargin: 8,
}

export const yAxisProps = {
  tick: axisTick,
  axisLine: false,
  tickLine: false,
  tickCount: 6,
  tickMargin: 6,
  width: 48,
}

/** Tooltip chrome: raised panel, hairline border, radius 6, no colour chips. */
export const tooltipProps = {
  contentStyle: {
    backgroundColor: CHART_PALETTE.tooltipBg,
    border: `1px solid ${CHART_PALETTE.tooltipBorder}`,
    borderRadius: 6,
    padding: 10,
    fontSize: 12,
    fontFamily: MONO_FONT,
    boxShadow: 'none',
  },
  labelStyle: { color: CHART_PALETTE.text, marginBottom: 4 },
  itemStyle: { color: CHART_PALETTE.text2, padding: 0 },
  cursor: { fill: 'rgba(235, 236, 232, 0.04)' },
}

/** Multi-series legends only: small square swatches, mono labels. */
export const legendProps = {
  iconSize: 9,
  iconType: 'rect',
  wrapperStyle: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    color: CHART_PALETTE.text2,
  },
}

export const CHART_ANIMATION_MS = 450

/**
 * Animation spread for series components (Bar, Line, Area, Pie…).
 * @param {boolean} reduced - from useReducedMotion()
 */
export function getAnimationProps(reduced) {
  return {
    isAnimationActive: !reduced,
    animationDuration: reduced ? 0 : CHART_ANIMATION_MS,
    animationEasing: 'ease-out',
  }
}

/** Standard chart frame heights (match .chart-wrap / .chart-wrap-tall / .h-340). */
export const CHART_HEIGHT = { default: 200, tall: 320, xl: 340 }
