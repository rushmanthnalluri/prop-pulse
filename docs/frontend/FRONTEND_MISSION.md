# PROPPULSE — PIXEL-LEVEL FRONTEND & UI/UX RECONSTRUCTION FROM PLACEMENTPREDICT

## MISSION

Rebuild the **entire PropPulse frontend** so that its **visual quality, layout system, navigation, component placement, interactions, workflow, spacing, typography, colors, buttons, forms, charts, states, responsiveness, and overall user experience** match the existing PlacementPredict application at a very high level.

Reference project: `C:\Machine_Learning\Placement-predict`
Target project: `PropPulse`

---

## CRITICAL REQUIREMENT

**PLACEMENTPREDICT IS THE FRONTEND REFERENCE SOURCE OF TRUTH.**

Do NOT make generic design decisions before thoroughly inspecting PlacementPredict.
Do NOT simply copy the code. Do NOT simply copy the colors. Do NOT simply rename PlacementPredict components.

Instead: **REVERSE-ENGINEER THE ENTIRE PLACEMENTPREDICT EXPERIENCE AND RECREATE ITS DESIGN SYSTEM AND UX LANGUAGE FOR PROPPULSE.**

The user should be able to open both applications and immediately recognize that PropPulse follows the same **design philosophy, layout discipline, workflow structure, interaction quality, and visual hierarchy**.

---

## 1. FIRST ACTION — STOP CODING

Before changing PropPulse frontend code, completely inspect PlacementPredict (`C:\Machine_Learning\Placement-predict`). Find: frontend entry point, routes, pages, layout, components, CSS, Tailwind config if used, theme, global styles, assets, icons, fonts, charts, forms, navigation, sidebar, header, footer, modals, dropdowns, tooltips, toasts, loading states, error states, empty states, responsive behavior, API integration. Read the actual source. Do not infer the design from filenames.

## 2. PLACEMENTPREDICT UI BLUEPRINT

Before implementation, create `docs/frontend/PLACEMENTPREDICT_UI_BLUEPRINT.md`. For every page document: Page, Route, Purpose, Layout, Container width, Header, Sidebar, Navigation, Sections, Cards, Buttons, Forms, Tables, Charts, Footer, Spacing, Typography, Colors, Borders, Shadows, Icons, Hover states, Active states, Loading states, Error states, Empty states, Responsive behavior.

## 3. SCREEN-BY-SCREEN ANALYSIS

For each screen determine: (A) overall structure (Viewport → Header → Sidebar/nav → Main → Footer) with exact relationship and positioning of each region; (B) content hierarchy (page title, subtitle, primary action, secondary actions, section headings, cards, supporting info, charts, tables); (C) visual hierarchy — what the user notices 1st/2nd/3rd/4th. PropPulse must preserve that hierarchy.

## 4. PIXEL-LEVEL LAYOUT AUDIT

Analyze: page width, content max-width, left/right margins, sidebar width, header height, card width/height, grid columns, column/row gaps, section spacing, internal padding, button spacing, input spacing, chart dimensions. Reproduce the reference's consistent spacing system; do not invent new spacing values.

## 5. EXACT NAVIGATION STRUCTURE

Determine: logo position/size, sidebar position/width, nav item height, icon position, text position, item spacing, active/hover/selected styling, collapsed state, mobile navigation, grouping, separators, section labels. Recreate the same navigation behavior and geometry in PropPulse, adapting names (PlacementPredict workflow → PropPulse equivalent workflow).

## 6–8. BUTTON AUDIT, POSITION, HIERARCHY

Inventory **every button** in PlacementPredict: name, location, width, height, position, icon (+position), text, font, font size/weight, border radius, background, border, shadow, padding, hover, active, focus, disabled, loading, click behavior, destination/action. Map each to PropPulse. Reproduce the same visual hierarchy and **placement logic** (e.g. primary action top-right stays top-right; `[Back] [Next]` structure preserved; primary action like `[Analyze Dataset]` stays prominent, not hidden in a menu). Reproduce the Primary/Secondary/Tertiary/Danger/Success/Disabled/Loading system.

## 9–10. COLOR SYSTEM & THEME

Identify the actual color system: primary, secondary, accent, background, surface, card background, text, muted text, border, hover, active, success, warning, error, info, chart colors, gradient usage. Identify CSS variables/theme tokens if defined. Build a PropPulse design-token system (`--primary`, `--primary-hover`, `--background`, `--surface`, `--surface-secondary`, `--text`, `--text-muted`, `--border`, `--success`, `--warning`, `--danger`, …). No scattered random colors. Theme must feel like the same design family (light/dark, background tone, surface/border/text contrast, accent usage, card/navigation/chart treatment). Do NOT add neon, glow, cyberpunk, excessive gradients, AI-looking effects, or glassmorphism unless PlacementPredict genuinely uses them.

## 11. TYPOGRAPHY

