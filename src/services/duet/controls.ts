export async function homeAxesCommand(
  sendGCode: (code: string) => Promise<string>,
  axes?: string[],
): Promise<void> {
  if (!axes || axes.length === 0) {
    await sendGCode('G28');
  } else {
    await sendGCode(`G28 ${axes.join(' ').toUpperCase()}`);
  }
}

export async function moveAxisCommand(
  sendGCode: (code: string) => Promise<string>,
  axis: string,
  distance: number,
  feedrate?: number,
  relative = true,
): Promise<void> {
  const modeCmd = relative ? 'G91' : 'G90';
  const feedStr = feedrate != null ? ` F${feedrate}` : '';
  await sendGCode(`${modeCmd}\nG1 ${axis.toUpperCase()}${distance}${feedStr}\nG90`);
}

export async function extrudeCommand(
  sendGCode: (code: string) => Promise<string>,
  amount: number,
  feedrate: number,
): Promise<void> {
  await sendGCode(`M83\nG1 E${amount} F${feedrate}\nM82`);
}

export async function emergencyStopCommand(
  sendGCode: (code: string) => Promise<string>,
): Promise<void> {
  try {
    await sendGCode('M112');
  } catch {
    // M112 may kill the connection before we get a reply — that's expected.
  }
}

export async function runMacroCommand(
  sendGCode: (code: string) => Promise<string>,
  filename: string,
): Promise<string> {
  return sendGCode(`M98 P"${filename}"`);
}
