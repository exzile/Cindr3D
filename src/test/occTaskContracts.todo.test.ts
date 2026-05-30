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

type OperationCase = {
  name: string;
  importPath: string;
  exportName: string;
};

const operationCases: OperationCase[] = [
  {
    name: 'OCC-3.1 box primitive',
    importPath: '../engine/occ/ops/box.ts',
    exportName: 'occBox',
  },
  {
    name: 'OCC-3.2 cylinder primitive',
    importPath: '../engine/occ/ops/cylinder.ts',
    exportName: 'occCylinder',
  },
  {
    name: 'OCC-3.3 sketch extrude',
    importPath: '../engine/occ/ops/extrude.ts',
    exportName: 'occExtrude',
  },
  {
    name: 'OCC-3.4 revolve',
    importPath: '../engine/occ/ops/revolve.ts',
    exportName: 'occRevolve',
  },
  {
    name: 'OCC-3.5 sweep',
    importPath: '../engine/occ/ops/sweep.ts',
    exportName: 'occSweep',
  },
  {
    name: 'OCC-3.6 shell',
    importPath: '../engine/occ/ops/shell.ts',
    exportName: 'occShell',
  },
  {
    name: 'OCC-4.1 subtract',
    importPath: '../engine/occ/ops/subtract.ts',
    exportName: 'occSubtract',
  },
  {
    name: 'OCC-4.2 union',
    importPath: '../engine/occ/ops/union.ts',
    exportName: 'occUnion',
  },
  {
    name: 'OCC-4.3 intersect',
    importPath: '../engine/occ/ops/intersect.ts',
    exportName: 'occIntersect',
  },
  {
    name: 'OCC-5.1 fillet',
    importPath: '../engine/occ/ops/fillet.ts',
    exportName: 'occFillet',
  },
  {
    name: 'OCC-5.2 chamfer',
    importPath: '../engine/occ/ops/chamfer.ts',
    exportName: 'occChamfer',
  },
  {
    name: 'OCC-10.2 mirror',
    importPath: '../engine/occ/ops/mirror.ts',
    exportName: 'occMirror',
  },
  {
    name: 'OCC-10.5 rectangular pattern',
    importPath: '../engine/occ/ops/pattern.ts',
    exportName: 'occRectangularPattern',
  },
  {
    name: 'OCC-10.6 circular pattern',
    importPath: '../engine/occ/ops/pattern.ts',
    exportName: 'occCircularPattern',
  },
  {
    name: 'OCC-10.15 sphere primitive',
    importPath: '../engine/occ/ops/sphere.ts',
    exportName: 'occSphere',
  },
  {
    name: 'OCC-10.15 torus primitive',
    importPath: '../engine/occ/ops/torus.ts',
    exportName: 'occTorus',
  },
  {
    name: 'OCC-10.16 scale',
    importPath: '../engine/occ/ops/scale.ts',
    exportName: 'occScale',
  },
];

describe('OCC parallel task export contracts', () => {
  for (const operationCase of operationCases) {
    const contractIt = runOccContracts && hasOccModule(operationCase.importPath) ? it : it.skip;

    contractIt(`${operationCase.name} exports ${operationCase.exportName}`, async () => {
      const moduleExports = await loadOccModule<Record<string, unknown>>(operationCase.importPath);

      expect(typeof moduleExports[operationCase.exportName]).toBe('function');
    });
  }
});

describe('OCC shared model contracts', () => {
  const modelFilesPresent =
    runOccContracts &&
    hasOccModule('../engine/occ/brepBody.ts') &&
    hasOccModule('../engine/occ/tessellate.ts');

  (modelFilesPresent ? it : it.skip)('exports body and tessellation construction helpers', async () => {
    const brepBodyModule = await loadOccModule<Record<string, unknown>>('../engine/occ/brepBody.ts');
    const tessellateModule = await loadOccModule<Record<string, unknown>>('../engine/occ/tessellate.ts');

    expect(
      brepBodyModule.createBRepBody ??
      brepBodyModule.makeBRepBody ??
      brepBodyModule.makeBRepBodyFromOccShape,
    ).toBeTruthy();
    expect(typeof tessellateModule.tessellate).toBe('function');
    expect(typeof tessellateModule.tessellateWithInstance).toBe('function');
  });
});
