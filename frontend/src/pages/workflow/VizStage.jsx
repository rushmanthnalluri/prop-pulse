/**
 * VizStage (WORKFLOW §6.3-05) — stage 05 of the guided workbench. The page
 * chrome + data context; the explorer itself (controls, debounced fetches of
 * the §3.7 pre-aggregated payloads, chart renderers, a11y tables) lives in
 * `components/workflow/VizExplorer.jsx`.
 *
 * Defaults on entry (§6.3-05): SalePrice histogram · GrLivArea×SalePrice
 * scatter · correlation top-20.
 */
import { formatNumber } from '../../format'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import VizExplorer from '../../components/workflow/VizExplorer'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-eda.css'

export default function VizStage() {
  const { datasetId, dataset } = useWorkflow()
  const metaParts = dataset
    ? [
        dataset.name,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 05 · Visualization</span>
        <h1 className="page-title">Visualization</h1>
        <p className="page-desc">
          Distributions, relationships, and group comparisons of the active dataset. Every chart
          is aggregated on the server — the browser receives plot-ready bins, points, and
          matrices, never the raw frame.
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      <div className="wfe-banner-slot">
        <ProvenanceBanner
          provenance={{ dataset_name: dataset?.name ?? datasetId }}
          label="Charts aggregate the active dataset — switch it from the dataset chip above."
        />
      </div>

      <div className="section">
        <div className="section-head">
          <span className="section-title">Chart explorer</span>
          <span className="section-note">pre-aggregated payloads · no client-side math</span>
        </div>
        <VizExplorer datasetId={datasetId} />
      </div>
    </div>
  )
}
