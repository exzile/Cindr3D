import { useEffect } from 'react';
import * as THREE from 'three';
import { useCADStore } from '../store/cadStore';
import { useComponentStore } from '../store/componentStore';
import type { Feature, Sketch, SketchEntity, SketchPoint } from '../types/cad';

const FIXTURE_PARAM = 'orangepi3lts-case';

const point = (id: string, x: number, y: number, z: number): SketchPoint => ({ id, x, y, z });

const rect = (
  id: string,
  a: [number, number, number],
  b: [number, number, number],
): SketchEntity => ({
  id,
  type: 'rectangle',
  points: [point(`${id}-a`, a[0], a[1], a[2]), point(`${id}-b`, b[0], b[1], b[2])],
  closed: true,
});

const circle = (id: string, center: [number, number, number], radius: number): SketchEntity => ({
  id,
  type: 'circle',
  points: [point(`${id}-c`, center[0], center[1], center[2])],
  radius,
  closed: true,
});

function sketch(
  id: string,
  name: string,
  plane: Sketch['plane'],
  planeNormal: THREE.Vector3,
  planeOrigin: THREE.Vector3,
  entities: SketchEntity[],
  componentId?: string,
): Sketch {
  return {
    id,
    name,
    plane,
    planeNormal,
    planeOrigin,
    entities,
    constraints: [],
    dimensions: [],
    fullyConstrained: false,
    componentId,
  };
}

function sketchFeature(sk: Sketch, timestamp: number, componentId?: string): Feature {
  return {
    id: `feat-${sk.id}`,
    name: sk.name,
    type: 'sketch',
    sketchId: sk.id,
    componentId,
    params: {},
    visible: true,
    suppressed: false,
    timestamp,
  };
}

function extrudeFeature(
  id: string,
  name: string,
  sketchId: string,
  timestamp: number,
  operation: 'new-body' | 'join' | 'cut',
  distance: number,
  direction: 'positive' | 'negative' = 'positive',
  bodyId?: string,
  componentId?: string,
  startOffset = 0,
  participantBodyIds: string[] = [],
): Feature {
  return {
    id,
    name,
    type: 'extrude',
    sketchId,
    bodyId,
    componentId,
    bodyKind: 'solid',
    params: {
      distance,
      distanceExpr: String(distance),
      direction,
      operation,
      thin: false,
      startType: 'profile',
      startOffset,
      extentType: 'distance',
      taperAngle: 0,
      ...(participantBodyIds.length > 0 ? { participantBodyIds } : {}),
    },
    visible: true,
    suppressed: false,
    timestamp,
  };
}

