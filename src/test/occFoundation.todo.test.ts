import { describe, expect, it } from 'vitest';

const occModules = import.meta.glob('../engine/occ/**/*.ts') as Record<string, () => Promise<unknown>>;
const runOccContracts = import.meta.env.VITE_RUN_OCC_CONTRACTS === 'true';

function hasOccModule(relativeImportPath: string): boolean {
  return relativeImportPath in occModules;
}

async function loadOccModule<TModule>(relativeImportPath: string): Promise<TModule> {
  const loadModule = occModules[relativeImportPath];
  if (!loadModule) throw new Error(`Missing OCC module: ${relativeImportPath}`);
  return await loadModule() as TModule;
}

const hasLoader = runOccContracts && hasOccModule('../engine/occ/loader.ts');
const hasHandle = runOccContracts && hasOccModule('../engine/occ/occHandle.ts');

describe('OCC-1 foundation contracts', () => {
  (hasLoader ? it : it.skip)('memoizes concurrent getOcc calls to a single instance', async () => {
    type LoaderModule = {
      getOcc: () => Promise<{ finalize?: () => Promise<void> | void }>;
    };

    const { getOcc } = await loadOccModule<LoaderModule>('../engine/occ/loader.ts');
    expect(typeof getOcc).toBe('function');

    const [first, second] = await Promise.all([getOcc(), getOcc()]);
    expect(first).toBe(second);

    await first.finalize?.();
  });

  (hasHandle ? it : it.skip)('disposes OCC handles exactly once', async () => {
    type OccHandleInstance = {
      readonly isDisposed: boolean;
      dispose: () => void;
    };
    type OccHandleModule = {
      OccHandle: new <T>(ptr: T, type: string, dispose: () => void) => OccHandleInstance;
    };

    const { OccHandle } = await loadOccModule<OccHandleModule>('../engine/occ/occHandle.ts');
    let disposeCount = 0;
    const handle = new OccHandle(123, 'TopoDS_Shape', () => {
      disposeCount += 1;
    });

    expect(handle.isDisposed).toBe(false);
    handle.dispose();
    handle.dispose();

    expect(handle.isDisposed).toBe(true);
    expect(disposeCount).toBe(1);
  });
});
