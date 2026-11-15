import React, { useState } from 'react';
import { useUiPreferences } from '../contexts/UiPreferencesContext';
import type { CurrencyCode } from '../types/finance';
import { formatMoney } from '../utils/formatters';

export interface CategorySlice {
  id: string;
  name: string;
  color: string;
  amount: number;
  percentage: number;
}

export function CategoryPieChart({
  slices,
  totalAmount,
  currency,
}: {
  slices: CategorySlice[];
  totalAmount: number;
  currency: CurrencyCode;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { isDark, tr } = useUiPreferences();

  if (slices.length === 0 || totalAmount <= 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-28 h-28 rounded-full border-4 border-dashed border-[#C6DAF7] dark:border-[#1B4A7C] flex items-center justify-center mb-3">
          <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6] font-medium">
            {tr('Sin gastos', 'No expenses')}
          </span>
        </div>
        <p className="text-sm text-[#496685] dark:text-[#A1C6F6]">
          {tr(
            'No hay gastos registrados en este mes para el perfil seleccionado.',
            'No expenses recorded this month for the selected profile.'
          )}
        </p>
      </div>
    );
  }

  const size = 210;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 84;
  const innerRadius = 52;

  let cumulativeAngle = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const angle = (slice.amount / totalAmount) * Math.PI * 2;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + angle;
    cumulativeAngle = endAngle;

    if (slices.length === 1) {
      return {
        ...slice,
        isFull: true,
        path: '',
      };
    }

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);

    const ix1 = cx + innerRadius * Math.cos(endAngle);
    const iy1 = cy + innerRadius * Math.sin(endAngle);
    const ix2 = cx + innerRadius * Math.cos(startAngle);
    const iy2 = cy + innerRadius * Math.sin(startAngle);

    const largeArc = angle > Math.PI ? 1 : 0;

    const path = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ');

    return {
      ...slice,
      isFull: false,
      path,
    };
  });

  const activeSlice = slices.find((s) => s.id === hoveredId) || null;
  const arcStroke = isDark ? '#062035' : '#FFFFFF';

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="overflow-visible"
          role="img"
          aria-label={tr(
            'Gráfico de torta de gastos por categoría',
            'Expenses by category pie chart'
          )}
        >
          {arcs.map((arc) => {
            const isHovered = hoveredId === arc.id;
            const dimmed = hoveredId !== null && !isHovered;

            if (arc.isFull) {
              return (
                <circle
                  key={arc.id}
                  cx={cx}
                  cy={cy}
                  r={(radius + innerRadius) / 2}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={radius - innerRadius}
                  onMouseEnter={() => setHoveredId(arc.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="cursor-pointer transition-opacity duration-150"
                />
              );
            }

            return (
              <path
                key={arc.id}
                d={arc.path}
                fill={arc.color}
                stroke={arcStroke}
                strokeWidth={2}
                opacity={dimmed ? 0.35 : 1}
                transform={isHovered ? `scale(1.03)` : undefined}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
                onMouseEnter={() => setHoveredId(arc.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="cursor-pointer transition-all duration-150"
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
          <span className="text-[11px] font-medium text-[#5A7694] dark:text-[#A1C6F6] truncate max-w-[96px]">
            {activeSlice ? activeSlice.name : tr('Total gastos', 'Total expenses')}
          </span>
          <span className="text-sm font-bold text-[#031725] dark:text-[#DAEAFF] font-mono-num">
            {formatMoney(activeSlice ? activeSlice.amount : totalAmount, currency, true)}
          </span>
          {activeSlice && (
            <span className="text-[11px] font-medium text-[#5A7694] dark:text-[#A1C6F6] font-mono-num">
              {activeSlice.percentage.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      <div className="w-full flex-1 space-y-2 max-h-[240px] overflow-y-auto pr-1">
        {slices.map((slice) => {
          const isHovered = hoveredId === slice.id;
          return (
            <button
              key={slice.id}
              type="button"
              onMouseEnter={() => setHoveredId(slice.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => setHoveredId(isHovered ? null : slice.id)}
              className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                isHovered
                  ? 'bg-[#DAEAFF]/70 dark:bg-[#022E5B]/80'
                  : 'hover:bg-[#EDF4FF] dark:hover:bg-[#022E5B]/45'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-sm text-[#355170] dark:text-[#DAEAFF] truncate font-medium">
                  {slice.name}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0 font-mono-num">
                <span className="text-xs text-[#5A7694] dark:text-[#A1C6F6] w-12 text-right">
                  {slice.percentage.toFixed(1)}%
                </span>
                <span className="text-sm font-semibold text-[#031725] dark:text-[#DAEAFF] min-w-[84px] text-right">
                  {formatMoney(slice.amount, currency)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface MonthlyBarPoint {
  monthKey: string;
  label: string;
  expenses: number;
  income: number;
}

export function SixMonthBarChart({
  data,
  currency,
  showIncomeComparison = false,
}: {
  data: MonthlyBarPoint[];
  currency: CurrencyCode;
  showIncomeComparison?: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const { isDark, tr } = useUiPreferences();

  const maxVal = Math.max(
    100,
    ...data.map((d) => (showIncomeComparison ? Math.max(d.expenses, d.income) : d.expenses))
  );
  const niceMax = Math.ceil(maxVal * 1.15);

  const chartHeight = 200;
  const chartWidth = 520;
  const padLeft = 58;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 34;

  const innerW = chartWidth - padLeft - padRight;
  const innerH = chartHeight - padTop - padBottom;
  const groupW = innerW / Math.max(1, data.length);

  const gridTicks = [0, 0.25, 0.5, 0.75, 1];
  const gridStroke = isDark ? '#123B66' : '#DCE8FA';
  const tickFill = isDark ? '#A1C6F6' : '#5A7694';
  const incomeColor = isDark ? '#34D399' : '#16A34A';
  const expenseColor = isDark ? '#499BED' : '#022E5B';
  const expenseHover = isDark ? '#A1C6F6' : '#499BED';

  return (
    <div className="w-full">
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-auto overflow-visible"
          role="img"
          aria-label={tr(
            'Gráfico de barras de los últimos 6 meses',
            'Last 6 months bar chart'
          )}
        >
          {gridTicks.map((t) => {
            const y = padTop + innerH * (1 - t);
            const val = niceMax * t;
            return (
              <g key={t}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={chartWidth - padRight}
                  y2={y}
                  stroke={gridStroke}
                  strokeDasharray={t === 0 ? undefined : '3 3'}
                  strokeWidth={1}
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill={tickFill}
                  className="text-[10px] font-mono-num"
                >
                  {formatMoney(val, currency, true)}
                </text>
              </g>
            );
          })}

          {data.map((point, idx) => {
            const centerX = padLeft + groupW * idx + groupW / 2;
            const isHovered = hoveredIdx === idx;
            const barWidth = showIncomeComparison
              ? Math.min(20, groupW * 0.28)
              : Math.min(34, groupW * 0.48);

            const expH = (point.expenses / niceMax) * innerH;
            const expY = padTop + innerH - expH;

            const incH = (point.income / niceMax) * innerH;
            const incY = padTop + innerH - incH;

            return (
              <g
                key={point.monthKey}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
              >
                <rect
                  x={padLeft + groupW * idx}
                  y={padTop}
                  width={groupW}
                  height={innerH + padBottom}
                  fill={
                    isHovered
                      ? isDark
                        ? 'rgba(73, 155, 237, 0.08)'
                        : 'rgba(2, 46, 91, 0.04)'
                      : 'transparent'
                  }
                  rx={6}
                />

                {showIncomeComparison ? (
                  <>
                    <rect
                      x={centerX - barWidth - 2}
                      y={incY}
                      width={barWidth}
                      height={Math.max(2, incH)}
                      rx={4}
                      fill={incomeColor}
                      opacity={hoveredIdx !== null && !isHovered ? 0.5 : 0.92}
                    />
                    <rect
                      x={centerX + 2}
                      y={expY}
                      width={barWidth}
                      height={Math.max(2, expH)}
                      rx={4}
                      fill={expenseColor}
                      opacity={hoveredIdx !== null && !isHovered ? 0.5 : 0.95}
                    />
                  </>
                ) : (
                  <rect
                    x={centerX - barWidth / 2}
                    y={expY}
                    width={barWidth}
                    height={Math.max(2, expH)}
                    rx={5}
                    fill={isHovered ? expenseHover : expenseColor}
                    className="transition-colors duration-150"
                  />
                )}

                <text
                  x={centerX}
                  y={chartHeight - 10}
                  textAnchor="middle"
                  fill={isHovered ? (isDark ? '#DAEAFF' : '#031725') : tickFill}
                  className={`text-[11px] ${isHovered ? 'font-semibold' : 'font-medium'}`}
                >
                  {point.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 pt-3 border-t border-[#E1EDFF] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-2 text-xs">
        {hoveredIdx !== null && data[hoveredIdx] ? (
          <div className="flex flex-wrap items-center gap-4 text-[#355170] dark:text-[#A1C6F6]">
            <span className="font-semibold text-[#031725] dark:text-[#DAEAFF]">
              {data[hoveredIdx].label}:
            </span>
            <span className="font-mono-num">
              {tr('Gastos:', 'Expenses:')}{' '}
              <strong className="text-[#031725] dark:text-[#DAEAFF]">
                {formatMoney(data[hoveredIdx].expenses, currency)}
              </strong>
            </span>
            {showIncomeComparison && (
              <span className="font-mono-num">
                {tr('Ingresos:', 'Income:')}{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {formatMoney(data[hoveredIdx].income, currency)}
                </strong>
              </span>
            )}
          </div>
        ) : (
          <span className="text-[#5A7694] dark:text-[#A1C6F6]">
            {tr(
              'Pasa el cursor sobre cualquier mes para ver el monto exacto.',
              'Hover over any month to see the exact amount.'
            )}
          </span>
        )}
        {showIncomeComparison && (
          <div className="flex items-center gap-4 text-[#355170] dark:text-[#A1C6F6]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-400 inline-block" />
              {tr('Ingresos', 'Income')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#022E5B] dark:bg-[#499BED] inline-block" />
              {tr('Gastos', 'Expenses')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ProjectionPoint {
  label: string;
  baseAmount: number;
  gainAmount: number;
  totalAmount: number;
}

export function ProjectionBarChart({
  points,
  currency,
  baseLabel,
  gainLabel,
}: {
  points: ProjectionPoint[];
  currency: CurrencyCode;
  baseLabel: string;
  gainLabel: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const { isDark, tr } = useUiPreferences();

  if (points.length === 0) return null;

  const step = points.length > 18 ? Math.ceil(points.length / 12) : 1;
  const visiblePoints = points.filter((_, idx) => idx % step === 0 || idx === points.length - 1);

  const maxVal = Math.max(100, ...visiblePoints.map((p) => p.totalAmount));
  const niceMax = Math.ceil(maxVal * 1.1);

  const chartHeight = 220;
  const chartWidth = 640;
  const padLeft = 64;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 34;

  const innerW = chartWidth - padLeft - padRight;
  const innerH = chartHeight - padTop - padBottom;
  const groupW = innerW / visiblePoints.length;
  const barW = Math.min(32, groupW * 0.56);

  const gridStroke = isDark ? '#123B66' : '#DCE8FA';
  const tickFill = isDark ? '#A1C6F6' : '#5A7694';
  const baseFill = isDark ? '#022E5B' : '#022E5B';
  const gainFill = '#499BED';

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label={tr(
          'Proyección de crecimiento de capital e intereses',
          'Capital and interest growth projection'
        )}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padTop + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padLeft}
                y1={y}
                x2={chartWidth - padRight}
                y2={y}
                stroke={gridStroke}
                strokeDasharray={t === 0 ? undefined : '3 3'}
                strokeWidth={1}
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                fill={tickFill}
                className="text-[10px] font-mono-num"
              >
                {formatMoney(niceMax * t, currency, true)}
              </text>
            </g>
          );
        })}

        {visiblePoints.map((pt, idx) => {
          const cx = padLeft + groupW * idx + groupW / 2;
          const totalH = (pt.totalAmount / niceMax) * innerH;
          const baseH = (pt.baseAmount / niceMax) * innerH;
          const gainH = Math.max(0, totalH - baseH);
          const baseY = padTop + innerH - baseH;
          const gainY = baseY - gainH;
          const isHovered = hoveredIdx === idx;

          return (
            <g
              key={pt.label}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              <rect
                x={padLeft + groupW * idx}
                y={padTop}
                width={groupW}
                height={innerH + padBottom}
                fill={
                  isHovered
                    ? isDark
                      ? 'rgba(73, 155, 237, 0.08)'
                      : 'rgba(2, 46, 91, 0.04)'
                    : 'transparent'
                }
                rx={6}
              />
              <rect
                x={cx - barW / 2}
                y={baseY}
                width={barW}
                height={Math.max(1, baseH)}
                fill={isDark ? '#1B528C' : baseFill}
                rx={gainH > 2 ? 0 : 4}
                opacity={hoveredIdx !== null && !isHovered ? 0.55 : 0.92}
              />
              {gainH > 0.5 && (
                <rect
                  x={cx - barW / 2}
                  y={gainY}
                  width={barW}
                  height={gainH}
                  fill={gainFill}
                  rx={4}
                  opacity={hoveredIdx !== null && !isHovered ? 0.55 : 1}
                />
              )}
              <text
                x={cx}
                y={chartHeight - 10}
                textAnchor="middle"
                fill={isHovered ? (isDark ? '#DAEAFF' : '#031725') : tickFill}
                className={`text-[10px] ${isHovered ? 'font-semibold' : 'font-medium'}`}
              >
                {pt.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-3 pt-3 border-t border-[#E1EDFF] dark:border-[#123B66] flex flex-wrap items-center justify-between gap-3 text-xs">
        {hoveredIdx !== null && visiblePoints[hoveredIdx] ? (
          <div className="flex flex-wrap items-center gap-4 text-[#355170] dark:text-[#A1C6F6] font-mono-num">
            <strong className="text-[#031725] dark:text-[#DAEAFF] font-sans">
              {visiblePoints[hoveredIdx].label}:
            </strong>
            <span>
              Total:{' '}
              <strong className="text-[#031725] dark:text-[#DAEAFF]">
                {formatMoney(visiblePoints[hoveredIdx].totalAmount, currency)}
              </strong>
            </span>
            <span>
              {baseLabel}:{' '}
              <strong className="text-[#031725] dark:text-[#DAEAFF]">
                {formatMoney(visiblePoints[hoveredIdx].baseAmount, currency)}
              </strong>
            </span>
            <span className="text-[#022E5B] dark:text-[#499BED]">
              {gainLabel}:{' '}
              <strong>+{formatMoney(visiblePoints[hoveredIdx].gainAmount, currency)}</strong>
            </span>
          </div>
        ) : (
          <span className="text-[#5A7694] dark:text-[#A1C6F6]">
            {tr(
              'Pasa el cursor sobre cada período para ver el desglose.',
              'Hover over each period to see the breakdown.'
            )}
          </span>
        )}
        <div className="flex items-center gap-4 text-[#355170] dark:text-[#A1C6F6]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#022E5B] dark:bg-[#1B528C] inline-block" />
            {baseLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#499BED] inline-block" />
            {gainLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
