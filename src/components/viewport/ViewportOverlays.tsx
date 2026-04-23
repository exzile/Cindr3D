import type * as THREE from 'three';
import ViewCube from './viewcube/ViewCube';
import WindowSelectOverlay from './overlays/WindowSelectOverlay';
import LassoSelectOverlay from './overlays/LassoSelectOverlay';
import ZoomWindowOverlay from './overlays/ZoomWindowOverlay';
import FinishEditInPlaceBar from './overlays/FinishEditInPlaceBar';
import { ViewportContextMenu } from './overlays/ViewportContextMenu';
import type { ViewportCtxState } from '../../types/viewport-context-menu.types';

interface ViewportOverlaysProps {
  camQuat: THREE.Quaternion;
  viewportCtxMenu: ViewportCtxState | null;
  onCloseContextMenu: () => void;
  onOrientViewCube: (targetQ: THREE.Quaternion) => void;
  onHomeViewCube: () => void;
}

export function ViewportOverlays({
  camQuat,
  viewportCtxMenu,
  onCloseContextMenu,
  onOrientViewCube,
  onHomeViewCube,
}: ViewportOverlaysProps) {
  return (
    <>
      <FinishEditInPlaceBar />
      {viewportCtxMenu && <ViewportContextMenu menu={viewportCtxMenu} onClose={onCloseContextMenu} />}
      <WindowSelectOverlay />
      <LassoSelectOverlay />
      <ZoomWindowOverlay />
      <ViewCube mainCameraQuaternion={camQuat} onOrient={onOrientViewCube} onHome={onHomeViewCube} />
    </>
  );
}
