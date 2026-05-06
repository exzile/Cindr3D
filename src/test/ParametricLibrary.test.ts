import { describe, expect, it } from 'vitest';
import { PARAMETRIC_MODELS, getDefaultParams } from '../parametric';

describe('parametric model library', () => {
  it('ships the expected starter model families', () => {
    expect(PARAMETRIC_MODELS.map((model) => model.id)).toEqual(expect.arrayContaining([
      'gridfinity-bin',
      'threaded-insert-boss',
      'angle-bracket',
      'project-box',
      'cable-clip',
      'spur-gear',
    ]));
  });

  it('builds editable mesh geometry for every built-in model', () => {
    for (const model of PARAMETRIC_MODELS) {
      const mesh = model.build(getDefaultParams(model));
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
    }
  });
});