function buildOrangePi3LtsCase(
  componentIds: { case: string; board: string; top: string },
  bodyIds: { case: string; board: string; top: string },
) {
  const outerW = 62;
  const outerL = 91;
  const wall = 2;
  const floor = 3;
  const wallH = 23;
  const lidThickness = 2;
  const boardThickness = 1.6;
  const boardClearance = 6;
  const boardW = 56;
  const boardL = 85;
  const boardY = floor + boardClearance;
  const standoffHeight = boardClearance;
  const standoffOverlap = 0.75;
  const standoffPositions: Array<[number, number]> = [
    [-24, -38],
    [24, -38],
    [-24, 38],
    [24, 38],
  ];
  const wallCutDepth = wall + 3;
  const floorCutDepth = floor + 2;
  const boardPortBottom = boardY - 1;
  const lowPortTop = boardY + 6;
  const hdmiPortTop = boardY + 8;
  const usbPortTop = boardY + 12;
  const ethernetPortTop = boardY + 15;
  const microSdBottom = floor;
  const microSdTop = boardY + 1;
  const gpioNotchBottom = boardY + 3;
  const gpioNotchTop = wallH - 1;
  const ts = 10_000;

  const sketches: Sketch[] = [
    sketch('op3lts-floor-sketch', 'Case floor - 62 x 91 mm', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), [
      rect('op3lts-floor-rect', [-outerW / 2, 0, -outerL / 2], [outerW / 2, 0, outerL / 2]),
    ], componentIds.case),
    sketch('op3lts-left-wall-sketch', 'Left wall strip', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), [
      rect('op3lts-left-wall-rect', [-outerW / 2, 0, -outerL / 2], [-outerW / 2 + wall, 0, outerL / 2]),
    ], componentIds.case),
    sketch('op3lts-right-wall-sketch', 'Right wall strip', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), [
      rect('op3lts-right-wall-rect', [outerW / 2 - wall, 0, -outerL / 2], [outerW / 2, 0, outerL / 2]),
    ], componentIds.case),
    sketch('op3lts-front-wall-sketch', 'Front wall strip', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), [
      rect('op3lts-front-wall-rect', [-outerW / 2, 0, -outerL / 2], [outerW / 2, 0, -outerL / 2 + wall]),
    ], componentIds.case),
    sketch('op3lts-back-wall-sketch', 'Back wall strip', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), [
      rect('op3lts-back-wall-rect', [-outerW / 2, 0, outerL / 2 - wall], [outerW / 2, 0, outerL / 2]),
    ], componentIds.case),
    sketch('op3lts-standoffs-sketch', 'Four M2.5 standoffs', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, floor, 0), [
      ...standoffPositions.map(([x, z], index) => circle(`op3lts-standoff-${index + 1}`, [x, floor, z], 3.4)),
    ], componentIds.case),
    sketch('op3lts-standoff-holes-sketch', 'M2.5 screw pilot holes', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, floor, 0), [
      ...standoffPositions.map(([x, z], index) => circle(`op3lts-pilot-${index + 1}`, [x, floor, z], 1.2)),
    ], componentIds.case),
    sketch('op3lts-board-sketch', 'Orange Pi 3 LTS board proxy - 56 x 85 mm', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, boardY, 0), [
      rect('op3lts-board-rect', [-boardW / 2, boardY, -boardL / 2], [boardW / 2, boardY, boardL / 2]),
    ], componentIds.board),
    sketch('op3lts-board-holes-sketch', 'Board M2.5 clearance holes', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, boardY, 0), [
      ...standoffPositions.map(([x, z], index) => circle(`op3lts-board-hole-${index + 1}`, [x, boardY, z], 1.5)),
    ], componentIds.board),
    sketch('op3lts-back-ports-sketch', 'Back HDMI, USB-C power, audio and LED openings', 'XZ', new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, outerL / 2), [
      rect('op3lts-hdmi-cut', [-24, boardPortBottom, outerL / 2], [-10, hdmiPortTop, outerL / 2]),
      rect('op3lts-usbc-power-cut', [-5, boardPortBottom, outerL / 2], [8, lowPortTop, outerL / 2]),
      rect('op3lts-audio-cut', [16, boardPortBottom, outerL / 2], [27, lowPortTop, outerL / 2]),
      rect('op3lts-status-led-cut', [28, boardY, outerL / 2], [30, boardY + 4, outerL / 2]),
    ], componentIds.case),
    sketch('op3lts-front-access-sketch', 'Front IR receiver and power button openings', 'XZ', new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -outerL / 2), [
      rect('op3lts-ir-cut', [-29, boardPortBottom, -outerL / 2], [-25, lowPortTop, -outerL / 2]),
      rect('op3lts-power-button-cut', [24, boardPortBottom, -outerL / 2], [30, lowPortTop, -outerL / 2]),
    ], componentIds.case),
    sketch('op3lts-right-ports-sketch', 'Right Ethernet, USB 3.0 and USB 2.0 openings', 'YZ', new THREE.Vector3(1, 0, 0), new THREE.Vector3(outerW / 2, 0, 0), [
      rect('op3lts-ethernet-cut', [outerW / 2, boardPortBottom, -39], [outerW / 2, ethernetPortTop, -18]),
      rect('op3lts-usb3-cut', [outerW / 2, boardPortBottom, -13], [outerW / 2, usbPortTop, 4]),
      rect('op3lts-usb2-stack-cut', [outerW / 2, boardPortBottom, 10], [outerW / 2, usbPortTop, 34]),
    ], componentIds.case),
    sketch('op3lts-left-access-sketch', 'Left microSD access opening', 'YZ', new THREE.Vector3(1, 0, 0), new THREE.Vector3(-outerW / 2, 0, 0), [
      rect('op3lts-microsd-cut', [-outerW / 2, microSdBottom, 29], [-outerW / 2, microSdTop, 44]),
    ], componentIds.case),
    sketch('op3lts-vent-sketch', 'Bottom ventilation slots', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), [
      rect('op3lts-vent-1', [-20, 0, -20], [20, 0, -17]),
      rect('op3lts-vent-2', [-20, 0, -11], [20, 0, -8]),
      rect('op3lts-vent-3', [-20, 0, -2], [20, 0, 1]),
      rect('op3lts-vent-4', [-20, 0, 7], [20, 0, 10]),
      rect('op3lts-vent-5', [-20, 0, 16], [20, 0, 19]),
    ], componentIds.case),
    sketch('op3lts-gpio-sketch', 'GPIO ribbon top notch', 'YZ', new THREE.Vector3(1, 0, 0), new THREE.Vector3(-outerW / 2, 0, 0), [
      rect('op3lts-gpio-cut', [-outerW / 2, gpioNotchBottom, -30], [-outerW / 2, gpioNotchTop, 30]),
    ], componentIds.case),
    sketch('op3lts-top-cover-sketch', 'Top cover outer frame', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, wallH, 0), [
      rect('op3lts-top-cover-rect', [-outerW / 2, wallH, -outerL / 2], [outerW / 2, wallH, outerL / 2]),
    ], componentIds.top),
    sketch('op3lts-top-cover-window-sketch', 'Top cover removable center opening', 'XY', new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, wallH, 0), [
      rect('op3lts-top-cover-window', [-outerW / 2 + wall * 2, wallH, -outerL / 2 + wall * 2], [outerW / 2 - wall * 2, wallH, outerL / 2 - wall * 2]),
    ], componentIds.top),
  ];

  const features: Feature[] = sketches.map((sk, index) => sketchFeature(sk, ts + index, sk.componentId));
  const caseFeatureIds = [
    'op3lts-floor',
    'op3lts-left-wall',
    'op3lts-right-wall',
    'op3lts-front-wall',
    'op3lts-back-wall',
    'op3lts-standoffs',
    'op3lts-pilot-holes',
    'op3lts-back-port-cuts',
    'op3lts-front-access-cuts',
    'op3lts-right-port-cuts',
    'op3lts-left-access-cuts',
    'op3lts-vent-cuts',
    'op3lts-gpio-cut-feature',
  ];
  const boardFeatureIds = ['op3lts-board-proxy', 'op3lts-board-hole-cuts'];
  const topFeatureIds = ['op3lts-top-cover', 'op3lts-top-cover-window-cut'];
  const bodyFeatures: Feature[] = [
    extrudeFeature('op3lts-floor', 'Case floor', 'op3lts-floor-sketch', ts + 100, 'new-body', floor, 'positive', bodyIds.case, componentIds.case),
    extrudeFeature('op3lts-left-wall', 'Join left wall', 'op3lts-left-wall-sketch', ts + 101, 'join', wallH, 'positive', undefined, componentIds.case),
    extrudeFeature('op3lts-right-wall', 'Join right wall', 'op3lts-right-wall-sketch', ts + 102, 'join', wallH, 'positive', undefined, componentIds.case),
    extrudeFeature('op3lts-front-wall', 'Join front wall', 'op3lts-front-wall-sketch', ts + 103, 'join', wallH, 'positive', undefined, componentIds.case),
    extrudeFeature('op3lts-back-wall', 'Join back wall', 'op3lts-back-wall-sketch', ts + 104, 'join', wallH, 'positive', undefined, componentIds.case),
    extrudeFeature('op3lts-standoffs', 'Join four raised screw standoffs', 'op3lts-standoffs-sketch', ts + 105, 'join', standoffHeight + standoffOverlap, 'positive', undefined, componentIds.case, -standoffOverlap),
    extrudeFeature('op3lts-pilot-holes', 'Cut M2.5 screw pilot holes through standoffs', 'op3lts-standoff-holes-sketch', ts + 106, 'cut', standoffHeight + standoffOverlap + 1.5, 'positive', undefined, componentIds.case, -standoffOverlap, [bodyIds.case]),
    extrudeFeature('op3lts-back-port-cuts', 'Cut HDMI, USB-C power and audio openings', 'op3lts-back-ports-sketch', ts + 107, 'cut', wallCutDepth, 'negative', undefined, componentIds.case, 1, [bodyIds.case]),
    extrudeFeature('op3lts-front-access-cuts', 'Cut IR receiver and power button openings', 'op3lts-front-access-sketch', ts + 108, 'cut', wallCutDepth, 'positive', undefined, componentIds.case, -1, [bodyIds.case]),
    extrudeFeature('op3lts-right-port-cuts', 'Cut Ethernet and USB openings', 'op3lts-right-ports-sketch', ts + 109, 'cut', wallCutDepth, 'negative', undefined, componentIds.case, 1, [bodyIds.case]),
    extrudeFeature('op3lts-left-access-cuts', 'Cut microSD access opening', 'op3lts-left-access-sketch', ts + 110, 'cut', wallCutDepth, 'positive', undefined, componentIds.case, -1, [bodyIds.case]),
    extrudeFeature('op3lts-vent-cuts', 'Cut bottom vent slots', 'op3lts-vent-sketch', ts + 111, 'cut', floorCutDepth, 'positive', undefined, componentIds.case, -1, [bodyIds.case]),
    extrudeFeature('op3lts-gpio-cut-feature', 'Cut GPIO ribbon notch', 'op3lts-gpio-sketch', ts + 112, 'cut', wallCutDepth, 'positive', undefined, componentIds.case, -1, [bodyIds.case]),
    extrudeFeature('op3lts-board-proxy', 'Orange Pi 3 LTS board proxy', 'op3lts-board-sketch', ts + 113, 'new-body', boardThickness, 'positive', bodyIds.board, componentIds.board),
    extrudeFeature('op3lts-board-hole-cuts', 'Cut board mounting clearance holes', 'op3lts-board-holes-sketch', ts + 114, 'cut', boardThickness + 0.8, 'positive', undefined, componentIds.board, -0.4, [bodyIds.board]),
    extrudeFeature('op3lts-top-cover', 'Top cover frame', 'op3lts-top-cover-sketch', ts + 115, 'new-body', lidThickness, 'positive', bodyIds.top, componentIds.top),
    extrudeFeature('op3lts-top-cover-window-cut', 'Cut removable center opening in top cover', 'op3lts-top-cover-window-sketch', ts + 116, 'cut', lidThickness + 1, 'positive', undefined, componentIds.top, -0.5, [bodyIds.top]),
  ];

  return {
    sketches,
    features: [...features, ...bodyFeatures],
    sketchIdsByComponent: {
      case: sketches.filter((sk) => sk.componentId === componentIds.case).map((sk) => sk.id),
      board: sketches.filter((sk) => sk.componentId === componentIds.board).map((sk) => sk.id),
      top: sketches.filter((sk) => sk.componentId === componentIds.top).map((sk) => sk.id),
    },
    featureIdsByBody: {
      case: caseFeatureIds,
      board: boardFeatureIds,
      top: topFeatureIds,
    },
  };
}

