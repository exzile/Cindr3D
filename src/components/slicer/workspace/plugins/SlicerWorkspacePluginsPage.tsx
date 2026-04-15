import React, { useState, useMemo } from 'react';
import {
  Search, Check, Download, Settings, Puzzle, Package,
  Cloud, Zap, FileOutput, Wrench,
} from 'lucide-react';
import { colors, sharedStyles } from '../../../../utils/theme';

type PluginCategory = 'All' | 'Slicers' | 'Exporters' | 'Post-Processing' | 'Cloud Services' | 'Utilities';

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: Exclude<PluginCategory, 'All'>;
  installedInitially: boolean;
  icon: React.ReactNode;
}

const PLUGIN_DATA: PluginEntry[] = [
  {
    id: 'cura',
    name: 'Cura Integration',
    description: 'Export directly to Ultimaker Cura with optimal print settings',
    version: '2.1.0',
    author: 'Ultimaker',
    category: 'Slicers',
    installedInitially: true,
    icon: <Puzzle size={22} />,
  },
  {
    id: 'prusaslicer',
    name: 'PrusaSlicer Bridge',
    description: 'One-click export to PrusaSlicer with profile sync',
    version: '1.4.2',
    author: 'Prusa Research',
    category: 'Slicers',
    installedInitially: false,
    icon: <Puzzle size={22} />,
  },
  {
    id: 'stl-optimizer',
    name: 'STL Optimizer',
    description: 'Reduce mesh complexity while preserving print quality',
    version: '3.0.1',
    author: 'Open Source',
    category: 'Utilities',
    installedInitially: false,
    icon: <Wrench size={22} />,
  },
  {
    id: 'octoprint',
    name: 'OctoPrint Connect',
    description: 'Send prints directly to your OctoPrint server',
    version: '1.2.0',
    author: 'OctoPrint',
    category: 'Cloud Services',
    installedInitially: false,
    icon: <Cloud size={22} />,
  },
  {
    id: 'gcode-analyzer',
    name: 'G-Code Analyzer',
    description: 'Visualize and optimize G-code before printing',
    version: '2.3.0',
    author: 'Community',
    category: 'Post-Processing',
    installedInitially: true,
    icon: <Zap size={22} />,
  },
  {
    id: '3mf-exporter',
    name: '3MF Exporter',
    description: 'Export to 3MF format with full metadata support',
    version: '1.0.5',
    author: 'DesignCAD Team',
    category: 'Exporters',
    installedInitially: true,
    icon: <FileOutput size={22} />,
  },
];

const CATEGORIES: PluginCategory[] = [
  'All', 'Slicers', 'Exporters', 'Post-Processing', 'Cloud Services', 'Utilities',
];

interface PluginCardProps {
  plugin: PluginEntry;
  installed: boolean;
  installing: boolean;
  onInstall: (id: string) => void;
}

