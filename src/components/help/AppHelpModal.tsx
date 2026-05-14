import { BookOpen, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import './AppHelpModal.css';
import { HELP_TOPICS, type HelpTopic } from './helpContent';
import { HelpNav, type NavGroup } from './HelpNav';
import { HelpTopicView } from './HelpTopicView';
import { useTutorialProgress } from './useTutorialProgress';

export function AppHelpModal({ onClose }: { onClose: () => void }) {
  const [activeTopicId, setActiveTopicId] = useState(HELP_TOPICS[0].id);
  const [query, setQuery] = useState('');
  const { progress: tutorialProgress, toggleStep: toggleTutorialStep } = useTutorialProgress();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(['Design', 'Prepare', '3D Printer', 'Reference']),
  );

  const filteredTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return HELP_TOPICS;
    return HELP_TOPICS.filter((topic) => {
      const haystack = [
        topic.title,
        topic.summary,
        topic.group ?? '',
        ...topic.sections.flatMap((section) => [
          section.heading,
          section.intro ?? '',
          section.image?.alt ?? '',
          section.image?.caption ?? '',
          ...(section.items ?? []),
          ...(section.shortcuts ?? []).flatMap((s) => [s.keys, s.action]),
          ...(section.notes ?? []),
        ]),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [query]);

  const groupedNav = useMemo<NavGroup[]>(() => {
    const result: NavGroup[] = [];
    for (const topic of filteredTopics) {
      const g = topic.group ?? null;
      const last = result[result.length - 1];
      if (last && last.group === g) {
        last.topics.push(topic);
      } else {
        result.push({ group: g, topics: [topic] });
      }
    }
    return result;
  }, [filteredTopics]);

  const activeTopic: HelpTopic | undefined =
    filteredTopics.find((topic) => topic.id === activeTopicId) ?? filteredTopics[0];

  // When the user types a search, force every group that has a matching
  // topic open so the matches are reachable without an extra click.
  const visibleExpandedGroups = useMemo(() => {
    if (!query.trim()) return expandedGroups;
    return new Set(filteredTopics.map((t) => t.group).filter(Boolean) as string[]);
  }, [expandedGroups, filteredTopics, query]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <div className="app-help-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="app-help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Help documentation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="app-help-header">
          <div className="app-help-title">
            <BookOpen size={18} />
            <div>
              <h2>Cindr3D Help</h2>
              <p>Reference guide for modelling, slicing, printer fleets, cameras, USB connections, and updates.</p>
            </div>
          </div>
          <button className="app-help-close" onClick={onClose} aria-label="Close help">
            <X size={16} />
          </button>
        </header>

        <div className="app-help-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help"
            autoFocus
          />
        </div>

        <div className="app-help-body">
          <HelpNav
            groups={groupedNav}
            activeTopicId={activeTopic?.id}
            expandedGroups={visibleExpandedGroups}
            filteredCount={filteredTopics.length}
            onSelectTopic={setActiveTopicId}
            onToggleGroup={toggleGroup}
          />

          <HelpTopicView
            topic={activeTopic}
            tutorialProgress={tutorialProgress}
            onToggleTutorialStep={toggleTutorialStep}
          />
        </div>
      </div>
    </div>
  );
}
