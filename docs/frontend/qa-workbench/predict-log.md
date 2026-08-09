## 09 on qa-full: sandbox visible=true championAside=true

## Double-submit: prices found=["$364,982","$319,529","$413,371"] pageErrors=0

## Result area
```
SANDBOX PREDICTION
POST /workflow/jobs/…/predict/…

Served by a model you trained on the active dataset in stage 07 — real predictions, workbench-only, never the PropPulse champion.

Trained job
job_26c05fc2 · regression · 1 candidate · finished Aug 9, 2026, 11:41 AM
Candidate
linear
SANDBOX ESTIMATE

$364,982

$319,529 – $413,371

~80% range — validation residual quantiles

linear · regression · job_26c05fc2

SANDBOX
Sandbox model — trained on your upload; not the PropPulse champion.
qa-full.csv · 1,020 train rows · trained Aug 9, 2026, 11:41 AM
LOCATION & LOT
Neighborhood
Bloomington Heights (Blmngtn)
Bluestem (Blueste)
Briardale (BrDale)
Brookside (BrkSide)
Clear Creek (ClearCr)
College Creek (CollgCr)
Crawford (Crawfor)
Edwards (Edwards)
Gilbert (Gilbert)
Iowa DOT & Rail Road (IDOTRR)
Meadow Village (MeadowV)
Mitchell (Mitchel)
North Ames (NAmes)
Northpark Villa (NPkVill)
Northwest A
```

## Provenance label present on sandbox result: true

## 09 on qa-full: sandbox visible=true championAside=true

## Double-submit: prices found=["$364,982","$319,529","$413,371"] pageErrors=0

## Result area
```
SANDBOX PREDICTION
POST /workflow/jobs/…/predict/…

Served by a model you trained on the active dataset in stage 07 — real predictions, workbench-only, never the PropPulse champion.

Trained job
job_26c05fc2 · regression · 1 candidate · finished Aug 9, 2026, 11:41 AM
Candidate
linear
SANDBOX ESTIMATE

$364,982

$319,529 – $413,371

~80% range — validation residual quantiles

linear · regression · job_26c05fc2

SANDBOX
Sandbox model — trained on your upload; not the PropPulse champion.
qa-full.csv · 1,020 train rows · trained Aug 9, 2026, 11:41 AM
LOCATION & LOT
Neighborhood
Bloomington Heights (Blmngtn)
Bluestem (Blueste)
Briardale (BrDale)
Brookside (BrkSide)
Clear Creek (ClearCr)
College Creek (CollgCr)
Crawford (Crawfor)
Edwards (Edwards)
Gilbert (Gilbert)
Iowa DOT & Rail Road (IDOTRR)
Meadow Village (MeadowV)
Mitchell (Mitchel)
North Ames (NAmes)
Northpark Villa (NPkVill)
Northwest A
```

## Provenance label present on sandbox result: true

## Champion /valuation same input: prices=["$295,006","$256,222","$295,006","$331,501","$179,900","$119"]

## API: predict on restart-failed job → HTTP 422 {"detail":[{"type":"missing","loc":["body","bedrooms"],"msg":"Field required","input":{"gr_liv_area":1500,"year_built":1990,"overall_qual":5,"lot_area":8000,"neighborhood":"NAmes","ms_zoning":"RL","house_style":"1Story",

## API: predict on clustering candidate → HTTP 422 {"detail":[{"type":"missing","loc":["body","bedrooms"],"msg":"Field required","input":{"gr_liv_area":1500,"year_built":1990,"overall_qual":5,"lot_area":8000,"neighborhood":"NAmes","ms_zoning":"RL","house_style":"1Story",

## API: predict unknown job → HTTP 422 {"detail":[{"type":"missing","loc":["body","bedrooms"],"msg":"Field required","input":{"gr_liv_area":1500,"year_built":1990,"overall_qual":5,"lot_area":8000,"neighborhood":"NAmes","ms_zoning":"RL","house_style":"1Story",

## Predict console/network capture
### failedReqs (4)
- GET http://localhost:8550/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/jobs :: net::ERR_ABORTED
- POST http://localhost:8550/market/comps :: net::ERR_ABORTED

