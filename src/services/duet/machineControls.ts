import type { DuetObjectModel } from '../../types/duet';

export async function setToolTemperatureCommand(
  sendGCode: (code: string) => Promise<string>,
  objectModel: Partial<DuetObjectModel>,
  toolIndex: number,
  heaterIndex: number,
  temp: number,
  standby = false,
): Promise<void> {
  const letter = standby ? 'R' : 'S';
  const tool = objectModel.tools?.find((t) => t.number === toolIndex);
  if (tool) {
    const temps = standby ? [...tool.standby] : [...tool.active];
    temps[heaterIndex] = temp;
    await sendGCode(`G10 P${toolIndex} ${letter}${temps.join(':')}`);
  } else {
    await sendGCode(`G10 P${toolIndex} ${letter}${temp}`);
  }
}

export async function setBedTemperatureCommand(sendGCode: (code: string) => Promise<string>, temp: number): Promise<void> {
  await sendGCode(`M140 S${temp}`);
}

export async function setChamberTemperatureCommand(sendGCode: (code: string) => Promise<string>, temp: number): Promise<void> {
  await sendGCode(`M141 S${temp}`);
}

export async function setFanSpeedCommand(sendGCode: (code: string) => Promise<string>, fanIndex: number, speed: number): Promise<void> {
  const clamped = Math.max(0, Math.min(1, speed));
  await sendGCode(`M106 P${fanIndex} S${clamped}`);
}

export async function startPrintCommand(sendGCode: (code: string) => Promise<string>, filename: string): Promise<void> {
  await sendGCode(`M32 "${filename}"`);
}

export async function pausePrintCommand(sendGCode: (code: string) => Promise<string>): Promise<void> {
  await sendGCode('M25');
}

export async function resumePrintCommand(sendGCode: (code: string) => Promise<string>): Promise<void> {
  await sendGCode('M24');
}

export async function cancelPrintCommand(sendGCode: (code: string) => Promise<string>): Promise<void> {
  await sendGCode('M0');
}

export async function cancelObjectCommand(sendGCode: (code: string) => Promise<string>, objectIndex: number): Promise<void> {
  await sendGCode(`M486 P${objectIndex}`);
}

export async function simulateFileCommand(sendGCode: (code: string) => Promise<string>, filename: string): Promise<void> {
  await sendGCode(`M37 S"${filename}"`);
}

export async function selectToolCommand(sendGCode: (code: string) => Promise<string>, toolIndex: number): Promise<void> {
  await sendGCode(`T${toolIndex}`);
}

export async function deselectToolCommand(sendGCode: (code: string) => Promise<string>): Promise<void> {
  await sendGCode('T-1');
}
