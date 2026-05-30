import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";
import { errorMessage } from "../../../../../utils/errorHandling";
import { fetchModelUrlToFile } from "../../../../../utils/printFromUrl";
import type { PlateObject } from "../../../../../types/slicer";

interface UseObjectImportControlsOptions {
  importFileToPlate: (file: File) => Promise<string | null>;
  updatePlateObject: (id: string, patch: Partial<PlateObject>) => void;
}

export function useObjectImportControls({
  importFileToPlate,
  updatePlateObject,
}: UseObjectImportControlsOptions) {
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      if (isMountedRef.current) {
        setImporting(true);
        setImportError(null);
      }
      try {
        await importFileToPlate(file);
      } catch (err) {
        if (isMountedRef.current) {
          setImportError(errorMessage(err, "Unknown error"));
        }
      } finally {
        if (isMountedRef.current) {
          setImporting(false);
        }
      }
    },
    [importFileToPlate],
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void handleImportFile(file);
      event.target.value = "";
    },
    [handleImportFile],
  );

  const handleImportUrl = useCallback(async () => {
    const url = modelUrl.trim();
    if (!url) return;
    if (isMountedRef.current) {
      setImporting(true);
      setImportError(null);
    }
    try {
      const { file, sourceMetadata } = await fetchModelUrlToFile(url);
      const importedId = await importFileToPlate(file);
      if (importedId) {
        updatePlateObject(importedId, { sourceMetadata });
      }
      if (isMountedRef.current) setModelUrl("");
    } catch (err) {
      if (isMountedRef.current) {
        setImportError(errorMessage(err, "Unknown error"));
      }
    } finally {
      if (isMountedRef.current) setImporting(false);
    }
  }, [importFileToPlate, modelUrl, updatePlateObject]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void handleImportFile(file);
    },
    [handleImportFile],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!isDragging) setIsDragging(true);
    },
    [isDragging],
  );

  return {
    fileInputRef,
    importError,
    importing,
    isDragging,
    modelUrl,
    handleDragOver,
    handleDrop,
    handleFileInput,
    handleImportUrl,
    openFileDialog: () => fileInputRef.current?.click(),
    setIsDragging,
    setModelUrl,
  };
}
