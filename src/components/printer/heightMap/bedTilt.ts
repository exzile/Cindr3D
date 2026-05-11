/** bed_tilt.g content template + derive-from-bed.g helper. */

import type { DuetService } from '../../../services/DuetService';

export const TILT_TEMPLATE = `\
; bed_tilt.g — tilt-correction only (no G29 / M374)
; TODO: Edit the G30 lines below to match your leadscrew positions.
; Refer to your M671 configuration in config.g for XY coordinates.
M561                             ; clear any active bed transform
G28                              ; home all axes
; G30 P0 X55  Y450 Z-99999      ; leadscrew 1
; G30 P1 X55  Y0   Z-99999      ; leadscrew 2
; G30 P2 X420 Y220 Z-99999 S3   ; leadscrew 3 — S3 triggers tilt correction`;

export async function generateBedTiltContent(
  service: DuetService,
): Promise<{ content: string; derived: boolean }> {
  try {
    const blob = await service.downloadFile('0:/sys/bed.g');
    const text = await blob.text();

    // Strip G29 and M374 lines — those are for mesh probing, not tilt correction.
    const filtered = text
      .split('\n')
      .filter((line) => !/^\s*(G29|M374)\b/i.test(line))
      .join('\n')
      .trimEnd();

    // If bed.g has no G30 tilt lines it's not useful as a base.
    const hasTilt = /^\s*G30\b/im.test(filtered);
    if (!hasTilt) return { content: TILT_TEMPLATE, derived: false };

    const header = '; bed_tilt.g — derived from bed.g (G29 / M374 removed)\n';
    return { content: header + filtered, derived: true };
  } catch {
    return { content: TILT_TEMPLATE, derived: false };
  }
}
