import { usePrinterStore } from '../../store/printerStore';
import {
  NoJobMessage,
  PrintStatusHeader,
  ProgressSection,
  JobInfo,
  TimeEstimates,
  FilamentUsage,
  TemperatureChart,
  LayerDurationChart,
  BabySteppingControls,
  SpeedFlowOverride,
  WebcamView,
  ObjectCancellation,
  ThumbnailPreview,
  FirstLayerInspection,
  PauseAtTrigger,
  PrintQueue,
  FilamentChange,
} from './jobStatus';

export default function DuetJobStatus() {
  const model = usePrinterStore((s) => s.model);

  const status = model.state?.status ?? 'idle';
  const hasJob = status === 'processing' || status === 'paused' || status === 'pausing'
    || status === 'resuming' || status === 'simulating' || status === 'cancelling';

  if (!hasJob) {
    return (
      <div className="duet-job__root duet-job__root--idle">
        <NoJobMessage />
        <PrintQueue />
      </div>
    );
  }

  return (
    <div className="duet-job__root">
      <PrintQueue />
      <PrintStatusHeader />
      <FilamentChange />
      <ThumbnailPreview />
      <ProgressSection />
      <FirstLayerInspection />
      <PauseAtTrigger />
      <ObjectCancellation />
      <JobInfo />
      <TimeEstimates />
      <FilamentUsage />
      <TemperatureChart />
      <LayerDurationChart />
      <BabySteppingControls />
      <SpeedFlowOverride />
      <WebcamView />
    </div>
  );
}
