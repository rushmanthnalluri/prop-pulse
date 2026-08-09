## Full offline → 04-missing
```
(shell gone)
```

## Abort /stats only: stepper alive=12 retryVisible=true

```
01
Upload
02
Features
03
Stats
04
Missing
05
Visualize
06
Preprocess
07
Train
08
Evaluate
09
Predict
10
Market
11
Explain
12
Health

Sandbox workbench — models you train here serve this workbench only and never replace the PropPulse champion.

Ames Housing (bundled)
1,460 × 81
STAGE 03 · DESCRIPTIVE STATISTICS
Descriptive statistics

The distribution of every column in the active dataset — central tendency, spread, and the most frequent categories — computed server-side on the raw rows.

Ames Ho
```

## Abort /state on gated 08
```
01
Upload
02
Features
03
Stats
04
Missing
05
Visualize
06
Preprocess
07
Train
08
Evaluate
09
Predict
10
Market
11
Explain
12
Health

Sandbox workbench — models you train here serve this workbench only and never replace the PropPulse champion.

Ames Housing (bundled)
1,460 × 81
Couldn't load workflow state
Cannot reach the PropPulse API at http://localhost:8550. Is the backend running?
Try again
```

## Abort /viz/* on 05
```
01
Upload
02
Features
03
Stats
04
Missing
05
Visualize
06
Preprocess
07
Train
08
Evaluate
09
Predict
10
Market
11
Explain
12
Health

Sandbox workbench — models you train here serve this workbench only and never replace the PropPulse champion.

Ames Housing (bundled)
1,460 × 81
STAGE 05 · VISUALIZATION
Visualization

Distributions, relationships, and group comparisons of the active dataset. Every chart is aggregated on the server — the browser receives plot-ready bins, points, and matrices, never the raw frame.

Ames Housing (bundled) · 1,460 × 81

SANDBOX
Charts aggregate the active dataset — 
```

## Abort /datasets list on 01
```
01
Upload
02
Features
03
Stats
04
Missing
05
Visualize
06
Preprocess
07
Train
08
Evaluate
09
Predict
10
Market
11
Explain
12
Health

Sandbox workbench — models you train here serve this workbench only and never replace the PropPulse champion.

ames
STAGE 01 · UPLOAD DATASET
Upload & validate

Every workflow stage runs on the bundled Ames dataset out of the box. To work with your own data, upload a CSV here — it is validated against the full 81-column Ames schema before it is stored.

Loading dat
```

## Offline console/network capture
### console (4)
- [error] Failed to load resource: net::ERR_FAILED
### failedReqs (20)
- GET http://localhost:8550/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/stats :: net::ERR_ABORTED
- GET http://localhost:5550/workflow/04-missing?dataset=ames :: net::ERR_INTERNET_DISCONNECTED
- GET http://localhost:8550/workflow/datasets/ames/stats :: net::ERR_FAILED
- GET http://localhost:8550/workflow/datasets/ames/state :: net::ERR_FAILED
- GET http://localhost:8550/workflow/datasets/ames/features :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/viz/histogram?column=SalePrice&bins=30 :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/viz/histogram?column=SalePrice&bins=30 :: net::ERR_FAILED
- GET http://localhost:8550/workflow/datasets/ames/profile :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets :: net::ERR_FAILED

## SPA offline → 04 (chunk cached): shell=1 offlineMsg=true

```
Skip to content
PropPulse
PROPERTY INTELLIGENCE
ANALYZE
Overview
Valuation
Market Intelligence
PLATFORM
Model Insights
Model Health
WORKBENCH
ML Workbench
API offline
Ames, IA · training window
2006–2008 · 25 neighborhoods
API offline. Valuations and market data are unavailable until the backend responds.
Retry connection
01
Upload
02
Features
03
Stats
04
Missing
05
Visualize
06
Preprocess
07
Train
08
Evaluate
09
Predict
10
Market
11
Explain
12
Health

Sandbox workbench — models you train here s
```

## SPA offline → 05 (chunk NOT cached): shell=0 url=http://localhost:5550/workflow/05-viz?dataset=ames

```
Skip to content
PropPulse
PROPERTY INTELLIGENCE
ANALYZE
Overview
Valuation
Market Intelligence
PLATFORM
Model Insights
Model Health
WORKBENCH
ML Workbench
API offline
Ames, IA · training window
2006–2008 · 25 neighborhoods
API offline. Valuations and market data are unavailable until the backend responds.
Retry connection
This section failed to render
This section could not be loaded — the connection dropped or the app was updated mid-session. Reloading fetches a fresh copy.
Reload page
Back to 
```

## Back online → 03-stats: shell=0 errorVisible=false

## SPA-offline v2 console capture
### console (5)
- [error] Failed to load resource: net::ERR_INTERNET_DISCONNECTED
- [error] %o

%s

%s
 TypeError: Failed to fetch dynamically imported module: http://localhost:5550/src/pages/workflow/VizStage.jsx The above error occurred in the <Offscreen> component. React will try to recreate this component tree from scratch using the error boundary you provided, ErrorBoundary.
- [error] [PropPulse] render failure: TypeError: Failed to fetch dynamically imported module: http://localhost:5550/src/pages/workflow/VizStage.jsx 
    at Suspense (<anonymous>)
    at div (<anonymous>)
    at WorkflowShell (http://localhost:5550/src/pages/workflow/WorkflowShell.jsx:157:17)
    at Suspense (<anonymous>)
    at ErrorBoundary (http://localhost:5550/src/components/ErrorBoundary.jsx:13:5)
    at RenderedRoute (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4313:26)
    at Outlet (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4930:26)
    at main (<anonymous>)
    at div (<anonymous>)
    at div (<anonymous>)
    at Layout (http://localhost:5550/src/components/Layout.jsx:193:31)
    at ToastProvider (http://localhost:5550/src/components/Toast.jsx:31:33)
    at ErrorBoundary (http://localhost:5550/src/components/ErrorBoundary.jsx:13:5)
    at RenderedRoute (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4313:26)
    at _a3 (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4248:5)
    at DataRoutes2 (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4870:24)
    at Router (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4935:29)
    at RouterProvider (http://localhost:5550/node_modules/.vite/deps/react-router.js?v=596b7030:4677:27)
    at App (<anonymous>)
### failedReqs (10)
- GET http://localhost:8550/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/stats :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/missing :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/stats :: net::ERR_INTERNET_DISCONNECTED
- GET http://localhost:8550/workflow/datasets/ames/missing :: net::ERR_INTERNET_DISCONNECTED
- GET http://localhost:5550/src/pages/workflow/VizStage.jsx :: net::ERR_INTERNET_DISCONNECTED