function PluginCard({ plugin, installed, installing, onInstall }: PluginCardProps) {
  const cardStyle: React.CSSProperties = {
    background: colors.elevated,
    border: `1px solid ${colors.panelBorder}`,
    borderRadius: 8,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    transition: 'border-color 0.15s',
    position: 'relative',
  };

  const iconWrapStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 8,
    background: colors.panelLight,
    border: `1px solid ${colors.panelBorder}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.accent,
    flexShrink: 0,
  };

  const headerRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  };

  const titleAreaStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  const nameStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: colors.text,
    marginBottom: 2,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const descStyle: React.CSSProperties = {
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 1.5,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
  };

  const metaRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap' as const,
  };

  const versionBadgeStyle: React.CSSProperties = {
    background: colors.panelLight,
    border: `1px solid ${colors.panelBorder}`,
    borderRadius: 3,
    padding: '1px 6px',
    fontSize: 10,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  };

  const authorStyle: React.CSSProperties = {
    fontSize: 11,
    color: colors.textDim,
  };

  const installedBadgeStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    background: 'rgba(34, 197, 94, 0.12)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    borderRadius: 4,
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 600,
    color: '#22c55e',
    marginLeft: 'auto',
  };

  const installBtnStyle: React.CSSProperties = {
    ...sharedStyles.btnAccent,
    fontSize: 11,
    padding: '4px 12px',
    marginLeft: 'auto',
    opacity: installing ? 0.7 : 1,
    cursor: installing ? 'not-allowed' : 'pointer',
  };

  const settingsBtnStyle: React.CSSProperties = {
    ...sharedStyles.btnBase,
    fontSize: 11,
    padding: '4px 8px',
    flexShrink: 0,
  };

  return (
    <div style={cardStyle}>
      <div style={headerRowStyle}>
        <div style={iconWrapStyle}>
          {plugin.icon}
        </div>
        <div style={titleAreaStyle}>
          <div style={nameStyle}>{plugin.name}</div>
          <div style={descStyle}>{plugin.description}</div>
        </div>
      </div>

      <div style={metaRowStyle}>
        <span style={versionBadgeStyle}>v{plugin.version}</span>
        <span style={authorStyle}>by {plugin.author}</span>

        {installed ? (
          <>
            <div style={installedBadgeStyle}>
              <Check size={10} />
              Installed
            </div>
            <button style={settingsBtnStyle} title="Plugin settings">
              <Settings size={12} />
            </button>
          </>
        ) : (
          <button
            style={installBtnStyle}
            onClick={() => !installing && onInstall(plugin.id)}
            disabled={installing}
          >
            {installing ? (
              <>
                <Package size={11} />
                Installing…
              </>
            ) : (
              <>
                <Download size={11} />
                Install
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function SlicerWorkspacePluginsPage() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<PluginCategory>('All');
  const [installedIds, setInstalledIds] = useState<Set<string>>(
    () => new Set(PLUGIN_DATA.filter((p) => p.installedInitially).map((p) => p.id)),
  );
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());

  const handleInstall = (id: string) => {
    setInstallingIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setInstalledIds((prev) => new Set([...prev, id]));
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1000);
  };

  const filteredPlugins = useMemo(() => {
    const q = search.toLowerCase();
    return PLUGIN_DATA.filter((p) => {
      const matchesCategory = activeCategory === 'All' || p.category === activeCategory;
      const matchesSearch =
        q === '' ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [search, activeCategory]);

  const pageStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '20px 24px 16px',
    borderBottom: `1px solid ${colors.panelBorder}`,
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: colors.text,
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: 12,
    color: colors.textDim,
  };

  const controlsBarStyle: React.CSSProperties = {
    padding: '12px 24px',
    borderBottom: `1px solid ${colors.panelBorder}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    flexShrink: 0,
  };

  const searchWrapStyle: React.CSSProperties = {
    position: 'relative',
    maxWidth: 380,
  };

  const searchIconStyle: React.CSSProperties = {
    position: 'absolute',
    left: 9,
    top: '50%',
    transform: 'translateY(-50%)',
    color: colors.textDim,
    pointerEvents: 'none',
  };

  const searchInputStyle: React.CSSProperties = {
    ...sharedStyles.input,
    paddingLeft: 30,
    fontSize: 12,
    height: 30,
  };

  const tabsRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? colors.accent : colors.elevated,
    color: active ? '#fff' : colors.textSecondary,
    border: `1px solid ${active ? colors.accent : colors.panelBorder}`,
    borderRadius: 5,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
  });

  const gridStyle: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12,
    alignContent: 'start',
  };

  const emptyStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.textDim,
    gap: 10,
    padding: 40,
  };

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div style={titleStyle}>
          <Puzzle size={22} color={colors.accent} />
          Plugins
        </div>
        <div style={subtitleStyle}>Extend your 3D printing workflow</div>
      </div>

      <div style={controlsBarStyle}>
        <div style={searchWrapStyle}>
          <Search size={13} style={searchIconStyle} />
          <input
            type="text"
            placeholder="Search plugins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInputStyle}
          />
        </div>
        <div style={tabsRowStyle}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              style={tabStyle(activeCategory === cat)}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filteredPlugins.length > 0 ? (
        <div style={gridStyle}>
          {filteredPlugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              installed={installedIds.has(plugin.id)}
              installing={installingIds.has(plugin.id)}
              onInstall={handleInstall}
            />
          ))}
        </div>
      ) : (
        <div style={emptyStyle}>
          <Package size={36} style={{ opacity: 0.35 }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>No plugins found</div>
          <div style={{ fontSize: 11 }}>Try adjusting your search or category filter.</div>
        </div>
      )}
    </div>
  );
}

export default SlicerWorkspacePluginsPage;