function repairOrangePi3LtsFixtureSketches() {
  const cadState = useCADStore.getState();
  const componentState = useComponentStore.getState();
  const featureSketchIds = new Set(
    cadState.features
      .filter((feature) => feature.type === 'sketch' && feature.sketchId?.startsWith('op3lts-'))
      .map((feature) => feature.sketchId!),
  );
  if (featureSketchIds.size === 0) return false;

  const components = Object.values(componentState.components);
  const caseComponent = components.find((component) => component.name === 'Orange Pi 3 LTS case');
  const boardComponent = components.find((component) => component.name === 'Orange Pi 3 LTS board');
  const topComponent = components.find((component) => component.name === 'Top cover');
  if (!caseComponent || !boardComponent || !topComponent) return false;

  const expected = buildOrangePi3LtsCase(
    { case: caseComponent.id, board: boardComponent.id, top: topComponent.id },
    { case: '', board: '', top: '' },
  );
  const existingSketchIds = new Set(cadState.sketches.map((sketch) => sketch.id));
  const missingSketches = expected.sketches.filter(
    (sketch) => featureSketchIds.has(sketch.id) && !existingSketchIds.has(sketch.id),
  );
  if (missingSketches.length === 0) return false;

  useCADStore.setState({
    sketches: [...cadState.sketches, ...missingSketches],
    statusMessage: `Restored ${missingSketches.length} missing Orange Pi fixture sketch${missingSketches.length === 1 ? '' : 'es'}`,
  });
  useComponentStore.setState((state) => {
    const componentsById = { ...state.components };
    for (const sketch of missingSketches) {
      if (!sketch.componentId) continue;
      const component = componentsById[sketch.componentId];
      if (!component || component.sketchIds.includes(sketch.id)) continue;
      componentsById[sketch.componentId] = {
        ...component,
        sketchIds: [...component.sketchIds, sketch.id],
      };
    }
    return { components: componentsById };
  });

  return true;
}

