import { Link2, Upload } from "lucide-react";
import type * as React from "react";

interface ImportControlsProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  importError: string | null;
  importing: boolean;
  isDragging: boolean;
  modelUrl: string;
  onDragLeave: () => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onFileInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onModelUrlChange: (value: string) => void;
  onOpenFileDialog: () => void;
  onSubmitUrl: () => void;
}

export function ImportControls({
  fileInputRef,
  importError,
  importing,
  isDragging,
  modelUrl,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileInput,
  onModelUrlChange,
  onOpenFileDialog,
  onSubmitUrl,
}: ImportControlsProps) {
  return (
    <>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`slicer-workspace-objects-panel__dropzone ${isDragging ? "is-dragging" : ""}`}
        onClick={onOpenFileDialog}
      >
        <Upload
          size={16}
          className="slicer-workspace-objects-panel__dropzone-icon"
        />
        {importing ? "Importing..." : "Drop STL/OBJ/3MF/.plate.json or click"}
      </div>
      {importError && (
        <div className="slicer-workspace-objects-panel__import-error">
          {importError}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.obj,.3mf,.amf,.step,.stp,.json"
        className="slicer-workspace-objects-panel__file-input"
        onChange={onFileInput}
      />

      <form
        className="slicer-workspace-objects-panel__url-import"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitUrl();
        }}
      >
        <Link2 size={13} className="slicer-workspace-objects-panel__url-icon" />
        <input
          type="url"
          value={modelUrl}
          onChange={(event) => onModelUrlChange(event.target.value)}
          placeholder="Paste model or marketplace URL"
          className="slicer-workspace-objects-panel__url-input"
          aria-label="STL OBJ 3MF AMF STEP model URL or marketplace model page"
        />
        <button
          type="submit"
          className="slicer-workspace-objects-panel__url-button"
          disabled={importing || modelUrl.trim().length === 0}
        >
          Import
        </button>
      </form>
    </>
  );
}
