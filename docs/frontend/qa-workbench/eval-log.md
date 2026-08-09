## Deep-link eval job_26c05fc2: hasMetrics=true hasResiduals=true

## Bogus ?job=job_deadbeef: pageErrors=0 body=01 | Upload | 02 | Features | 03 | Stats | 04 | Missing | 05 | Visualize | 06 | Preprocess | 07 | Train | 08 | Evaluate | 09 | Predict | 10 | Market | 11 | Explain | 12 | Health | Sandbox workbench — models you train here serve this workbench only and never replace the PropPulse champion. | qa-full.csv | 1,460 × 81 | STAGE 08 · MODEL EVALUATION | Model

## ames eval job options: ["job_3b66b834 · Aug 9, 2026, 11:31 AM","job_f0953b03 · Aug 9, 2026, 11:33 AM","job_20bf673f · Aug 9, 2026, 11:34 AM"]

## Rapid job switching ×8: finalSelect=job_f0953b03 newPageErrors=0

## Clustering eval (dbscan ames)
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
STAGE 08 · MODEL EVALUATION
Model Evaluation

Validation-split evidence for your sandbox candidates — metrics, curves, and cluster assignments derived from the predictions persisted at train time. The sandbox test split stays sealed; no test numbers exist in the workbench.

Ames Housing (bundled) · 1460 rows · 3 completed jobs

CANDIDATE
completed jobs only
Job
job_3b66b834 · Aug 9, 2026, 11:31 AM
job_f0953b03 · Aug 9, 2026, 11:33 AM
job_20bf673f · Aug 9, 2026, 11:34 AM
Candidate
dbscan
COMPARISON — CLUSTERING
latest successful result per candidate
SANDBOX
Sandbox comparison — validation metrics only; the test split stays sealed.
Ames Housing (bundled) · 945 train rows · 338 val
clustering candidates ranked by validation metric — single DBSCAN candidate — no champion selection
CANDIDATE
	CLUSTERS
	NOISE
	EPS
	MIN SAMPLES
	TRAIN S
	BEST PARAMS
dbscanBEST	4	3	1.317	2	0.1	{"eps":1.3170045189879962,"min_samples":
```

## API: eval of restart-failed job (linear done candidate) → HTTP 200 {"objective":"regression","candidate":"linear","split":"val","n":219,"metrics":{"mae":15228.680366072638,"rmse":21282.570180446735,"r2":0.9281289950085073,"rmsle":0.13580687548671377,"rmse_log":0.13580687548671383,"resid

## API: eval of stuck "running" candidate lasso → HTTP 409 {"detail":"candidate 'lasso' of job job_ceb2c57b has no completed result (status: running)"}

## API: eval unknown job → HTTP 404 {"detail":"unknown job id: 'job_ffffffff'"}

## API: eval unknown candidate → HTTP 404 {"detail":"job job_26c05fc2 has no candidate 'notamodel' (known: ['linear'])"}

## 08 on 200-row (never trainable) dataset
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

ames200.csv
200 × 81
STAGE 08 · MODEL EVALUATION
This stage is locked

Train at least one model in stage 07 to unlock evaluation.

Go to stage 07 — Model Tr
```

## Evaluation console/network capture
### failedReqs (34)
- GET http://localhost:8550/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_103cc6cd/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/jobs/job_26c05fc2/evaluation/linear :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/jobs/job_20bf673f/evaluation/dbscan :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/jobs/job_3b66b834/evaluation/linear :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/jobs/job_f0953b03/evaluation/logistic :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/models?objective=clustering :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/models?objective=regression :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/models?objective=classification :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ds_9780edd4/state :: net::ERR_ABORTED

