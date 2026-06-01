import ViewCube from './viewcube/ViewCube';
import WindowSelectOverlay from './overlays/WindowSelectOverlay';
import LassoSelectOverlay from './overlays/LassoSelectOverlay';
import ZoomWindowOverlay from './overlays/ZoomWindowOverlay';
import FinishEditInPlaceBar from './overlays/FinishEditInPlaceBar';
import { ViewportContextMenu } from './overlays/ViewportContextMenu';
import { useViewCubeQuaternion } from './hooks/useViewCubeQuaternion';
import type { ViewportCtxState } from '../../types/viewport-context-menu.types';

interface ViewportOverlaysProps {
  viewportCtxMenu: ViewportCtxState | null;
  onCloseContextMenu: () => void;
  onOrientViewCube: Parameters<typeof ViewCube>[0]['onOrient'];
  onHomeViewCube: () => void;
}

export function ViewportOverlays({
  viewportCtxMenu,
  onCloseContextMenu,
  onOrientViewCube,
  onHomeViewCube,
}: ViewportOverlaysProps) {
  const camQuat = useViewCubeQuaternion();

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
