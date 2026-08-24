/**
 * VizStage (WORKFLOW §6.3-05, blueprint §8.6) — stage 05 of the guided
 * workbench, rebuilt as the reference's sectioned visualize page. The page
 * chrome (head + provenance banner) lives here; the sectioned explorer
 * itself (sticky .viz-nav, histogram grid, correlation heat map, category
 * bars, scatter) lives in `components/workflow/VizExplorer.jsx`.
 *
 * Defaults on entry (§6.3-05): SalePrice-led histogram grid · correlation
 * top-20 on the regression target · GrLivArea×SalePrice scatter — each
 * falling back to the dataset's own columns when the Ames names are absent.
 */
import { formatNumber } from '../../format'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import VizExplorer from '../../components/workflow/VizExplorer'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-viz.css'

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
      <header className="page-head">
        <span className="kicker">Stage 05 · Records</span>
        <h1 className="page-title">Visualization</h1>
        <p className="page-desc">
          Distributions, correlations, categories, and relationships — the shape of the active
          dataset, made visible. Every chart is aggregated on the server: the browser receives
          plot-ready bins, points, and matrices, never the raw frame.
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </header>

      <hr className="divider" />

      <div className="wf-banner-slot">
        <ProvenanceBanner
          provenance={{ dataset_name: dataset?.name ?? datasetId }}
          label="Charts aggregate the active dataset — switch it from the dataset chip above."
        />
      </div>

      <VizExplorer datasetId={datasetId} />
    </div>
  )
}
