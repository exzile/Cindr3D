import type * as React from 'react';
import { Eye, Layers, Undo2, Redo2 } from 'lucide-react';
import { useSlicerStore } from '../../../../store/slicerStore';
import { useLanguageStore } from '../../../../store/languageStore';
import { translate, type TranslationKey } from '../../../../i18n';
export type { SlicerPage } from '../../../../types/slicer-nav.types';

export function SlicerWorkspaceTopNav() {
  const language = useLanguageStore((s) => s.language);
  const sliceResult = useSlicerStore((s) => s.sliceResult);
  const previewMode = useSlicerStore((s) => s.previewMode);
  const setPreviewMode = useSlicerStore((s) => s.setPreviewMode);
  const undoPlate = useSlicerStore((s) => s.undoPlate);
  const redoPlate = useSlicerStore((s) => s.redoPlate);
  const plateHistory = useSlicerStore((s) => s.plateHistory);
  const plateFuture = useSlicerStore((s) => s.plateFuture);
  const hasSlice = sliceResult !== null;
  const t = (key: TranslationKey) => translate(language, key);
  const availableModes: ReadonlyArray<'model' | 'preview'> = hasSlice ? ['model', 'preview'] : ['model'];
  const handlePreviewTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    mode: 'model' | 'preview',
  ) => {
    const index = availableModes.indexOf(mode);
    if (index < 0) return;
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % availableModes.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + availableModes.length) % availableModes.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = availableModes.length - 1;
    else return;

    event.preventDefault();
    const nextMode = availableModes[nextIndex];
    setPreviewMode(nextMode);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-slicer-preview-mode="${nextMode}"]`)?.focus();
    });
  };

  return (
    <div className="slicer-workspace-nav">
      <div role="tablist" aria-label={t('app.prepare.viewLabel')}>
      <button
        type="button"
        className={`slicer-workspace-nav__tab ${previewMode === 'model' ? 'is-active' : ''}`}
        onClick={() => setPreviewMode('model')}
        onKeyDown={(event) => handlePreviewTabKeyDown(event, 'model')}
        role="tab"
        aria-selected={previewMode === 'model'}
        tabIndex={previewMode === 'model' ? 0 : -1}
        data-slicer-preview-mode="model"
      >
        <Layers size={13} />
        {t('app.workspace.prepare')}
      </button>
      <button
        type="button"
        className={`slicer-workspace-nav__tab ${previewMode === 'preview' ? 'is-active' : ''}`}
        onClick={() => setPreviewMode('preview')}
        disabled={!hasSlice}
        title={hasSlice ? 'Show sliced preview' : 'Slice first to enable preview'}
        onKeyDown={(event) => handlePreviewTabKeyDown(event, 'preview')}
        role="tab"
        aria-selected={previewMode === 'preview'}
        tabIndex={previewMode === 'preview' ? 0 : -1}
        data-slicer-preview-mode="preview"
      >
        <Eye size={13} />
        {t('app.prepare.preview')}
      </button>
      </div>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className="slicer-workspace-nav__tab"
        onClick={undoPlate}
        disabled={plateHistory.length === 0}
        title={`${t('app.action.undo')} (Ctrl+Z)`}
        aria-label={t('app.prepare.undoPlate')}
      >
        <Undo2 size={13} />
      </button>
      <button
        type="button"
        className="slicer-workspace-nav__tab"
        onClick={redoPlate}
        disabled={plateFuture.length === 0}
        title={`${t('app.action.redo')} (Ctrl+Y)`}
        aria-label={t('app.prepare.redoPlate')}
      >
        <Redo2 size={13} />
      </button>
    </div>
  );
}
