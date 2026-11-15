import React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type { CurrencyCode, ProfileFilter, UserProfile } from '../types/finance';
import { formatMoney, getProfileLabel } from '../utils/formatters';

export interface SavingsGrowthPoint {
  monthKey: string;
  label: string;
  ahorroAcumulado: number;
  goalSaverByProfile: Record<string, number>;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    dataKey?: string;
  }>;
  label?: string;
  currency: CurrencyCode;
}

function CustomGrowthTooltip({ active, payload, label, currency }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-white dark:bg-[#062035] border border-[#D3E3FA] dark:border-[#1B4A7C] rounded-lg shadow-md px-3.5 py-2.5 text-xs">
      <div className="font-semibold text-[#031725] dark:text-[#DAEAFF] mb-1.5">{label}</div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div
            key={String(entry.dataKey)}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-1.5 text-[#355170] dark:text-[#A1C6F6]">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-mono-num font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {formatMoney(Number(entry.value || 0), currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SavingsGrowthLineChartProps {
  data: SavingsGrowthPoint[];
  currency: CurrencyCode;
  activeProfile: ProfileFilter;
  profiles: UserProfile[];
  showSavingsLine: boolean;
}

export function getSafeProfileChartColor(rawColor: string | undefined, isDark: boolean): string {
  const c = (rawColor || '#499BED').toUpperCase();
  if (isDark && (c === '#022E5B' || c === '#031725')) {
    return '#DAEAFF';
  }
  return rawColor || '#499BED';
}

export function SavingsGrowthLineChart({
  data,
  currency,
  activeProfile,
  profiles,
  showSavingsLine,
}: SavingsGrowthLineChartProps) {
  const { isDark, tr } = useUiPreferences();

  const hasAnyData = data.some(
    (d) =>
      Math.abs(d.ahorroAcumulado) > 0 ||
      Object.values(d.goalSaverByProfile).some((v) => v > 0)
  );

  if (!hasAnyData) {
    return (
      <div className="py-12 text-center text-sm text-[#496685] dark:text-[#A1C6F6]">
        {tr(
          'Aún no hay movimientos ni saldos en GoalSaver para graficar la evolución histórica.',
          'No transactions or GoalSaver balances yet to plot historical growth.'
        )}
      </div>
    );
  }

  const savingsLabel =
    activeProfile === 'all'
      ? tr('Ahorro acumulado (Hogar)', 'Cumulative savings (Household)')
      : `${tr('Ahorro acumulado', 'Cumulative savings')} (${getProfileLabel(activeProfile, profiles)})`;

  const gridStroke = isDark ? '#123B66' : '#DCE8FA';
  const tickColor = isDark ? '#A1C6F6' : '#5A7694';
  const dotBorder = isDark ? '#062035' : '#FFFFFF';
  const savingsColor = isDark ? '#34D399' : '#059669';

  const visibleProfiles =
    activeProfile === 'all' ? profiles : profiles.filter((p) => p.id === activeProfile);

  return (
    <div className="w-full h-[290px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 10, right: 16, left: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: tickColor, fontSize: 12 }}
            axisLine={{ stroke: gridStroke }}
            tickLine={false}
            dy={6}
          />
          <YAxis
            tickFormatter={(val: number) => formatMoney(val, currency, true)}
            tick={{ fill: tickColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={68}
          />
          <Tooltip content={<CustomGrowthTooltip currency={currency} />} />
          <Legend
            wrapperStyle={{ fontSize: '12px', paddingTop: '12px', color: tickColor }}
            iconType="circle"
          />

          {showSavingsLine && (
            <Line
              type="monotone"
              dataKey="ahorroAcumulado"
              name={savingsLabel}
              stroke={savingsColor}
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: savingsColor, strokeWidth: 0 }}
              activeDot={{ r: 5.5, fill: savingsColor, stroke: dotBorder, strokeWidth: 2 }}
            />
          )}

          {visibleProfiles.map((p) => {
            const strokeColor = getSafeProfileChartColor(p.color, isDark);
            return (
              <Line
                key={p.id}
                type="monotone"
                dataKey={`goalSaverByProfile.${p.id}`}
                name={`GoalSaver · ${p.name}`}
                stroke={strokeColor}
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: strokeColor, strokeWidth: 0 }}
                activeDot={{ r: 5.5, fill: strokeColor, stroke: dotBorder, strokeWidth: 2 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
