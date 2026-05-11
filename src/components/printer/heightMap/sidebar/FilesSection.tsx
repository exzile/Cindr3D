import { FolderOpen, GitCompareArrows, Loader2, RefreshCw, X } from 'lucide-react';
import type { DuetHeightMap as HeightMapData } from '../../../../types/duet';

/** Files + Compare section in the heightmap sidebar. */
export function FilesSection({
  selectedCsv,
  setSelectedCsv,
  csvFiles,
  loadingCsvList,
  refreshCsvList,
  compareMode,
  compareCsv,
  loadingCompare,
  handleLoadCompare,
  heightMap,
  exitCompare,
}: {
  selectedCsv: string;
  setSelectedCsv: (path: string) => void;
  csvFiles: string[];
  loadingCsvList: boolean;
  refreshCsvList: () => Promise<void>;
  compareMode: boolean;
  compareCsv: string;
  loadingCompare: boolean;
  handleLoadCompare: (path: string) => Promise<void>;
  heightMap: HeightMapData | null;
  exitCompare: () => void;
}) {
  return (
    <div className="hm-side-section">
      <div className="hm-side-title">Files</div>

      <div className="hm-file-row">
        <span title="Height map files on the printer (0:/sys/*.csv)">
          <FolderOpen size={12} className="hm-icon-muted" />
        </span>
        <select
          className="hm-select hm-select--fill"
          value={selectedCsv}
          onChange={(e) => setSelectedCsv(e.target.value)}
          disabled={loadingCsvList || csvFiles.length === 0}
          title="Select a height map CSV file from the printer filesystem — click Load to apply"
        >
          {csvFiles.length === 0 && <option value="0:/sys/heightmap.csv">heightmap.csv</option>}
          {csvFiles.map((file) => <option key={file} value={`0:/sys/${file}`}>{file}</option>)}
        </select>
        <button className="hm-icon-btn" onClick={() => void refreshCsvList()} disabled={loadingCsvList} title="Refresh file list from printer">
          {loadingCsvList ? <Loader2 size={11} className="hm-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>

      <div className="hm-subsection-label"><GitCompareArrows size={9} />Compare</div>

      {!compareMode ? (
        <div className="hm-file-row">
          <select
            className="hm-select hm-select--fill"
            value=""
            onChange={(e) => { if (e.target.value) void handleLoadCompare(e.target.value); }}
            disabled={!heightMap || loadingCompare || csvFiles.length === 0}
            title="Load a second height map and overlay the difference — useful for comparing before/after calibration"
          >
            <option value="">Compare with…</option>
            {csvFiles.filter((f) => `0:/sys/${f}` !== selectedCsv).map((f) => <option key={f} value={`0:/sys/${f}`}>{f}</option>)}
          </select>
          {loadingCompare && <Loader2 size={11} className="hm-spin hm-icon-muted" />}
        </div>
      ) : (
        <div className="hm-side-compare-active">
          <span className="hm-side-compare-label">{compareCsv.split('/').pop()}</span>
          <button className="hm-btn hm-btn--warning hm-full-btn" onClick={exitCompare}>
            <X size={11} /> Exit Compare
          </button>
        </div>
      )}
    </div>
  );
}
