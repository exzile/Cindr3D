import { useMemo, useState, type ReactNode } from 'react';
import {
  Search, Check, Download, Settings, Puzzle, Package,
  Cloud, Zap, FileOutput, Wrench,
} from 'lucide-react';
import './SlicerWorkspacePluginsPage.css';

type PluginCategory = 'All' | 'Slicers' | 'Exporters' | 'Post-Processing' | 'Cloud Services' | 'Utilities';

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: Exclude<PluginCategory, 'All'>;
  installedInitially: boolean;
  icon: ReactNode;
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
  return (
    <div className="slicer-workspace-plugin-card">
      <div className="slicer-workspace-plugin-card__header">
        <div className="slicer-workspace-plugin-card__icon-wrap">
          {plugin.icon}
        </div>
        <div className="slicer-workspace-plugin-card__title-area">
          <div className="slicer-workspace-plugin-card__name">{plugin.name}</div>
          <div className="slicer-workspace-plugin-card__desc">{plugin.description}</div>
        </div>
      </div>

      <div className="slicer-workspace-plugin-card__meta">
        <span className="slicer-workspace-plugin-card__version">v{plugin.version}</span>
        <span className="slicer-workspace-plugin-card__author">by {plugin.author}</span>

        {installed ? (
          <>
            <div className="slicer-workspace-plugin-card__installed">
              <Check size={10} />
              Installed
            </div>
            <button className="slicer-workspace-plugin-card__settings" title="Plugin settings">
              <Settings size={12} />
            </button>
          </>
        ) : (
          <button
            className={`slicer-workspace-plugin-card__install ${installing ? 'is-installing' : ''}`}
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

  return (
    <div className="slicer-workspace-plugins-page">
      <div className="slicer-workspace-plugins-page__header">
        <div className="slicer-workspace-plugins-page__title">
          <Puzzle size={22} className="slicer-workspace-plugins-page__title-icon" />
          Plugins
        </div>
        <div className="slicer-workspace-plugins-page__subtitle">Extend your 3D printing workflow</div>
      </div>

      <div className="slicer-workspace-plugins-page__controls">
        <div className="slicer-workspace-plugins-page__search-wrap">
          <Search size={13} className="slicer-workspace-plugins-page__search-icon" />
          <input
            type="text"
            placeholder="Search plugins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="slicer-workspace-plugins-page__search-input"
          />
        </div>
        <div className="slicer-workspace-plugins-page__tabs">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`slicer-workspace-plugins-page__tab ${activeCategory === cat ? 'is-active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {filteredPlugins.length > 0 ? (
        <div className="slicer-workspace-plugins-page__grid">
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
        <div className="slicer-workspace-plugins-page__empty">
          <Package size={36} className="slicer-workspace-plugins-page__empty-icon" />
          <div className="slicer-workspace-plugins-page__empty-title">No plugins found</div>
          <div className="slicer-workspace-plugins-page__empty-subtitle">Try adjusting your search or category filter.</div>
        </div>
      )}
    </div>
  );
}

export default SlicerWorkspacePluginsPage;
