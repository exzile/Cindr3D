import type {
  MaterialProfile,
  PrinterProfile,
  PrintProfile,
  SliceProgress,
} from '../../../../types/slicer';
import {
  reportProgress as reportProgressFromModule,
  yieldToUI as yieldToUIFromModule,
} from '../../gcode/runtime';
import { SlicePipelineFill } from './base/SlicePipelineFill';

export class SlicePipelineBase extends SlicePipelineFill {
  protected printerProfile: PrinterProfile;
  protected materialProfile: MaterialProfile;
  public printProfile: PrintProfile;
  protected onProgress?: (progress: SliceProgress) => void;
  protected cancelled = false;

  constructor(
    printer: PrinterProfile,
    material: MaterialProfile,
    print: PrintProfile,
  ) {
    super();
    this.printerProfile = printer;
    this.materialProfile = material;
    this.printProfile = print;
  }

  setProgressCallback(cb: (progress: SliceProgress) => void): void {
    this.onProgress = cb;
  }

  cancel(): void {
    this.cancelled = true;
  }

  protected reportProgress(
    stage: SliceProgress['stage'],
    percent: number,
    currentLayer: number,
    totalLayers: number,
    message: string,
  ): void {
    reportProgressFromModule(
      this.onProgress,
      stage,
      percent,
      currentLayer,
      totalLayers,
      message,
    );
  }

  protected async yieldToUI(): Promise<void> {
    await yieldToUIFromModule();
  }
}
