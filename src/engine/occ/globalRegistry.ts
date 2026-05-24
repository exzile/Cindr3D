/**
 * Global singleton BRepBodyRegistry.
 * Session-only (not persisted). OCC operations register/update bodies here.
 * OCC-7.x will integrate this registry into the cadStore.
 */
import { BRepBodyRegistry } from './bodyRegistry';

export const globalBRepBodyRegistry = new BRepBodyRegistry();
