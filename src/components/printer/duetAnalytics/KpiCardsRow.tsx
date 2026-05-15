/**
 * KpiCardsRow — the headline strip across the top of the analytics
 * grid: completed / cancelled / success-rate / total time / avg time /
 * total cost / filament cost / energy / CO2. All values come in
 * pre-formatted from the host via stats + costSummary totals.
 */
import { CheckCircle2, Clock, Leaf, Package, TrendingUp, XCircle, Zap } from 'lucide-react';
import { colors as COLORS } from '../../../utils/theme';
import { Card } from './Card';
import { fmtDuration, fmtMoney, fmtWeight } from './helpers';

export interface KpiStats {
  completed: number;
  cancelled: number;
  successRate: number;
  totalSec: number;
  avgSec: number;
}

export interface KpiCostTotals {
  totalCost: number;
  filamentCost: number;
  filamentG: number;
  energyKwh: number;
  energyCost: number;
  co2Kg: number;
}

export function KpiCardsRow({ stats, totals }: { stats: KpiStats; totals: KpiCostTotals }) {
  return (
    <div className="duet-analytics__cards">
      <Card
        icon={<CheckCircle2 size={14} />}
        value={stats.completed}
        label="Completed"
        color={COLORS.success}
      />
      <Card
        icon={<XCircle size={14} />}
        value={stats.cancelled}
        label="Cancelled"
        color={COLORS.error ?? '#d94545'}
      />
      <Card
        icon={<TrendingUp size={14} />}
        value={`${stats.successRate.toFixed(0)}%`}
        label="Success rate"
        color={COLORS.accent}
      />
      <Card icon={<Clock size={14} />} value={fmtDuration(stats.totalSec)} label="Total print time" />
      <Card icon={<Clock size={14} />} value={fmtDuration(stats.avgSec)} label="Avg per print" />
      <Card
        icon={<Package size={14} />}
        value={fmtMoney(totals.totalCost)}
        label="Total cost"
        color={COLORS.accent}
      />
      <Card
        icon={<Package size={14} />}
        value={fmtMoney(totals.filamentCost)}
        label="Filament"
        hint={fmtWeight(totals.filamentG)}
      />
      <Card
        icon={<Zap size={14} />}
        value={`${totals.energyKwh.toFixed(2)} kWh`}
        label="Energy"
        hint={fmtMoney(totals.energyCost)}
      />
      <Card icon={<Leaf size={14} />} value={`${totals.co2Kg.toFixed(2)} kg`} label="CO2 estimate" />
    </div>
  );
}
