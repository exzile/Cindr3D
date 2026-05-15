/**
 * PrintQualityCard — single-record display for an automatic print-completion
 * diagnosis. Shows the camera thumbnail, a colour-coded score badge derived
 * from `bucketDiagnosis`, the AI's one-line summary, and the file context.
 *
 * The "score" is a 3-level bucket (ok / warn / fail) — `PrintDiagnosisResult`
 * doesn't carry an explicit numeric score field, so this card derives one
 * from the shared `bucketDiagnosis` helper.
 */
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { PrintDiagnosisRecord } from '../../../store/visionStore';
import { bucketDiagnosis, type PrintQualityBucket } from '../../../services/calibration/printQualityCapture';

interface PrintQualityCardProps {
  record: PrintDiagnosisRecord;
  /** Optional thumbnail data URL captured at print completion. Pulled from the
   *  matching VisionFrameRecord when available. */
  thumbnailDataUrl?: string;
}

const BUCKET_LABEL: Record<PrintQualityBucket, string> = {
  ok: 'Looks good',
  warn: 'Review',
  fail: 'Issue detected',
};

function BucketIcon({ bucket }: { bucket: PrintQualityBucket }) {
  if (bucket === 'ok') return <CheckCircle2 size={14} />;
  if (bucket === 'fail') return <XCircle size={14} />;
  return <AlertTriangle size={14} />;
}

export function PrintQualityCard({ record, thumbnailDataUrl }: PrintQualityCardProps) {
  const bucket = bucketDiagnosis(record.result);
  const when = new Date(record.createdAt).toLocaleString();
  const filename = extractFileName(record.result.rawText, record.result.summary);

  return (
    <div className={`print-quality-card print-quality-card--${bucket}`}>
      <div className="print-quality-card__thumb" aria-hidden={!thumbnailDataUrl}>
        {thumbnailDataUrl ? (
          <img src={thumbnailDataUrl} alt={`Frame from ${record.printerName} print completion`} />
        ) : (
          <span className="print-quality-card__thumb-empty">No frame</span>
        )}
      </div>
      <div className="print-quality-card__body">
        <div className="print-quality-card__head">
          <span className={`print-quality-card__badge print-quality-card__badge--${bucket}`}>
            <BucketIcon bucket={bucket} /> {BUCKET_LABEL[bucket]}
          </span>
          <span className="print-quality-card__when">{when}</span>
        </div>
        {filename && <div className="print-quality-card__filename">{filename}</div>}
        <p className="print-quality-card__summary">{record.result.summary}</p>
        {record.result.rankedCauses.length > 0 && (
          <ul className="print-quality-card__causes">
            {record.result.rankedCauses.slice(0, 3).map((cause, i) => (
              <li key={`${cause.title}-${i}`}>
                <strong>{cause.title}</strong>
                {Number.isFinite(cause.confidence) && (
                  <span className="print-quality-card__confidence">
                    {Math.round(cause.confidence * 100)}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Try to extract a job filename from the telemetry that the analyzer echoes
 * back in `rawText`. Falls back to undefined — the summary still renders.
 */
function extractFileName(rawText: string | undefined, _summary: string): string | undefined {
  if (!rawText) return undefined;
  const match = /job\.fileName=([^"\s,}]+)/.exec(rawText);
  return match?.[1];
}
