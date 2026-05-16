import { useRef } from 'react';
import { Image as ImageIcon, Upload, X } from 'lucide-react';
import type { ObjectPanelProps } from './types';

/**
 * TextureObjectPanel — Prepare-page surface texture picker. Lets the user
 * apply an image to the selected model's surface (stored as a data URL on
 * the plate object; rendered as the material `map` by PlateObjectMesh).
 * Visual-only — does not affect slicing.
 */
export function TextureObjectPanel({ obj, locked, onUpdate, header, divider }: ObjectPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textureUrl = obj.textureUrl;

  const pickFile = () => inputRef.current?.click();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onUpdate({ textureUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="slicer-overlay-panel">
      {header}

      {textureUrl ? (
        <>
          <div
            className="slicer-overlay-texture-preview"
            style={{
              backgroundImage: `url(${textureUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              width: '100%',
              height: 96,
              borderRadius: 4,
              border: '1px solid var(--slicer-overlay-border, #3a3a3a)',
            }}
          />
          <div className="slicer-overlay-btn-row">
            <button disabled={locked} className="slicer-overlay-mirror-btn" onClick={pickFile}>
              <Upload size={13} /> Replace
            </button>
            <button
              disabled={locked}
              className="slicer-overlay-mirror-btn"
              onClick={() => onUpdate({ textureUrl: undefined })}
            >
              <X size={13} /> Remove
            </button>
          </div>
        </>
      ) : (
        <button
          disabled={locked}
          className="slicer-overlay-mirror-btn"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={pickFile}
        >
          <ImageIcon size={13} /> Choose image…
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFile}
      />

      {divider}
      <div className="slicer-overlay-hint">
        Applies an image to the model surface in the Prepare view. Visual
        only — it does not change the sliced geometry or G-code.
      </div>
    </div>
  );
}