Determine font family/fallbacks, page title size, section title size, body size, caption size, button size, font weights, line height, letter spacing. Recreate the hierarchy: Page Title → Section Title → Card Title → Body → Metadata. No arbitrary per-page typography.

## 12. CARDS

Analyze every card style: border, radius, shadow, background, padding, header, footer, title, subtitle, icon, metric, hover. Create reusable PropPulse card primitives. Do not create 20 slightly different card styles.

## 13. DASHBOARD OVERVIEW

PropPulse overview page must have the same layout discipline and visual density as PlacementPredict. Study how PlacementPredict structures: dashboard title, summary area, metrics, main content, secondary content, charts, recent activity, actions. PropPulse content: Property Intelligence Overview — properties analyzed, average predicted value, average sale probability, active model, dataset information, valuation overview, market distribution, neighbourhood intelligence, model performance, recent analysis. **Only display metrics that actually exist.**

## 14. EDA WORKFLOW MUST MATCH THE REFERENCE

Preserve PlacementPredict's guided workflow. Reference: 01 Upload Dataset, 02 Analyse Features, 03 Descriptive Statistics, 04 Missing Value Analysis, 05 Data Visualization, 06 Preprocessing, 07 Model Training, 08 Model Evaluation, 09 Predict Placement. PropPulse: same 01–08, then 09 Predict Property. Visual structure, progress/navigation treatment, page hierarchy and interaction pattern closely follow PlacementPredict.

## 15. UPLOAD DATASET PAGE

Match: upload area, drag/drop area, file selector, upload button, file information, validation messages, loading state, success state, error state, next action. Structurally equivalent, not a generic file-upload component.

## 16. FEATURE ANALYSIS PAGE

Display: feature name, type, unique values, missing values, statistics, target role. Same table density and interaction philosophy as PlacementPredict.

## 17. DESCRIPTIVE STATISTICS PAGE

Match: metric cards, statistics table, section structure, tabs, filters, dropdowns, chart placement. Adapt content to housing data.

## 18. MISSING VALUE PAGE

Include: missing count, missing percentage, affected columns, visualization, recommendations. Reproduce the reference's visual language; no unrelated dashboard design.

## 19. DATA VISUALIZATION PAGE

Match: chart selector, feature selectors, dropdown locations, filter placement, chart container, legend, tooltip, axis styling, chart sizing. Adapt visualizations to PropPulse: Sale Price Distribution, Living Area vs Sale Price, Neighborhood vs Sale Price, Quality vs Sale Price, Correlation Matrix.

## 20. PREPROCESSING PAGE

Show the pipeline visually: Raw Data → Cleaning → Missing Values → Encoding → Scaling → Feature Engineering → Train/Validation/Test. Match the reference's layout, step representation, status indicators, buttons, information density, progress behavior.

## 21. MODEL TRAINING PAGE

Reproduce the same interaction philosophy: model selector, hyperparameters, train button, training status, model results, model comparison. Extend for Regression, Classification, Clustering. Not a completely different experience.

## 22. MODEL EVALUATION PAGE

Match PlacementPredict's evaluation UX: metric cards, tables, charts, model comparison, best model indicator, evaluation details. PropPulse metrics — Regression: MAE, RMSE, R², RMSLE. Classification: Precision, Recall, F1, ROC-AUC, PR-AUC, Brier, Calibration. Clustering: cluster count, cluster sizes, silhouette, noise.

## 23–25. PREDICT PROPERTY PAGE, FORMS, RESULT UI

Not a generic form. Study PlacementPredict's form layout, input grouping, label placement, input dimensions, dropdowns, validation, button position, submit behavior, loading, result presentation. Form groups for PropPulse: Property, Location, Size, Quality, Condition, Rooms, Amenities, Garage, Basement, Age. Match label/placeholder/input/dropdown/helper text/error/required indicator/spacing. Result UI: recreate the reference's result hierarchy, main metric, supporting metrics, charts, explanation, CTA — adapted to Estimated Sale Price, Price Range, Probability of Selling Within 30 Days, Neighbourhood, Micro-market, Prediction Explanation.

## 26–28. CHARTS, TABLES, ICONS

Charts: determine library, dimensions, colors, grid lines, axis, typography, legend, tooltip, animation, margins, responsive behavior; use the same design language; don't mix five chart styles. Tables: header, rows, borders, striping, hover, pagination, sorting, filtering, empty state — same design system. Icons: determine PlacementPredict's icon library and use the same family if technically appropriate; don't mix Lucide/FontAwesome/Material/random SVGs/emoji without reason; consistent stroke, weight, size, alignment, spacing.

## 29–32. STATES

For every interactive component implement Default, Hover, Active, Focus, Disabled, Loading, Success, Error. Loading: button spinner, skeleton, progress, loading message, disabled controls — user never wonders whether the app is working. Errors: invalid file, API failure, validation failure, model failure, backend offline, unexpected response — human-readable, localized to the relevant component, actionable, visually consistent. Empty states on every data-driven page (e.g. "No dataset uploaded [Upload Dataset]", "No model trained [Train Model]", "No evaluation available [Evaluate Model]"), following PlacementPredict's empty-state visual language.

