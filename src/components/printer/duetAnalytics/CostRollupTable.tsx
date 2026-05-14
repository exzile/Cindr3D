import type { PrintCostRollup } from '../../../utils/printCost';
import { fmtMoney, fmtWeight } from './helpers';

/** Compact table for cost-by-{file,object,profile,material} rollups. */
export function CostRollupTable({
  rows,
  empty,
  label,
}: {
  rows: PrintCostRollup[];
  empty: string;
  label: string;
}) {
  return (
    <table className="duet-analytics__table duet-analytics__table--compact">
      <caption className="duet-analytics__caption">{label}</caption>
      <thead>
        <tr>
          <th>Name</th>
          <th>Runs</th>
          <th>Filament</th>
          <th>Energy</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={5} className="duet-analytics__empty-row">{empty}</td></tr>
        )}
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="duet-analytics__file-cell" title={row.label}>{row.label}</td>
            <td>{row.runs}</td>
            <td>{fmtWeight(row.filamentG)}</td>
            <td>{row.energyKwh.toFixed(2)} kWh</td>
            <td>{fmtMoney(row.totalCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
