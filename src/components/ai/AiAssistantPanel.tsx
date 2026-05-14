import { Bot, GripHorizontal, X } from 'lucide-react';
import { useAiAssistantStore } from '../../store/aiAssistantStore';
import { ChatTab } from './aiAssistant/ChatTab';
import { McpTab } from './aiAssistant/McpTab';
import { usePanelGeometry } from './aiAssistant/usePanelGeometry';
import './AiAssistantPanel.css';

export default function AiAssistantPanel() {
  const panelOpen = useAiAssistantStore((s) => s.panelOpen);
  const activeTab = useAiAssistantStore((s) => s.activeTab);
  const setPanelOpen = useAiAssistantStore((s) => s.setPanelOpen);
  const setActiveTab = useAiAssistantStore((s) => s.setActiveTab);
  const { geometry, beginMove, beginResize } = usePanelGeometry(panelOpen);

  if (!panelOpen) return null;

  return (
    <div
      className="ai-panel"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <div className="ai-panel-header">
        <div className="ai-panel-drag-region" onPointerDown={beginMove} title="Drag AI Assistant">
          <Bot size={15} className="ai-panel-icon" />
          <span className="ai-panel-title">AI Assistant</span>
          <GripHorizontal size={14} className="ai-panel-grip" />
        </div>
        <div className="ai-panel-tabs" role="tablist" aria-label="AI assistant sections">
          <button
            type="button"
            className={`ai-tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
            role="tab"
            aria-selected={activeTab === 'mcp'}
          >
            MCP
          </button>
          <button
            type="button"
            className={`ai-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
            role="tab"
            aria-selected={activeTab === 'chat'}
          >
            Chat
          </button>
        </div>
        <button type="button" className="ai-panel-close" onClick={() => setPanelOpen(false)} title="Close" aria-label="Close AI Assistant">
          <X size={14} />
        </button>
      </div>

      {activeTab === 'mcp' ? <McpTab /> : <ChatTab />}
      <button
        type="button"
        className="ai-panel-resize"
        onPointerDown={beginResize}
        title="Resize AI Assistant"
        aria-label="Resize AI Assistant"
      />
    </div>
  );
}
