/**
 * Methodology (SPEC §5.4-7, §1.3): how the champions were trained and judged,
 * told as a numbered narrative. Every count here is vouched by the API
 * contract (CONTRACT §4): 945 train sales 2006H1–2008H2, val 338 (2009),
 * sealed test 175 (2010), 25 neighborhoods, 94 model features. Live values
 * from GET /model/info are preferred when loaded; the contract constants are
 * the standing fallback, so this section still teaches when the API is down.
 * The champion-selection rationale renders verbatim from the API when present.
 */
const FALLBACKS = {
  nFeatures: 94,
  dataset: 'ames-1.0',
  featureVersion: '9b0f8ba4201c',
  nClusters: 4,
}

function Row({ index, title, children }) {
  return (
    <div className="row-item">
      <span className="row-index">{index}</span>
      <div className="row-body">
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
    </div>
  )
}

export default function Methodology({ info }) {
  const nFeatures = info?.n_features ?? FALLBACKS.nFeatures
  const dataset = info?.dataset_version || FALLBACKS.dataset
  const featureVersion = info?.feature_version || FALLBACKS.featureVersion
  const nClusters = info?.clustering?.n_clusters ?? FALLBACKS.nClusters

  return (
    <div className="insights-prose">
      <div className="row-list">
        <Row index="01" title="The data">
          945 training sales from Ames, Iowa, sold 2006H1–2008H2 across 25
          neighborhoods, grouped into {nClusters} micro-markets and expanded to{' '}
          {nFeatures} model features (79 raw columns + 15 engineered). Dataset{' '}
          {dataset} · feature_version {featureVersion}.
        </Row>
        <Row index="02" title="A time-based split, never shuffled">
          Train = sales through 2008 (945 rows), validation = 2009 (338),
          sealed test = 2010 (175). Every metric on this page is an
          out-of-time estimate — the honest kind for a model asked to predict
          the future. Champions were chosen on validation only.
        </Row>
        <Row index="03" title="Tuning discipline">
          Hyperparameters were fixed by 5-fold cross-validation on the train
          split alone; the ridge alpha follows the one-standard-error rule.
          Classifier probabilities are sigmoid-calibrated on train, and the
          decision threshold maximizes validation F1 — deliberately not the
          0.5 default.
        </Row>
        <Row index="04" title="What the numbers mean">
          The regression champion predicts log1p(SalePrice); its ~80% price
          range is built from validation residual quantiles — a nominal
          interval, not a 95% confidence interval. The classification target
          is simulated (ADR-3), so those metrics grade consistency with a
          seeded simulation, not the real market.
        </Row>
      </div>

      {info?.rationale && (
        <blockquote className="insights-rationale">
          <span className="insights-rationale-label">
            Champion selection rationale — verbatim from the model registry
          </span>
          {info.rationale}
        </blockquote>
      )}

      <p className="insights-sealed-line">
        The sealed 2010 test set was touched exactly once — for the figures on
        this page.
      </p>
    </div>
  )
}
