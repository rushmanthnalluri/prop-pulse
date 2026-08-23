/**
 * Methodology (SPEC §5.4-7, §1.3): how the champions were trained and judged,
 * told as a numbered narrative. The split sizes (945 train, 338 val, 175
 * sealed test) and the model-metadata values below are stable data-contract
 * facts (CONTRACT §4) held in constants.js — contract constants, not live API
 * values. When GET /model/info is loaded, its live metadata is preferred and
 * the val/test sizes are derived from its confusion matrices; the contract
 * constants fill in only while the API is down, so this section still teaches
 * then. The champion-selection rationale renders verbatim from the API when
 * present.
 */
import { MODEL_INFO_FALLBACKS, SPLIT_CONTRACT } from '../../constants'
import { confusionTotal } from '../../utils/splits'

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
  // Live payload preferred; the constants.js values are contract fallbacks
  // shown only while GET /model/info is down.
  const nFeatures = info?.n_features ?? MODEL_INFO_FALLBACKS.nFeatures
  const dataset = info?.dataset_version || MODEL_INFO_FALLBACKS.dataset
  const featureVersion = info?.feature_version || MODEL_INFO_FALLBACKS.featureVersion
  const nClusters = info?.clustering?.n_clusters ?? MODEL_INFO_FALLBACKS.nClusters
  // The payload has no split sizes — derive val/test from the confusion
  // matrices (real split counts), else the contract constants.
  const valCount =
    confusionTotal(info?.classification?.val_metrics?.confusion_matrix) ?? SPLIT_CONTRACT.val
  const testCount =
    confusionTotal(info?.classification?.test_metrics?.confusion_matrix) ?? SPLIT_CONTRACT.test

  return (
    <div className="insights-prose">
      <div className="row-list">
        <Row index="01" title="The data">
          {SPLIT_CONTRACT.train} training sales from Ames, Iowa, sold 2006H1–2008H2 across 25
          neighborhoods, grouped into {nClusters} micro-markets and expanded to{' '}
          {nFeatures} model features (79 raw columns + 15 engineered). Dataset{' '}
          {dataset} · feature_version {featureVersion}.
        </Row>
        <Row index="02" title="A time-based split, never shuffled">
          Train = sales through 2008 ({SPLIT_CONTRACT.train} rows), validation = 2009 ({valCount}),
          sealed test = 2010 ({testCount}). Every metric on this page is an
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
          The regression champion predicts log-transformed sale price; its
          ~80% price range is built from validation residual quantiles — a
          nominal interval, not a 95% confidence interval. The classification
          target is simulated, so those metrics grade consistency with a
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
