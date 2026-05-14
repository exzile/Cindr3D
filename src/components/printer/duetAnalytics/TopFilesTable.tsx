/**
 * TopFilesTable — most-printed g-code files in the analytics window
 * (file path / run count / total time). Driven by the stats.topFiles
 * tuple list computed on the host.
 */
import { Award } from 'lucide-react';
import { fmtDuration } from './helpers';

export interface TopFilesEntry { count: number; time: number }
export type TopFilesRow = [string, TopFilesEntry];

export function TopFilesTable({ rows }: { rows: TopFilesRow[] }) {
  return (
    <>
      <div className="duet-analytics__section-title">
        <Award size={11} /> Most-printed files
      </div>
      <table className="duet-analytics__table">
        <thead>
          <tr>
            <th>File</th>
            <th>Runs</th>
            <th>Total time</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="duet-analytics__empty-row">No jobs in window.</td></tr>
          )}
          {rows.map(([file, v]) => (
            <tr key={file}>
              <td title={file} className="duet-analytics__file-cell">{file}</td>
              <td>{v.count}</td>
              <td>{fmtDuration(v.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
