import { useState, useRef, useEffect } from 'react';
import { X, Plus, Trash2, AlertCircle, Check } from 'lucide-react';
import { useCADStore } from '../store/cadStore';
import { evaluateExpression } from '../utils/expressionEval';

interface Props {
  onClose: () => void;
}

interface EditState {
  name: string;
  expression: string;
  description: string;
  group: string;
}

export default function ParametersPanel({ onClose }: Props) {
  const parameters = useCADStore((s) => s.parameters);
  const addParameter = useCADStore((s) => s.addParameter);
  const updateParameter = useCADStore((s) => s.updateParameter);
  const removeParameter = useCADStore((s) => s.removeParameter);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: '', expression: '', description: '', group: '' });

  // New-row form
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<EditState>({ name: '', expression: '', description: '', group: '' });
  const [newRowError, setNewRowError] = useState<string | null>(null);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding && newNameRef.current) newNameRef.current.focus();
  }, [adding]);

  const isValidName = (name: string, excludeId?: string): boolean => {
    if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return false;
    return !parameters.some(p => p.name === name && p.id !== excludeId);
  };

  const resolvedValue = (expr: string): number | null =>
    evaluateExpression(expr, parameters);

  // ── Editing an existing row ──────────────────────────────────────────────

  const startEdit = (id: string) => {
    const p = parameters.find(p => p.id === id);
    if (!p) return;
    setEditingId(id);
    setEditState({ name: p.name, expression: p.expression, description: p.description ?? '', group: p.group ?? '' });
  };

  const commitEdit = (id: string) => {
    const { name, expression, description, group } = editState;
    if (!isValidName(name, id)) { setEditingId(null); return; }
    updateParameter(id, { name, expression, description: description || undefined, group: group || undefined });
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  // ── Adding a new row ─────────────────────────────────────────────────────

  const commitAdd = () => {
    const { name, expression, description, group } = newRow;
    if (!name) { setNewRowError('Name is required'); return; }
    if (!isValidName(name)) {
      setNewRowError(
        parameters.some(p => p.name === name)
          ? `"${name}" already exists`
          : 'Name must start with a letter or _ and contain only letters, digits, or _'
      );
      return;
    }
    if (expression === '') { setNewRowError('Expression is required'); return; }
    const val = resolvedValue(expression);
    if (val === null) { setNewRowError('Expression is invalid or references an unknown parameter'); return; }
    addParameter(name, expression, description || undefined, group || undefined);
    setNewRow({ name: '', expression: '', description: '', group: '' });
    setNewRowError(null);
    setAdding(false);
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewRow({ name: '', expression: '', description: '', group: '' });
    setNewRowError(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const formatValue = (v: number) =>
    isFinite(v) ? (Math.round(v * 10000) / 10000).toString() : '—';

  return (
    <div className="dialog-overlay">
      <div className="dialog dialog-lg">
        <div className="dialog-header">
          <h3>Parameters</h3>
          <button className="dialog-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="dialog-body" style={{ padding: 0 }}>
          <div className="params-table-wrap">
            <table className="params-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Expression</th>
                  <th>Value</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {parameters.length === 0 && !adding && (
                  <tr>
                    <td colSpan={5} className="params-empty">
                      No parameters yet. Click <strong>+ Add Parameter</strong> to create one.
                    </td>
                  </tr>
                )}
                {parameters.map(p => {
                  const isEditing = editingId === p.id;
                  const liveVal = isEditing ? resolvedValue(editState.expression) : p.value;
                  const hasError = isEditing && (
                    !isValidName(editState.name, p.id) || resolvedValue(editState.expression) === null
                  );

                  return (
                    <tr key={p.id} className={isEditing ? 'params-row-editing' : 'params-row'}>
                      <td>
                        {isEditing ? (
                          <input
                            className={`params-input ${!isValidName(editState.name, p.id) ? 'params-input-error' : ''}`}
                            value={editState.name}
                            onChange={e => setEditState(s => ({ ...s, name: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(p.id); if (e.key === 'Escape') cancelEdit(); }}
                          />
                        ) : (
                          <span className="params-name" onClick={() => startEdit(p.id)}>{p.name}</span>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className={`params-input ${resolvedValue(editState.expression) === null ? 'params-input-error' : ''}`}
                            value={editState.expression}
                            onChange={e => setEditState(s => ({ ...s, expression: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(p.id); if (e.key === 'Escape') cancelEdit(); }}
                          />
                        ) : (
                          <span className="params-expr" onClick={() => startEdit(p.id)}>{p.expression}</span>
                        )}
                      </td>
                      <td>
                        <span className={`params-value ${!isFinite(liveVal ?? NaN) ? 'params-value-error' : ''}`}>
                          {formatValue(liveVal ?? NaN)}
                        </span>
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="params-input params-input-desc"
                            placeholder="optional"
                            value={editState.description}
                            onChange={e => setEditState(s => ({ ...s, description: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(p.id); if (e.key === 'Escape') cancelEdit(); }}
                          />
                        ) : (
                          <span className="params-desc" onClick={() => startEdit(p.id)}>{p.description ?? ''}</span>
                        )}
                      </td>
                      <td className="params-actions">
                        {isEditing ? (
                          <>
                            <button className="params-btn params-btn-ok" onClick={() => commitEdit(p.id)} disabled={hasError} title="Save">
                              <Check size={13} />
                            </button>
                            <button className="params-btn params-btn-cancel" onClick={cancelEdit} title="Cancel">
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <button className="params-btn params-btn-delete" onClick={() => removeParameter(p.id)} title="Delete">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* Add new row */}
                {adding && (
                  <tr className="params-row-editing params-row-new">
                    <td>
                      <input
                        ref={newNameRef}
                        className={`params-input ${newRow.name && !isValidName(newRow.name) ? 'params-input-error' : ''}`}
                        placeholder="name"
                        value={newRow.name}
                        onChange={e => { setNewRow(s => ({ ...s, name: e.target.value })); setNewRowError(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') cancelAdd(); }}
                      />
                    </td>
                    <td>
                      <input
                        className={`params-input ${newRow.expression && resolvedValue(newRow.expression) === null ? 'params-input-error' : ''}`}
                        placeholder="e.g. 50 or width / 2"
                        value={newRow.expression}
                        onChange={e => { setNewRow(s => ({ ...s, expression: e.target.value })); setNewRowError(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') cancelAdd(); }}
                      />
                    </td>
                    <td>
                      <span className="params-value params-value-preview">
                        {newRow.expression ? (resolvedValue(newRow.expression) !== null ? formatValue(resolvedValue(newRow.expression)!) : '—') : ''}
                      </span>
                    </td>
                    <td>
                      <input
                        className="params-input params-input-desc"
                        placeholder="optional"
                        value={newRow.description}
                        onChange={e => setNewRow(s => ({ ...s, description: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') cancelAdd(); }}
                      />
                    </td>
                    <td className="params-actions">
                      <button className="params-btn params-btn-ok" onClick={commitAdd} title="Add">
                        <Check size={13} />
                      </button>
                      <button className="params-btn params-btn-cancel" onClick={cancelAdd} title="Cancel">
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {newRowError && (
            <div className="params-error-banner">
              <AlertCircle size={14} /> {newRowError}
            </div>
          )}

          <div className="params-footer">
            <div className="params-hint">
              Use parameter names in dimension fields and feature dialogs. Supports: <code>+&nbsp;-&nbsp;*&nbsp;/&nbsp;^&nbsp;sqrt()&nbsp;sin()&nbsp;cos()&nbsp;PI</code>
            </div>
          </div>
        </div>

        <div className="dialog-footer">
          <button
            className="btn btn-secondary"
            onClick={() => { setAdding(true); setEditingId(null); }}
            disabled={adding}
          >
            <Plus size={14} style={{ marginRight: 4 }} />
            Add Parameter
          </button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
