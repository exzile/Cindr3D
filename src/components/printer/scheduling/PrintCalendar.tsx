import { useCallback, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Moon,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { usePrinterStore } from '../../../store/printerStore';
import {
  useSchedulingStore,
  type DayOfWeek,
  type QuietWindow,
  type ScheduledPrint,
} from '../../../store/schedulingStore';
import './PrintCalendar.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_HEIGHT = 52; // px per hour — must match CSS
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type ViewMode = 'week' | 'day';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(h: number, m = 0): string {
  const period = h < 12 ? 'am' : 'pm';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${displayH}${period}` : `${displayH}:${String(m).padStart(2, '0')}${period}`;
}

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString(undefined, { ...opts, year: 'numeric' })} – ${end.toLocaleDateString(undefined, { ...opts, year: 'numeric' })}`;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString(undefined, { month: 'long' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}, ${start.getFullYear()}`;
}

function quietWindowCoversMinute(w: QuietWindow, h: number, m: number, dow: DayOfWeek): boolean {
  const cur = h * 60 + m;
  const start = w.startHour * 60 + w.startMinute;
  const end = w.endHour * 60 + w.endMinute;
  if (start <= end) {
    return w.days.includes(dow) && cur >= start && cur < end;
  }

  const previousDow = ((dow + 6) % 7) as DayOfWeek;
  return (w.days.includes(dow) && cur >= start) || (w.days.includes(previousDow) && cur < end);
}

function isHourQuiet(windows: QuietWindow[], h: number, dow: DayOfWeek): boolean {
  return windows.some((w) => quietWindowCoversMinute(w, h, 0, dow));
}

function eventsForDay(events: ScheduledPrint[], day: Date): ScheduledPrint[] {
  return events.filter((e) => isSameDay(new Date(e.scheduledStart), day));
}

function topPx(epochMs: number, dayDate: Date): number {
  const dayStart = new Date(dayDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1).getTime();
  const clamped = Math.min(Math.max(epochMs, dayStart.getTime()), dayEnd);
  const d = new Date(epochMs);
  d.setTime(clamped);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return (minutes / 60) * HOUR_HEIGHT;
}

function heightPx(durationMs: number): number {
  if (durationMs <= 0) return HOUR_HEIGHT * 0.5;
  return Math.max(22, (durationMs / 3_600_000) * HOUR_HEIGHT);
}

function formatWindowLabel(w: QuietWindow): string {
  const days = w.days.map((d) => DAY_LABELS[d].slice(0, 2)).join(',');
  const s = formatTime(w.startHour, w.startMinute);
  const e = formatTime(w.endHour, w.endMinute);
  return `${days}  ${s} – ${e}`;
}

// ─── Event chip ───────────────────────────────────────────────────────────────

interface EventChipProps {
  event: ScheduledPrint;
  dayDate: Date;
  printerName: (id: string | null) => string;
  onClick: (e: ScheduledPrint) => void;
}

function EventChip({ event, dayDate, printerName, onClick }: EventChipProps) {
  const top = topPx(event.scheduledStart, dayDate);
  const h = heightPx(event.estimatedDurationMs);
  const d = new Date(event.scheduledStart);
  const timeStr = `${formatTime(d.getHours(), d.getMinutes())}`;

  return (
    <button
      type="button"
      className={`print-calendar__event print-calendar__event--${event.status}`}
      style={{ top, height: h }}
      onClick={() => onClick(event)}
      title={event.fileName}
      aria-label={`Edit ${event.fileName}, ${timeStr}, ${printerName(event.printerId)}`}
    >
      <span className="print-calendar__event-name">{event.fileName}</span>
      <span className="print-calendar__event-time">
        {timeStr} · {printerName(event.printerId)}
      </span>
    </button>
  );
}

// ─── Schedule Event Modal ─────────────────────────────────────────────────────

interface ScheduleModalProps {
  initial?: Partial<ScheduledPrint> & { scheduledStart: number };
  existingId?: string;
  printers: Array<{ id: string; name: string }>;
  onSave: (data: Omit<ScheduledPrint, 'id' | 'createdAt'>) => void;
  onDelete?: () => void;
  onClose: () => void;
  isQuietAt: (ms: number) => boolean;
}

function ScheduleModal({
  initial,
  existingId,
  printers,
  onSave,
  onDelete,
  onClose,
  isQuietAt,
}: ScheduleModalProps) {
  const [filePath, setFilePath] = useState(initial?.filePath ?? '');
  const [printerId, setPrinterId] = useState(initial?.printerId ?? null);
  const [start, setStart] = useState(() => {
    const d = new Date(initial?.scheduledStart ?? Date.now());
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [durationHours, setDurationHours] = useState(
    initial?.estimatedDurationMs ? initial.estimatedDurationMs / 3_600_000 : 0,
  );
  const [note, setNote] = useState(initial?.note ?? '');

  const startMs = useMemo(() => new Date(start).getTime(), [start]);
  const inQuiet = !Number.isNaN(startMs) && isQuietAt(startMs);

  const handleSave = () => {
    if (!filePath.trim()) return;
    const fileName = filePath.split('/').filter(Boolean).pop() ?? filePath;
    onSave({
      filePath: filePath.trim(),
      fileName,
      printerId: printerId || null,
      scheduledStart: startMs,
      estimatedDurationMs: Math.max(0, durationHours * 3_600_000),
      note,
      status: initial?.status ?? 'scheduled',
      jobId: initial?.jobId ?? null,
    });
  };

  return (
    <div className="sched-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sched-modal">
        <div className="sched-modal__header">
          <CalendarDays size={16} />
          <span className="sched-modal__title">
            {existingId ? 'Edit scheduled print' : 'Schedule a print'}
          </span>
          <button className="sched-modal__close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="sched-modal__body">
          {inQuiet && (
            <div className="sched-modal__conflict">
              <Moon size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>This time falls inside a quiet-hours window. The print may be held until quiet hours end.</span>
            </div>
          )}

          <div className="sched-modal__field">
            <label>File path</label>
            <input
              type="text"
              placeholder="0:/gcodes/my-print.gcode"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
            />
          </div>

          <div className="sched-modal__field">
            <label>Start time</label>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>

          <div className="sched-modal__field">
            <label>Estimated duration (hours, 0 = unknown)</label>
            <input
              type="number"
              min="0"
              step="0.25"
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
            />
          </div>

          <div className="sched-modal__field">
            <label>Printer</label>
            <select value={printerId ?? ''} onChange={(e) => setPrinterId(e.target.value || null)}>
              <option value="">Auto / any printer</option>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="sched-modal__field">
            <label>Note (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="sched-modal__footer">
          {existingId && onDelete && (
            <button className="sched-modal__btn danger" onClick={onDelete}>
              <Trash2 size={13} style={{ marginRight: 4 }} />
              Delete
            </button>
          )}
          <button className="sched-modal__btn" onClick={onClose}>Cancel</button>
          <button
            className="sched-modal__btn primary"
            onClick={handleSave}
            disabled={!filePath.trim() || Number.isNaN(startMs)}
          >
            {existingId ? 'Save changes' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Quiet Window Form ────────────────────────────────────────────────────

function AddQuietWindowForm({ onAdd }: { onAdd: (w: Omit<QuietWindow, 'id'>) => void }) {
  const [label, setLabel] = useState('');
  const [startTime, setStartTime] = useState('22:00');
  const [endTime, setEndTime] = useState('07:00');
  const [days, setDays] = useState<DayOfWeek[]>([0, 1, 2, 3, 4, 5, 6]);

  const toggleDay = (d: DayOfWeek) =>
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  const handleAdd = () => {
    if (!startTime || !endTime || days.length === 0) return;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    onAdd({
      label: label.trim() || 'Quiet hours',
      days,
      startHour: sh,
      startMinute: sm,
      endHour: eh,
      endMinute: em,
    });
    setLabel('');
  };

  return (
    <div className="print-calendar__quiet-form">
      <div className="print-calendar__quiet-form-row">
        <label>Label</label>
        <input
          type="text"
          placeholder="Quiet hours"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div className="print-calendar__quiet-form-row">
        <label>From</label>
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <label>To</label>
        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </div>
      <div className="print-calendar__quiet-form-row">
        <label>Days</label>
        <div className="print-calendar__day-chips">
          {DAY_LABELS.map((day, i) => (
            <div
              key={i}
              className={`print-calendar__day-chip${days.includes(i as DayOfWeek) ? ' selected' : ''}`}
              onClick={() => toggleDay(i as DayOfWeek)}
            >
              {day[0]}
            </div>
          ))}
        </div>
      </div>
      <div className="print-calendar__quiet-form-row" style={{ justifyContent: 'flex-end' }}>
        <button className="print-calendar__icon-btn primary" onClick={handleAdd}>
          <Plus size={12} /> Add window
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PrintCalendar() {
  const printers = usePrinterStore((s) => s.printers);
  const printerOptions = useMemo(
    () => printers.map((p) => ({ id: p.id, name: p.name })),
    [printers],
  );
  const printerName = useCallback(
    (id: string | null) => printerOptions.find((p) => p.id === id)?.name ?? (id ? 'Unknown' : 'Any printer'),
    [printerOptions],
  );

  const scheduledPrints = useSchedulingStore((s) => s.scheduledPrints);
  const quietWindows = useSchedulingStore((s) => s.quietWindows);
  const addScheduledPrint = useSchedulingStore((s) => s.addScheduledPrint);
  const updateScheduledPrint = useSchedulingStore((s) => s.updateScheduledPrint);
  const removeScheduledPrint = useSchedulingStore((s) => s.removeScheduledPrint);
  const addQuietWindow = useSchedulingStore((s) => s.addQuietWindow);
  const removeQuietWindow = useSchedulingStore((s) => s.removeQuietWindow);
  const isQuietAt = useSchedulingStore((s) => s.isQuietAt);

  const [view, setView] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [showQuietPanel, setShowQuietPanel] = useState(false);
  const [modal, setModal] = useState<
    | { mode: 'add'; start: number }
    | { mode: 'edit'; event: ScheduledPrint }
    | null
  >(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const dayDate = useMemo(() => {
    const d = new Date(anchorDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [anchorDate]);

  const rangeLabel = useMemo(() => {
    if (view === 'week') {
      return formatDateRange(weekDays[0], weekDays[6]);
    }
    return dayDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [view, weekDays, dayDate]);

  const navigate = (dir: 1 | -1) => {
    setAnchorDate((prev) => addDays(prev, dir * (view === 'week' ? 7 : 1)));
  };

  const handleCellClick = (day: Date, hour: number) => {
    const d = new Date(day);
    d.setHours(hour, 0, 0, 0);
    setModal({ mode: 'add', start: d.getTime() });
  };

  const handleEventClick = (event: ScheduledPrint) => {
    setModal({ mode: 'edit', event });
  };

  const handleSave = (data: Omit<ScheduledPrint, 'id' | 'createdAt'>) => {
    if (modal?.mode === 'edit') {
      updateScheduledPrint(modal.event.id, data);
    } else {
      addScheduledPrint(data);
    }
    setModal(null);
  };

  const handleDelete = () => {
    if (modal?.mode === 'edit') {
      removeScheduledPrint(modal.event.id);
      setModal(null);
    }
  };

  const renderHourRows = (day: Date) => {
    const dow = day.getDay() as DayOfWeek;
    const dayEvents = eventsForDay(scheduledPrints, day);
    return HOURS.map((h) => {
      const quiet = isHourQuiet(quietWindows, h, dow);
      const hasEvent = dayEvents.some((e) => {
        const eh = new Date(e.scheduledStart).getHours();
        const dh = e.estimatedDurationMs > 0 ? Math.ceil(e.estimatedDurationMs / 3_600_000) : 1;
        return h >= eh && h < eh + dh;
      });
      return (
        <div
          key={h}
          className={`print-calendar__hour-cell${quiet ? ' quiet' : ''}${hasEvent ? ' has-event' : ''}`}
          onClick={() => handleCellClick(day, h)}
          title={quiet ? 'Quiet hours' : undefined}
        >
          {quiet && <span className="print-calendar__quiet-badge"><Moon size={8} /></span>}
        </div>
      );
    });
  };

  const renderWeekView = () => (
    <div className="print-calendar__week">
      {/* Header row */}
      <div className="print-calendar__week-header-gutter" />
      {weekDays.map((day, i) => (
        <div
          key={i}
          className={`print-calendar__week-header-day${isSameDay(day, today) ? ' today' : ''}`}
        >
          <div>{DAY_LABELS[day.getDay()]}</div>
          <div style={{ fontSize: 15, fontWeight: isSameDay(day, today) ? 700 : 400 }}>{day.getDate()}</div>
        </div>
      ))}

      {/* Scrollable body */}
      <div className="print-calendar__week-scroll" style={{ gridColumn: '1 / -1' }}>
        {/* Time gutter column */}
        <div style={{ display: 'contents' }}>
          {HOURS.map((h) => (
            <div key={h} className="print-calendar__hour-gutter" style={{ gridColumn: 1 }}>
              {h > 0 ? formatTime(h) : ''}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, di) => {
          const dayEvents = eventsForDay(scheduledPrints, day);
          return (
            <div key={di} style={{ gridColumn: di + 2, gridRow: 1, position: 'relative' }}>
              {renderHourRows(day)}
              {dayEvents.map((evt) => (
                <EventChip
                  key={evt.id}
                  event={evt}
                  dayDate={day}
                  printerName={printerName}
                  onClick={handleEventClick}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderDayView = () => {
    const dayEvents = eventsForDay(scheduledPrints, dayDate);
    return (
      <div className="print-calendar__day">
        <div className="print-calendar__day-scroll" style={{ gridColumn: '1 / -1' }}>
          {HOURS.map((h) => (
            <div key={h} className="print-calendar__hour-gutter" style={{ gridColumn: 1 }}>
              {h > 0 ? formatTime(h) : ''}
            </div>
          ))}
          <div style={{ gridColumn: 2, gridRow: 1, position: 'relative' }}>
            {renderHourRows(dayDate)}
            {dayEvents.map((evt) => (
              <EventChip
                key={evt.id}
                event={evt}
                dayDate={dayDate}
                printerName={printerName}
                onClick={handleEventClick}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="print-calendar">
      {/* Toolbar */}
      <div className="print-calendar__toolbar">
        <CalendarDays size={16} style={{ flexShrink: 0 }} />
        <h2>Print Schedule</h2>

        <div className="print-calendar__nav">
          <button className="print-calendar__nav-btn" onClick={() => navigate(-1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="print-calendar__range-label">{rangeLabel}</span>
          <button className="print-calendar__nav-btn" onClick={() => navigate(1)}>
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="print-calendar__toolbar-right">
          <div className="print-calendar__view-toggle">
            <button
              className={`print-calendar__view-btn${view === 'week' ? ' active' : ''}`}
              onClick={() => setView('week')}
            >
              Week
            </button>
            <button
              className={`print-calendar__view-btn${view === 'day' ? ' active' : ''}`}
              onClick={() => setView('day')}
            >
              Day
            </button>
          </div>
          <button
            className={`print-calendar__icon-btn${showQuietPanel ? ' primary' : ''}`}
            onClick={() => setShowQuietPanel((s) => !s)}
            title="Quiet hours"
          >
            <Moon size={13} /> Quiet hours
          </button>
          <button
            className="print-calendar__icon-btn primary"
            onClick={() => setModal({ mode: 'add', start: Date.now() })}
          >
            <Plus size={13} /> Schedule print
          </button>
        </div>
      </div>

      {/* Calendar body */}
      <div className="print-calendar__body">
        {view === 'week' ? renderWeekView() : renderDayView()}
      </div>

      {/* Quiet hours panel */}
      {showQuietPanel && (
        <div className="print-calendar__quiet-panel">
          <h3><Moon size={13} style={{ marginRight: 6 }} />Quiet hours</h3>
          <div className="print-calendar__quiet-list">
            {quietWindows.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                No quiet windows configured. Prints can start at any time.
              </span>
            )}
            {quietWindows.map((w) => (
              <div key={w.id} className="print-calendar__quiet-row" title={formatWindowLabel(w)}>
                <span className="print-calendar__quiet-row__label">{w.label}</span>
                <span className="print-calendar__quiet-row__days">
                  {w.days.map((d) => DAY_LABELS[d].slice(0, 2)).join(' ')}
                </span>
                <span className="print-calendar__quiet-row__time">
                  {formatTime(w.startHour, w.startMinute)} – {formatTime(w.endHour, w.endMinute)}
                </span>
                <button
                  className="print-calendar__quiet-row__del"
                  onClick={() => removeQuietWindow(w.id)}
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <AddQuietWindowForm onAdd={addQuietWindow} />
        </div>
      )}

      {/* Schedule / edit modal */}
      {modal && (
        <ScheduleModal
          initial={modal.mode === 'edit' ? modal.event : { scheduledStart: modal.start }}
          existingId={modal.mode === 'edit' ? modal.event.id : undefined}
          printers={printerOptions}
          onSave={handleSave}
          onDelete={modal.mode === 'edit' ? handleDelete : undefined}
          onClose={() => setModal(null)}
          isQuietAt={isQuietAt}
        />
      )}
    </div>
  );
}
