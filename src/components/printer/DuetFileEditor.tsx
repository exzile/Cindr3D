import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Save, RotateCcw, SaveAll, Loader2 } from 'lucide-react';
import { usePrinterStore } from '../../store/printerStore';
import { DuetInsertCommandMenu } from './config/DuetInsertCommandMenu';
import { highlightGCode, escapeHtml, formatSize } from './duetFileEditor/helpers';
import { editorStyles } from './duetFileEditor/styles';
import { SaveAsDialog } from './duetFileEditor/SaveAsDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DuetFileEditorProps {
  filePath: string;
  onClose: () => void;
  /** When true, start with an empty editor instead of loading from disk. */
  isNew?: boolean;
  /** When true, render inline (no modal overlay) filling its parent. */
  inline?: boolean;
  /** Notify the parent whenever the dirty state changes. */
  onDirtyChange?: (dirty: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DuetFileEditor({ filePath, onClose, isNew = false, inline = false, onDirtyChange }: DuetFileEditorProps) {
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

  // Notify parent of dirty-state changes (used to render unsaved dots in
  // the adjacent file list).
  useEffect(() => {
    onDirtyChange?.(hasChanges);
  }, [hasChanges, onDirtyChange]);

  // Insert a G-code snippet at the current cursor location (or selection).
  const insertSnippet = useCallback((snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      // Fall back to appending if the textarea isn't mounted yet.
      setContent((prev) => prev + (prev.endsWith('\n') || prev.length === 0 ? '' : '\n') + snippet + '\n');
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    // Start a snippet on its own line for readability.
    const before = content.substring(0, start);
    const after = content.substring(end);
    const needsLeadingNewline = before.length > 0 && !before.endsWith('\n');
    const needsTrailingNewline = !after.startsWith('\n');
    const inserted =
      (needsLeadingNewline ? '\n' : '') +
      snippet +
      (needsTrailingNewline ? '\n' : '');
    const next = before + inserted + after;
    setContent(next);
    // Place the cursor at the end of the inserted snippet.
    const caret = start + inserted.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = caret;
    });
  }, [content]);

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

  const editorBody = (
    <>
      {/* Header */}
      <div style={editorStyles.header}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflow: 'hidden', minWidth: 0 }}>
          <span style={editorStyles.headerTitle}>
            {fileName}
            {hasChanges && <span style={editorStyles.unsavedDot} title="Unsaved changes" />}
          </span>
          <span style={editorStyles.headerPath}>{filePath}</span>
        </div>
        <div style={editorStyles.headerBtns}>
          <DuetInsertCommandMenu filePath={filePath} onInsert={insertSnippet} />
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
          <button style={editorStyles.btnDanger} onClick={handleClose} title={inline ? 'Close file' : 'Close'}>
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
    </>
  );

  const saveAsDialog = showSaveAs && (
    <SaveAsDialog
      onCancel={() => setShowSaveAs(false)}
      onConfirm={(path) => void handleSaveAs(path)}
      saveAsPath={saveAsPath}
      setSaveAsPath={setSaveAsPath}
    />
  );

  if (inline) {
    const inlineStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      overflow: 'hidden',
      backgroundColor: '#1e1e1e',
      color: '#d4d4d4',
    };
    return (
      <div style={inlineStyle}>
        {editorBody}
        {saveAsDialog}
      </div>
    );
  }

  return (
    <div style={editorStyles.overlay} onClick={handleClose}>
      <div style={editorStyles.modal} onClick={(e) => e.stopPropagation()}>
        {editorBody}
      </div>

      {saveAsDialog}
    </div>
  );
}
