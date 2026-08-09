## A: dbscan job on ames → job_ceb2c57b

## A: after navigating away 4s, server status=running

## A: on return, "Live job status" section visible=false (activeJobId is component state — expected lost unless restored)

## A: after clicking job in history, live status visible=true

## A: dbscan job on ames → job_0f1695dc

## A: after navigating away 4s, server status=running

## A: on return, "Live job status" section visible=false (activeJobId is component state — expected lost unless restored)

## A: after clicking job in history, live status visible=true

## B: regression(linear) on ds_103cc6cd → job_26c05fc2

## B1: second start while running → alert: A training job is already running
job job_26c05fc2 (dataset ds_103cc6cd) is already running — one training job at a time server-wide
View job_26c05fc2

## B2: DELETE dataset mid-job → HTTP 409 {"detail":"dataset ds_103cc6cd has a queued job (job_26c05fc2) — wait for it to finish before deleting"}

## B3: switched to tiny3 mid-job; blocked banner=1 liveStatus=0

## B3: back on qa-full; liveStatus=0 (job job_26c05fc2 still tracked?)

## B: terminal status=done

## C: 200-row dataset stage 07 → startDisabled=true banner="Training is unavailable for this dataset
post-split train split has ~140 rows; training and preprocessing require >= 150 (dataset has 200 rows total — the 01-05 exploration stages remain available)"

## D: unknown candidate → HTTP 422 {"detail":"unknown candidates ['not_a_model'] for objective 'regression'; valid candidates: ['linear', 'ridge', 'lasso', 'random_forest', 'xgboost']"}

## Training console/network capture
### console (2)
- [error] Failed to load resource: the server responded with a status of 409 (Conflict)
### failedReqs (27)
- GET http://localhost:8550/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/models?objective=regression :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/stats :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/models?objective=regression :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_a990d0bc/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_a990d0bc/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_a990d0bc/models?objective=regression :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_9780edd4/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_9780edd4/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_9780edd4/models?objective=regression :: net::ERR_ABORTED
### httpErrors (2)
- 409 POST http://localhost:8550/workflow/datasets/ames/jobs
- 409 POST http://localhost:8550/workflow/datasets/ds_103cc6cd/jobs

## 3b: started job_1b0df3f8 (queued) — if 409 collided, this is stale

## 3b: mid-job SPA switch → liveStatus on other dataset=1, back on owner dataset=1 (url was http://localhost:5550/workflow/07-train?dataset=ds_c0878824)

## 3b: terminal=done toast="(none)" pageErrors=0

