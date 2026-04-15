import { FileText, Play } from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  dashboardButtonStyle as btnStyle,
  panelStyle,
  sectionTitleStyle as labelStyle,
} from '../../../utils/printerPanelStyles';

export default function MacroPanel() {
  const macros = usePrinterStore((s) => s.macros);
  const runMacro = usePrinterStore((s) => s.runMacro);

  if (macros.length === 0) return null;

  return (
    <div style={panelStyle()}>
      <div style={labelStyle()} className="duet-dash-section-title-row">
        <FileText size={14} /> Macros
      </div>
      <div className="duet-dash-macro-list">
        {macros
          .filter((m) => m.type === 'f')
          .map((macro) => (
            <button
              key={macro.name}
              style={btnStyle()}
              onClick={() => runMacro(macro.name)}
              title={macro.name}
            >
              <Play size={11} /> {macro.name.replace(/\.g$/i, '')}
            </button>
          ))}
        {macros
          .filter((m) => m.type === 'd')
          .map((dir) => (
            <button
              key={dir.name}
              style={{ ...btnStyle(), opacity: 0.7 }}
              title={`Folder: ${dir.name}`}
              disabled
            >
              {dir.name}/
            </button>
          ))}
      </div>
    </div>
  );
}
