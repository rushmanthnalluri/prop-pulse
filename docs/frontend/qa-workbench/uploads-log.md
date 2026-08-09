## not-a-csv.csv: report visible=1

```
"not-a-csv.csv" was rejected

missing required Ames columns: ['Id', 'MSSubClass', 'MSZoning', 'LotFrontage', 'LotArea', 'Street', 'Alley', 'LotShape', 'LandContour', 'Utilities', 'LotConfig', 'LandSlope', 'Neighborhood', 'Condition1', 'Condition2', 'BldgType', 'HouseStyle', 'OverallQual', 'OverallCond', 'YearBuilt', 'YearRemodAdd', 'RoofStyle', 'RoofMatl', 'Exterior1st', 'Exterior2nd', 'MasVnrType', 'MasVnrArea', 'ExterQual', 'ExterCond', 'Foundation', 'BsmtQual', 'BsmtCond', 'BsmtExposure', 'BsmtFinType1', 'BsmtFinSF1', 'BsmtFinType2', 'BsmtFinSF2', 'BsmtUnfSF', 'TotalBsmtSF', 'Heating', 'HeatingQC', 'CentralAir', 'Electrical', '1stFlrSF', '2ndFlrSF', 'LowQualFinSF', 'GrLivArea', 'BsmtFullBath', 'BsmtHalfBath', 'FullBath', 'HalfBath', 'BedroomAbvGr', 'KitchenAbvGr', 'KitchenQual', 'TotRmsAbvGrd', 'Functional', 'Fireplaces', 'FireplaceQu', 'GarageType', 'GarageYrBlt', 'GarageFinish', 'Ga
```

## extra-col.csv: created=ds_eff4a83e

```
Validation passed with 9 warnings — extra-col.csv
✓
FORMAT
CSV filename/extension accepted
✓
CSV PARSE
body parsed as CSV (utf-8-sig)
✓
NON-EMPTY
50 data rows
✓
ROW CAP
50 <= 20000 rows
✓
UNIQUE ID
all Id values are unique
✓
SCHEMA · 81 COLUMNS
all 81 Ames columns present
✓
CATEGORY VALUES
category sets match the Ames schema
✓
NUMERIC RANGES
numeric values within documented ranges
!
CARDINALITY
column 'Street' is constant (1 unique value)
!
CARDINALITY
column 'Utilities' is constant (1 unique value)
!
CARDINALITY
column 'LandSlope' is constant (1 unique value)
!
CARDINALITY
column 'RoofMatl' is constant (1 unique value)
!
CARDINALITY
column 'Heating' is constant (1 unique value)
!
CARDINALITY
column 'LowQualFinSF' is constant (1 unique value)
!
CARDINALITY
column 'PoolArea' is constant (1 unique value)
!
CARDINALITY
column 'PoolQC' is constant (1 unique value)
!
CARDINALITY
column 'Bogus
```

## big.csv (11MiB) via UI: dropError=""big.csv" is 11 MiB — over the 10 MiB upload limit."

## big.csv direct API: HTTP 413 body={"detail":"Request body too large; limit is 10485760 bytes"}

## Double-fire tiny3.csv: 2 dataset(s) created → ds_c0878824, ds_fe80c21b

## ames200.csv upload → ds_ed5c8cd5

## After deleting ds_ed5c8cd5, deep-link stats?dataset=ds_ed5c8cd5 → http://localhost:5300/workflow/03-stats?dataset=ames

## Uploads console/network capture
### console (3)
- [error] Failed to load resource: the server responded with a status of 422 (Unprocessable Content)
- [error] Failed to load resource: the server responded with a status of 404 (Not Found)
### failedReqs (12)
- GET http://localhost:8200/workflow/datasets :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/state :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ames/profile :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ds_ed5c8cd5/state :: net::ERR_ABORTED
- GET http://localhost:8200/workflow/datasets/ds_ed5c8cd5/stats :: net::ERR_ABORTED
### httpErrors (3)
- 422 POST http://localhost:8200/workflow/datasets?filename=not-a-csv.csv
- 404 GET http://localhost:8200/workflow/datasets/ds_ed5c8cd5/state
- 404 GET http://localhost:8200/workflow/datasets/ds_ed5c8cd5/stats

