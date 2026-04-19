import { FileText, Play, Folder } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

export default function MacroPanel() {
  const macros  = usePrinterStore((s) => s.macros);
  const runMacro = usePrinterStore((s) => s.runMacro);

  const files = macros.filter((m) => m.type === 'f');
  const dirs  = macros.filter((m) => m.type === 'd');

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <FileText size={14} /> Macros
      </div>

      {macros.length === 0 && (
        <div className="mc-empty">No macros found</div>
      )}

      {dirs.length > 0 && (
        <div className="mc-grid" style={{ marginBottom: 8 }}>
          {dirs.map((dir) => (
            <button key={dir.name} className="mc-btn mc-btn--dir" disabled title={`Folder: ${dir.name}`}>
              <Folder size={11} />
              <span className="mc-btn-name">{dir.name}/</span>
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mc-grid">
          {files.map((macro) => (
            <button
              key={macro.name}
              className="mc-btn"
              onClick={() => runMacro(macro.name)}
              title={macro.name}
            >
              <Play size={10} />
              <span className="mc-btn-name">{macro.name.replace(/\.g$/i, '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
