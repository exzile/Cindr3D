/**
 * occConsole.ts — shared flag for suppressing OCC WASM stdout.
 *
 * Emscripten captures `console.log.bind(console)` once at WASM module init.
 * To intercept it we install a filter in main.tsx *before* the OCC module
 * loads.  That filter reads `occConsole.suppress`; callers that produce noisy
 * OCC output (e.g. STEPControl_Writer.Transfer) set the flag around the call.
 */
export const occConsole = { suppress: false };
