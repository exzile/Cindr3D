/**
 * RecentJobsTable — last 20 jobs in the analytics window with their
 * cost-receipt summary (duration / total / weight / kWh) and outcome
 * status pill.
 *
 * The host passes the resolved jobs list + receipt lookup so this
 * component doesn't have to know how either was built.
 */
import type { PrintCostEstimate } from '../../../utils/printCost';
import type { PrintHistoryJob } from '../../../utils/printHistoryAnalytics';
import { printJobCostKey } from '../../../utils/printCost';
import { fmtDate, fmtDuration, fmtMoney, fmtWeight } from './helpers';

export interface RecentJobsTableProps {
  jobs: PrintHistoryJob[];
  receiptsByJob: Map<string, PrintCostEstimate>;
}

export function RecentJobsTable({ jobs, receiptsByJob }: RecentJobsTableProps) {
  return (
    <>
      <div className="duet-analytics__section-title">Recent jobs</div>
      <table className="duet-analytics__table">
        <thead>
          <tr>
            <th>Started</th>
            <th>File</th>
            <th>Duration</th>
            <th>Receipt</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.slice(0, 20).map((j, i) => {
            const receipt = receiptsByJob.get(printJobCostKey(j));
            return (
              <tr key={printJobCostKey(j) || `${j.file}-${i}`}>
                <td>{fmtDate(j.startedAt)} {j.startedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="duet-analytics__file-cell" title={j.file}>{j.file}</td>
                <td>{fmtDuration(receipt?.durationSec ?? j.durationSec)}</td>
                <td>
                  {receipt ? `${fmtMoney(receipt.totalCost)} · ${fmtWeight(receipt.filamentG)} · ${receipt.energyKwh.toFixed(2)} kWh` : '--'}
                </td>
                <td>
                  <span className={`duet-analytics__status duet-analytics__status--${j.outcome}`}>
                    {j.outcome}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
