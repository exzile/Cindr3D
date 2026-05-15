import { ChevronDown } from 'lucide-react';
import { Fragment } from 'react';
import type { HelpTopic } from './helpContent';

export interface NavGroup {
  group: string | null;
  topics: HelpTopic[];
}

export function HelpNav({
  groups,
  activeTopicId,
  expandedGroups,
  filteredCount,
  onSelectTopic,
  onToggleGroup,
}: {
  groups: NavGroup[];
  activeTopicId: string | undefined;
  expandedGroups: Set<string>;
  filteredCount: number;
  onSelectTopic: (id: string) => void;
  onToggleGroup: (group: string) => void;
}) {
  return (
    <nav className="app-help-nav" aria-label="Help topics">
      {groups.map(({ group, topics }) =>
        group === null ? (
          // Ungrouped topics (Getting started) — always visible
          <Fragment key="ungrouped">
            {topics.map((topic) => (
              <button
                key={topic.id}
                className={`app-help-topic-btn${topic.id === activeTopicId ? ' active' : ''}`}
                onClick={() => onSelectTopic(topic.id)}
              >
                <span>{topic.title}</span>
                <small>{topic.summary}</small>
              </button>
            ))}
          </Fragment>
        ) : (
          // Collapsible group section
          <div key={group} className="app-help-group">
            <button
              className={`app-help-group-header${expandedGroups.has(group) ? ' open' : ''}`}
              onClick={() => onToggleGroup(group)}
              aria-expanded={expandedGroups.has(group)}
            >
              <span>{group}</span>
              <ChevronDown size={13} className="app-help-group-chevron" />
            </button>
            {expandedGroups.has(group) && (
              <div className="app-help-group-items">
                {topics.map((topic) => (
                  <button
                    key={topic.id}
                    className={`app-help-topic-btn${topic.id === activeTopicId ? ' active' : ''}`}
                    onClick={() => onSelectTopic(topic.id)}
                  >
                    <span>{topic.title}</span>
                    <small>{topic.summary}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      )}
      {filteredCount === 0 && (
        <div className="app-help-empty">No help topics match that search.</div>
      )}
    </nav>
  );
}
