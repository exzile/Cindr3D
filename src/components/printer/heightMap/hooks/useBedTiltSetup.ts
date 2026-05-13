/**
 * useBedTiltSetup — owns the bed_tilt.g prerequisite check + file-upload flow
 * that gates the Level Bed modal.
 *
 * Entry point: call handleLevelBedOpen. If bed_tilt.g exists the Level Bed
 * modal opens immediately; otherwise the Setup modal opens so the user can
 * create the file first.
 */

import { useCallback, useState } from 'react';
import { addToast } from '../../../../store/toastStore';
import type { DuetService } from '../../../../services/DuetService';
import { generateBedTiltContent } from '../bedTilt';

export interface UseBedTiltSetupDeps {
  service: DuetService | null;
}

export interface UseBedTiltSetupApi {
  showSetupModal: boolean;
  bedTiltContent: string;
  bedTiltDerived: boolean;
  bedTiltNoG30: boolean;
  creatingTiltFile: boolean;
  showLevelModal: boolean;
  setShowLevelModal: (v: boolean) => void;
  closeSetup: () => void;
  handleLevelBedOpen: () => Promise<void>;
  handleCreateBedTilt: (content: string) => Promise<void>;
}

export function useBedTiltSetup({ service }: UseBedTiltSetupDeps): UseBedTiltSetupApi {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [bedTiltContent, setBedTiltContent] = useState('');
  const [bedTiltDerived, setBedTiltDerived] = useState(false);
  const [bedTiltNoG30, setBedTiltNoG30] = useState(false);
  const [creatingTiltFile, setCreatingTiltFile] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);

  const handleLevelBedOpen = useCallback(async () => {
    if (!service) return;
    try {
      await service.getFileInfo('0:/sys/bed_tilt.g');
      setShowLevelModal(true);
    } catch {
      const { content, derived } = await generateBedTiltContent(service);
      setBedTiltContent(content);
      setBedTiltDerived(derived);
      setBedTiltNoG30(false);
      setShowSetupModal(true);
    }
  }, [service]);

  const handleCreateBedTilt = useCallback(async (content: string) => {
    if (!service) return;
    setCreatingTiltFile(true);
    try {
      const blob = new Blob([content], { type: 'text/plain' });
      await service.uploadFile('0:/sys/bed_tilt.g', blob);
      setShowSetupModal(false);
      setShowLevelModal(true);
    } catch (err) {
      addToast('error', 'Failed to save bed_tilt.g', (err as Error).message, undefined, 12_000);
    } finally {
      setCreatingTiltFile(false);
    }
  }, [service]);

  return {
    showSetupModal,
    bedTiltContent,
    bedTiltDerived,
    bedTiltNoG30,
    creatingTiltFile,
    showLevelModal,
    setShowLevelModal,
    closeSetup: () => setShowSetupModal(false),
    handleLevelBedOpen,
    handleCreateBedTilt,
  };
}
