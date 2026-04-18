import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Save, RotateCcw, SaveAll, Loader2 } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DuetFileEditorProps {
  filePath: string;
  onClose: () => void;
  /** When true, start with an empty editor instead of loading from disk. */
  isNew?: boolean;
}

// ---------------------------------------------------------------------------
// Syntax highlighting for G-code
// ---------------------------------------------------------------------------

function highlightGCode(text: string): string {
  // Process line by line so comments take priority
  return text
    .split('\n')
    .map((line) => {
      // Check for full-line comment
      const commentIdx = line.indexOf(';');
      let code = line;
      let comment = '';
      if (commentIdx >= 0) {
        code = line.substring(0, commentIdx);
        comment = line.substring(commentIdx);
      }

      // Highlight code portion
      let highlighted = code
        // G-codes: G followed by digits (possibly with decimal)
        .replace(/\b(G\d+(\.\d+)?)\b/gi, '<span style="color:#4dd0e1">$1</span>')
        // M-codes: M followed by digits
        .replace(/\b(M\d+(\.\d+)?)\b/gi, '<span style="color:#ffd54f">$1</span>')
        // Parameters: letter followed by number (S100, F6000, X10.5, etc.)
        .replace(/\b([SFXYZEPRT])(-?\d+(\.\d+)?)\b/gi, '<span style="color:#ffab40">$1$2</span>')
        // Standalone numbers (not already colored)
        .replace(/(?<!<[^>]*)(?<![a-zA-Z"])(-?\d+\.?\d*)/g, '<span style="color:#81d4fa">$1</span>');

      // Highlight comment portion
      if (comment) {
        highlighted += `<span style="color:#66bb6a">${escapeHtml(comment)}</span>`;
      }

      return highlighted;
    })
    .join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const editorStyles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    backgroundColor: '#1e1e1e',
    border: '1px solid #444',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    width: '85vw',
    height: '80vh',
    maxWidth: 1100,
    maxHeight: 800,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #333',
    gap: 12,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e0e0e0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  },
  headerPath: {
    fontSize: 11,
    color: '#888',
    marginLeft: 8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  headerBtns: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexShrink: 0,
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    background: '#353535',
    color: '#ccc',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnPrimary: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    fontSize: 12,
    border: 'none',
    borderRadius: 4,
    background: '#0078d4',
    color: '#fff',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnDanger: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    fontSize: 12,
    border: '1px solid #555',
    borderRadius: 4,
    background: '#353535',
    color: '#ef5350',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  editorContainer: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative' as const,
  },
  lineNumbers: {
    width: 50,
    backgroundColor: '#1a1a1a',
    borderRight: '1px solid #333',
    overflow: 'hidden',
    padding: '10px 0',
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
    fontSize: 13,
    lineHeight: '20px',
    color: '#555',
    textAlign: 'right' as const,
    userSelect: 'none' as const,
    flexShrink: 0,
  },
  lineNumber: {
    paddingRight: 8,
    paddingLeft: 4,
    height: 20,
    lineHeight: '20px',
  },
  textareaWrapper: {
    flex: 1,
    position: 'relative' as const,
    overflow: 'hidden',
  },
  textarea: {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    padding: '10px 12px',
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
    fontSize: 13,
    lineHeight: '20px',
    backgroundColor: 'transparent',
    color: '#d4d4d4',
    border: 'none',
    outline: 'none',
    resize: 'none' as const,
    whiteSpace: 'pre' as const,
    overflowWrap: 'normal' as const,
    overflow: 'auto',
    zIndex: 2,
    caretColor: '#fff',
    boxSizing: 'border-box' as const,
    tabSize: 4,
  },
  highlightPre: {
    position: 'absolute' as const,
    inset: 0,
    padding: '10px 12px',
    fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
    fontSize: 13,
    lineHeight: '20px',
    color: 'transparent',
    whiteSpace: 'pre' as const,
    overflowWrap: 'normal' as const,
    overflow: 'auto',
    pointerEvents: 'none' as const,
    zIndex: 1,
    boxSizing: 'border-box' as const,
    tabSize: 4,
    margin: 0,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 16px',
    backgroundColor: '#252526',
    borderTop: '1px solid #333',
    fontSize: 11,
    color: '#888',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#888',
    gap: 8,
    fontSize: 14,
  },
  saveAsOverlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3000,
  },
  saveAsDialog: {
    backgroundColor: '#2d2d2d',
    border: '1px solid #555',
    borderRadius: 6,
    padding: 20,
    minWidth: 400,
    color: '#ccc',
  },
  saveAsTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
  },
  saveAsInput: {
    width: '100%',
    padding: '6px 8px',
    fontSize: 13,
    border: '1px solid #555',
    borderRadius: 4,
    backgroundColor: '#1e1e1e',
    color: '#ccc',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  saveAsBtns: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  unsavedDot: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: '#ffab40',
    marginLeft: 8,
    verticalAlign: 'middle',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetFileEditor({ filePath, onClose, isNew = false }: DuetFileEditorProps) {
  const service = usePrinterStore((s) => s.service);
  const setError = usePrinterStore((s) => s.setError);

  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsPath, setSaveAsPath] = useState(filePath);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const fileName = filePath.split('/').pop() || filePath;
  const hasChanges = content !== originalContent;

  // Line count
  const lineCount = useMemo(() => content.split('\n').length, [content]);

  // Highlighted HTML
  const highlightedHtml = useMemo(() => highlightGCode(escapeHtml(content)), [content]);

  // Fetch file contents on mount (skip when creating a new file)
  useEffect(() => {
    if (isNew) {
      setContent('');
      setOriginalContent('');
      setLoading(false);
      return;
    }
    if (!service) return;
    let cancelled = false;

    async function loadFile() {
      setLoading(true);
      try {
        const blob = await service!.downloadFile(filePath);
        const text = await blob.text();
        if (!cancelled) {
          setContent(text);
          setOriginalContent(text);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Failed to load file: ${(err as Error).message}`);
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFile();
    return () => {
      cancelled = true;
    };
  }, [service, filePath, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync scroll between textarea, line numbers, and highlight overlay
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = ta.scrollTop;
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Save
  const handleSave = useCallback(async () => {
    if (!service) return;
    setSaving(true);
    try {
      const blob = new Blob([content], { type: 'application/octet-stream' });
      await service.uploadFile(filePath, blob);
      setOriginalContent(content);
    } catch (err) {
      setError(`Failed to save file: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [service, filePath, content, setError]);

  // Save As
  const handleSaveAs = useCallback(
    async (targetPath: string) => {
      if (!service) return;
      setShowSaveAs(false);
      setSaving(true);
      try {
        const blob = new Blob([content], { type: 'application/octet-stream' });
        await service.uploadFile(targetPath, blob);
        setOriginalContent(content);
      } catch (err) {
        setError(`Failed to save file: ${(err as Error).message}`);
      } finally {
        setSaving(false);
      }
    },
    [service, content, setError],
  );

  // Revert
  const handleRevert = useCallback(() => {
    if (hasChanges && !confirm('Discard all changes and revert to original?')) return;
    setContent(originalContent);
  }, [hasChanges, originalContent]);

  // Close with unsaved changes warning
  const handleClose = useCallback(() => {
    if (hasChanges && !confirm('You have unsaved changes. Close anyway?')) return;
    onClose();
  }, [hasChanges, onClose]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          setShowSaveAs(true);
          setSaveAsPath(filePath);
        } else {
          handleSave();
        }
      }
      // Tab key inserts spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target as HTMLTextAreaElement;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newContent = content.substring(0, start) + '  ' + content.substring(end);
        setContent(newContent);
        // Restore cursor position after state update
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
    },
    [content, filePath, handleSave],
  );

  // Compute file size
  const fileSize = useMemo(() => new Blob([content]).size, [content]);
  const charCount = content.length;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={editorStyles.overlay} onClick={handleClose}>
      <div style={editorStyles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={editorStyles.header}>
          <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden' }}>
            <span style={editorStyles.headerTitle}>
              {fileName}
              {hasChanges && <span style={editorStyles.unsavedDot} title="Unsaved changes" />}
            </span>
            <span style={editorStyles.headerPath}>{filePath}</span>
          </div>
          <div style={editorStyles.headerBtns}>
            <button
              style={editorStyles.btnPrimary}
              onClick={handleSave}
              disabled={saving || !hasChanges}
              title="Save (Ctrl+S)"
            >
              {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
              Save
            </button>
            <button
              style={editorStyles.btn}
              onClick={() => {
                setShowSaveAs(true);
                setSaveAsPath(filePath);
              }}
              disabled={saving}
              title="Save As (Ctrl+Shift+S)"
            >
              <SaveAll size={13} />
              Save As
            </button>
            <button
              style={editorStyles.btn}
              onClick={handleRevert}
              disabled={!hasChanges}
              title="Revert to original"
            >
              <RotateCcw size={13} />
              Revert
            </button>
            <button style={editorStyles.btnDanger} onClick={handleClose} title="Close">
              <X size={13} />
              Close
            </button>
          </div>
        </div>

        {/* Editor body */}
        {loading ? (
          <div style={editorStyles.loading}>
            <Loader2 size={18} className="spin" />
            Loading file...
          </div>
        ) : (
          <div style={editorStyles.editorContainer}>
            {/* Line numbers */}
            <div ref={lineNumbersRef} style={editorStyles.lineNumbers}>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} style={editorStyles.lineNumber}>
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Textarea with syntax highlighting overlay */}
            <div style={editorStyles.textareaWrapper}>
              <pre
                ref={highlightRef}
                style={editorStyles.highlightPre}
                dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }}
                aria-hidden
              />
              <textarea
                ref={textareaRef}
                style={{
                  ...editorStyles.textarea,
                  color: 'transparent',
                  WebkitTextFillColor: 'transparent',
                }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={editorStyles.footer}>
          <span>
            {lineCount} lines &middot; {charCount.toLocaleString()} chars &middot;{' '}
            {formatSize(fileSize)}
          </span>
          <span>
            {hasChanges ? 'Modified' : 'Saved'} &middot; {fileName}
          </span>
        </div>
      </div>

      {/* Save As dialog */}
      {showSaveAs && (
        <div style={editorStyles.saveAsOverlay} onClick={() => setShowSaveAs(false)}>
          <div style={editorStyles.saveAsDialog} onClick={(e) => e.stopPropagation()}>
            <div style={editorStyles.saveAsTitle}>Save As</div>
            <input
              style={editorStyles.saveAsInput}
              value={saveAsPath}
              onChange={(e) => setSaveAsPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveAsPath.trim()) handleSaveAs(saveAsPath.trim());
                if (e.key === 'Escape') setShowSaveAs(false);
              }}
              autoFocus
              placeholder="Full file path (e.g. 0:/sys/config.g)"
            />
            <div style={editorStyles.saveAsBtns}>
              <button style={editorStyles.btn} onClick={() => setShowSaveAs(false)}>
                Cancel
              </button>
              <button
                style={editorStyles.btnPrimary}
                onClick={() => saveAsPath.trim() && handleSaveAs(saveAsPath.trim())}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