## 33–34. RESPONSIVENESS & ACCESSIBILITY

Reproduce the same quality at 1920/1440/1280/1024/768/390px for sidebar, header, grid, cards, tables, charts, forms, buttons, navigation. Not merely `flex-wrap`. Accessibility: keyboard navigation, focus indicators, labels, ARIA where required, color contrast, button/input semantics, tooltips — match or improve PlacementPredict.

## 35. FRONTEND ARCHITECTURE

Create a reusable PropPulse design system, e.g. `src/components/{layout,navigation,buttons,forms,cards,tables,charts,feedback,common}`, `src/pages/{Overview,Upload,Features,Statistics,MissingValues,Visualization,Preprocessing,Training,Evaluation,Predict}`, `src/styles/{tokens,globals}` — or use the actual architecture if PropPulse already has a better one.

## 36. DO NOT BREAK EXISTING BACKEND

Preserve working API contracts. For every page verify UI → Event → API client → FastAPI → ML pipeline → Response → UI. No hardcoded fake results. No mock data unless explicitly marked demo-only.

## 37–40. COMPARISON & QA DOCS

Launch both apps side-by-side; compare overall composition, navigation, spacing, typography, color, buttons, cards, forms, charts, tables, page transitions, workflow, responsive behavior. Create:
- `docs/frontend/UI_COMPARISON.md` — Screen / Reference behavior / PropPulse implementation / Difference / Fix / Status, for every page (REFERENCE → PROPPULSE → COMPARE → IDENTIFY → FIX → RETEST).
- `docs/frontend/BUTTON_AUDIT.md` — for every important button: PlacementPredict button, location, purpose, PropPulse equivalent, location, purpose, visual match, functional match, status. **No important button that exists visually but doesn't work.**
- `docs/frontend/DESIGN_SYSTEM.md` — colors, typography, spacing, radius, shadows, buttons, inputs, cards, tables, charts, navigation, states, breakpoints. Tokens used throughout PropPulse.

## 41. FRONTEND RED-TEAM AGENT

Deploy a dedicated agent whose ONLY task is to criticize the frontend. It must explicitly search for: wrong button location, wrong color, wrong spacing, wrong typography, wrong navigation, wrong layout, missing component, missing state, broken interaction, inconsistent card, inconsistent chart, fake data, dead button, poor mobile layout, generic AI appearance, overdesign, underdesign. It must NOT be polite. Weak frontend → verdict `FAIL` with Reason / Evidence / Required change.

## 42. FRONTEND INNOVATION AGENT

After matching PlacementPredict, ask: "How can PropPulse be better without violating the PlacementPredict design language?" Candidate ideas: property comparison, what-if analysis, price positioning, market intelligence, interactive valuation explanation, neighbourhood exploration, scenario analysis. Only implement ideas that genuinely improve the product.

## 43. FINAL QUALITY BAR

`npm run build` passing is necessary but NOT sufficient. Complete only when: navigation matches reference quality; page structure matches; button positions match reference logic; button styling matches reference system; colors/typography/spacing/cards/forms/tables/charts consistent; loading, error, empty, hover, focus states exist; responsive behavior works; every important button works; every page reachable; every API interaction works; no fake metrics; no fake prediction; no dead components; no console errors; no broken routes; no visual regressions.

## 44. FINAL USER TEST

Pretend to be a completely new user. From the homepage, using only the UI: Upload Dataset → Analyse Features → Statistics → Missing Values → Visualization → Preprocessing → Training → Evaluation → Predict Property → Explore Results. Ask: Is it obvious what to click? Is the next step obvious? Are buttons where expected? Is the interface consistent? Do pages feel connected? Does anything feel unfinished, fake, or like a generic AI template? Fix everything found.

## 45. FINAL DIRECTIVE

DO NOT design PropPulse from scratch. First reverse-engineer PlacementPredict (WHERE/WHAT/WHY/HOW of every visual and interactive element), then reproduce the same frontend quality, visual hierarchy, component system, interaction patterns, navigation structure, workflow, spacing, colors, typography, button placement, states, and responsiveness in PropPulse. Adapt the CONTENT to real estate; do NOT blindly copy the CONTENT. Relationship: PlacementPredict's UI/UX design system, component quality, layout, interaction, workflow, visual hierarchy → PropPulse (Property Valuation, Sale Probability, Market Intelligence, Neighbourhood Analysis, Model Evaluation, Property Prediction).

**FINAL STANDARD:** Side-by-side, the evaluator should think: "PropPulse has clearly reproduced the same level of frontend engineering and UX sophistication as PlacementPredict, while transforming it into a polished PropTech product." MATCH THE EXPERIENCE. MATCH THE DESIGN SYSTEM. MATCH THE INTERACTION QUALITY. MATCH THE DETAIL. THEN MAKE PROPPULSE BETTER.
