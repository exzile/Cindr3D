/**
 * Shared numeric constants for the OCC pipeline.
 */

/** Number of sample points passed to shape.getPoints() when converting sketch
 *  entities to OCC profile wires. Higher = smoother arcs at the cost of more
 *  WASM work. 96 matches the Fusion 360 default tessellation fidelity. */
export const OCC_PROFILE_POINT_COUNT = 96;

/** Version stamp written to feature.params.occBooleanVersion when an OCC boolean
 *  is applied successfully at commit time.  The migration pass skips features that
 *  already carry this stamp so they are never re-migrated after a version bump. */
export const OCC_BOOLEAN_VERSION = 2;
