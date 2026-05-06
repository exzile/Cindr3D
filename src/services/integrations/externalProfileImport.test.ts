import { describe, expect, it } from 'vitest';
import { DEFAULT_PRINT_PROFILES } from '../../types/slicer/defaultProfiles';
import { parseExternalPrintProfile } from './externalProfileImport';

const base = DEFAULT_PRINT_PROFILES[0];

describe('external profile import', () => {
  it('maps Orca-style config keys into a Cindr3D print profile', () => {
    const result = parseExternalPrintProfile('0.20mm Standard.orca_printer', `
      print_settings_id = Fast PETG
      layer_height = 0.24
      wall_loops = 4
      sparse_infill_density = 18%
      sparse_infill_pattern = gyroid
      support_enable = true
      brim_type = outer_only
    `, base);

    expect(result.format).toBe('orca');
    expect(result.profile.layerHeight).toBe(0.24);
    expect(result.profile.wallCount).toBe(4);
    expect(result.profile.infillDensity).toBe(18);
    expect(result.profile.infillPattern).toBe('gyroid');
    expect(result.profile.supportEnabled).toBe(true);
    expect(result.profile.adhesionType).toBe('brim');
  });

  it('maps Cura-style JSON settings into a profile preview', () => {
    const result = parseExternalPrintProfile('fine.curaprofile', JSON.stringify({
      settings: {
        layer_height: '0.12',
        speed_print: '45',
        support_material: 'false',
        fill_pattern: 'rectilinear',
      },
    }), base);

    expect(result.format).toBe('cura');
    expect(result.profile.layerHeight).toBe(0.12);
    expect(result.profile.printSpeed).toBe(45);
    expect(result.profile.supportEnabled).toBe(false);
    expect(result.profile.infillPattern).toBe('lines');
  });
});