export function loadOrangePi3LtsCaseFixture() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('fixture') !== FIXTURE_PARAM) return false;

  const componentStore = useComponentStore.getState();
  const rootComponentId = componentStore.rootComponentId;
  const rootComponent = componentStore.components[rootComponentId];
  if (rootComponent) {
    useComponentStore.setState({
      bodies: {},
      constructions: {},
      joints: {},
      componentConstraints: [],
      activeComponentId: rootComponentId,
      selectedBodyId: null,
      components: {
        [rootComponentId]: {
          ...rootComponent,
          childIds: [],
          bodyIds: [],
          sketchIds: [],
          constructionIds: [],
          constructionPlaneIds: [],
          constructionAxisIds: [],
          constructionPointIds: [],
          jointIds: [],
        },
      },
    });
  }

  const refreshedComponentStore = useComponentStore.getState();
  const caseComponentId = refreshedComponentStore.addComponent(rootComponentId, 'Orange Pi 3 LTS case');
  const boardComponentId = useComponentStore.getState().addComponent(rootComponentId, 'Orange Pi 3 LTS board');
  const topComponentId = useComponentStore.getState().addComponent(rootComponentId, 'Top cover');

  const caseBodyId = useComponentStore.getState().addBody(caseComponentId, 'Orange Pi 3 LTS case body');
  refreshedComponentStore.setBodyMaterial(caseBodyId, {
    id: 'matte-orange-case',
    name: 'Matte orange case',
    color: '#F97316',
    metalness: 0.05,
    roughness: 0.72,
    opacity: 1,
    category: 'plastic',
  });
  const boardBodyId = useComponentStore.getState().addBody(boardComponentId, 'Orange Pi 3 LTS board proxy');
  useComponentStore.getState().setBodyMaterial(boardBodyId, {
    id: 'green-pcb',
    name: 'Green PCB',
    color: '#15803D',
    metalness: 0.1,
    roughness: 0.55,
    opacity: 1,
    category: 'plastic',
  });
  const topBodyId = useComponentStore.getState().addBody(topComponentId, 'Top cover frame');
  useComponentStore.getState().setBodyMaterial(topBodyId, {
    id: 'smoke-clear-top',
    name: 'Smoked translucent top',
    color: '#60A5FA',
    metalness: 0.02,
    roughness: 0.38,
    opacity: 0.82,
    category: 'plastic',
  });

  const { sketches, features, sketchIdsByComponent, featureIdsByBody } = buildOrangePi3LtsCase(
    { case: caseComponentId, board: boardComponentId, top: topComponentId },
    { case: caseBodyId, board: boardBodyId, top: topBodyId },
  );
  featureIdsByBody.case.forEach((featureId) => useComponentStore.getState().addFeatureToBody(caseBodyId, featureId));
  featureIdsByBody.board.forEach((featureId) => useComponentStore.getState().addFeatureToBody(boardBodyId, featureId));
  featureIdsByBody.top.forEach((featureId) => useComponentStore.getState().addFeatureToBody(topBodyId, featureId));
  useComponentStore.setState((state) => ({
    components: {
      ...state.components,
      [caseComponentId]: { ...state.components[caseComponentId], sketchIds: sketchIdsByComponent.case },
      [boardComponentId]: { ...state.components[boardComponentId], sketchIds: sketchIdsByComponent.board },
      [topComponentId]: { ...state.components[topComponentId], sketchIds: sketchIdsByComponent.top },
    },
  }));
  useCADStore.setState({
    workspaceMode: 'design',
    features,
    sketches,
    activeSketch: null,
    activeTool: 'select',
    viewMode: '3d',
    rollbackIndex: -1,
    statusMessage: 'Loaded Orange Pi 3 LTS case fixture with case, board, and top cover components',
  });

  url.searchParams.delete('fixture');
  window.history.replaceState({}, '', url);
  return true;
}

export function DevFixtureLoader() {
  useEffect(() => {
    const cadPersist = (useCADStore as unknown as {
      persist?: {
        hasHydrated: () => boolean;
        onFinishHydration: (cb: () => void) => (() => void) | void;
      };
    }).persist;
    const componentPersist = (useComponentStore as unknown as {
      persist?: {
        hasHydrated: () => boolean;
        onFinishHydration: (cb: () => void) => (() => void) | void;
      };
    }).persist;

    const loadAfterHydration = () => {
      const cadReady = !cadPersist || cadPersist.hasHydrated();
      const componentsReady = !componentPersist || componentPersist.hasHydrated();
      if (cadReady && componentsReady && !loadOrangePi3LtsCaseFixture()) {
        repairOrangePi3LtsFixtureSketches();
      }
    };

    const unsubscribers: Array<(() => void) | void> = [];
    if (cadPersist && !cadPersist.hasHydrated()) {
      unsubscribers.push(cadPersist.onFinishHydration(loadAfterHydration));
    }
    if (componentPersist && !componentPersist.hasHydrated()) {
      unsubscribers.push(componentPersist.onFinishHydration(loadAfterHydration));
    }
    loadAfterHydration();

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe?.();
    };
  }, []);

  return null;
}
