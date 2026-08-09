## Bare /workflow redirect → http://localhost:5300/workflow/01-upload?dataset=ames

## Stage 01-upload: title="Upload & validate" locked=false url=http://localhost:5300/workflow/01-upload?dataset=ames

## Stage 02-features: title="Feature analysis" locked=false url=http://localhost:5300/workflow/02-features?dataset=ames

## Stage 03-stats: title="Descriptive statistics" locked=false url=http://localhost:5300/workflow/03-stats?dataset=ames

## Stage 04-missing: title="Missing values" locked=false url=http://localhost:5300/workflow/04-missing?dataset=ames

## Stage 05-viz: title="Visualization" locked=false url=http://localhost:5300/workflow/05-viz?dataset=ames

## Stage 06-preprocess: title="Preprocessing" locked=false url=http://localhost:5300/workflow/06-preprocess?dataset=ames

## Stage 07-train: title="Model Training" locked=false url=http://localhost:5300/workflow/07-train?dataset=ames

## Stage 08-evaluate: title="(none)" locked=true url=http://localhost:5300/workflow/08-evaluate?dataset=ames

## Stage 09-predict: title="(none)" locked=true url=http://localhost:5300/workflow/09-predict?dataset=ames

## Stage 10-market: title="Micro-markets, yours and the champion’s" locked=true url=http://localhost:5300/workflow/10-market?dataset=ames

## Stage 11-explain: title="Why the numbers move" locked=true url=http://localhost:5300/workflow/11-explain?dataset=ames

## Stage 12-health: title="Health: sandbox facts, champion monitoring" locked=false url=http://localhost:5300/workflow/12-health?dataset=ames

## Stepper jump → 07-train: url=http://localhost:5300/workflow/07-train?dataset=ames newPageErrors=0

## Stepper jump → 03-stats: url=http://localhost:5300/workflow/03-stats?dataset=ames newPageErrors=0

## Stepper jump → 12-health: url=http://localhost:5300/workflow/12-health?dataset=ames newPageErrors=0

## Stepper jump → 05-viz: url=http://localhost:5300/workflow/05-viz?dataset=ames newPageErrors=0

## Unknown slug /workflow/99-nope → http://localhost:5300/workflow/05-viz?dataset=ames

## Invalid dataset param ds_zzzzzzzz → http://localhost:5300/workflow/03-stats?dataset=ames

## Nonexistent dataset ds_deadbeef → http://localhost:5300/workflow/03-stats?dataset=ames (expect toast + fallback to ames)

## Restore after visiting 05-viz: bare /workflow → http://localhost:5300/workflow/05-viz?dataset=ames

## Journey console/network capture
### console (2)
- [error] Failed to load resource: the server responded with a status of 404 (Not Found)
### failedReqs (65)
- GET http://localhost:8200/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/profile :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/features :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/stats :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/missing :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/viz/histogram?column=SalePrice&bins=30 :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/preprocess :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/jobs :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/models?objective=regression :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ds_deadbeef/state :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ds_deadbeef/stats :: net::ERR_ABORTED
### httpErrors (2)
- 404 GET http://localhost:8200/workflow/datasets/ds_deadbeef/state
- 404 GET http://localhost:8200/workflow/datasets/ds_deadbeef/stats

## Junk-text hunt
{
  "01-upload": [],
  "02-features": [],
  "03-stats": [],
  "04-missing": [],
  "05-viz": [],
  "06-preprocess": [],
  "07-train": [],
  "08-evaluate": [],
  "09-predict": [],
  "10-market": [],
  "11-explain": [],
  "12-health": []
}

