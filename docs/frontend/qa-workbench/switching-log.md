## 01-upload: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=true

## 01-upload: tiny3→ames | stale tiny3 marker after switch-back=true

## 02-features: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 02-features: tiny3→ames | stale tiny3 marker after switch-back=false

## 03-stats: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 03-stats: tiny3→ames | stale tiny3 marker after switch-back=false

## 04-missing: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 04-missing: tiny3→ames | stale tiny3 marker after switch-back=false

## 05-viz: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 05-viz: tiny3→ames | stale tiny3 marker after switch-back=false

## 06-preprocess: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 06-preprocess: tiny3→ames | stale tiny3 marker after switch-back=false

## 07-train: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 07-train: tiny3→ames | stale tiny3 marker after switch-back=false

## 12-health: ames→tiny3 | urlDataset=ds_c0878824 | stale "1,460" after switch=false

## 12-health: tiny3→ames | stale tiny3 marker after switch-back=false

## 05-viz rapid switching: final dataset param=ds_c0878824 | shows "1,460"=false | pageErrors=0

## Dataset switching console/network capture
### failedReqs (29)
- GET http://localhost:8550/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/profile :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/features :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/stats :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/missing :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/viz/histogram?column=SalePrice&bins=30 :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/preprocess :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/jobs :: net::ERR_ABORTED
- GET http://localhost:8550/workflow/datasets/ames/models?objective=regression :: net::ERR_ABORTED

