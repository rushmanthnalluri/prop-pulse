/**
 * ClusterRail (SPEC §5.3): the micro-market cards beside the map — a thin
 * wrapper around shared/ClusterCard in toggle mode (keeps the card itself
 * backward-compatible for Overview). Clicking a card selects the market
 * (fly-to + profile panel); clicking the active card again clears the
 * selection.
 */
import ClusterCard from '../shared/ClusterCard'

export default function ClusterRail({ clusters, activeClusterId, onSelect }) {
  if (!Array.isArray(clusters) || clusters.length === 0) return null
  return (
    <div className="cluster-rail" role="group" aria-label="Micro-markets">
      {clusters.map((cluster) => (
        <ClusterCard
          key={cluster.cluster_id}
          cluster={cluster}
          active={activeClusterId === cluster.cluster_id}
          onClick={() =>
            onSelect?.(activeClusterId === cluster.cluster_id ? null : cluster.cluster_id)
          }
        />
      ))}
    </div>
  )
}
