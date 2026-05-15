import type { PrintHistoryGroup } from '../../../utils/printHistoryAnalytics';

/** Compact table for "frequently printed" / "frequently failing" rollups. */
export function PatternTable({
  groups,
  empty,
  label,
}: {
  groups: PrintHistoryGroup[];
  empty: string;
  label?: string;
}) {
  return (
    <table className="duet-analytics__table duet-analytics__table--compact">
      {label && (
        <caption className="duet-analytics__caption">{label}</caption>
      )}
      <thead>
        <tr>
          <th>Name</th>
          <th>Runs</th>
          <th>Failures</th>
          <th>Last working</th>
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 && (
          <tr><td colSpan={4} className="duet-analytics__empty-row">{empty}</td></tr>
        )}
        {groups.map((group) => (
          <tr key={group.key}>
            <td className="duet-analytics__file-cell" title={group.label}>{group.label}</td>
            <td>{group.total}</td>
            <td>{group.failureRate.toFixed(0)}%</td>
            <td className="duet-analytics__file-cell" title={group.lastSuccess?.profile ?? group.lastSuccess?.material ?? undefined}>
              {group.lastSuccess?.profile ?? group.lastSuccess?.material ?? '--'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
