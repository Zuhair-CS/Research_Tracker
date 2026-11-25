import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Reads chart colours from the CSS tokens (light/dark aware) because SVG attributes cannot use var(). */
function useChartTokens() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string) => s.getPropertyValue(name).trim();
    return {
      series: v('--series-1'),
      grid: v('--grid'),
      axis: v('--text-muted'),
      text: v('--text-secondary'),
      surface: v('--surface-2'),
      border: v('--border'),
      cursor: v('--hover'),
    };
  };
  const [tokens, setTokens] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTokens(read());
    mq.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);
  return tokens;
}

interface Props {
  title: string;
  data: { label: string; count: number }[];
  /** "horizontal" = bars grow left-to-right (long category names); "vertical" = columns (years). */
  orientation: 'horizontal' | 'vertical';
  labelHeader: string;
}

/**
 * One-series count chart with a hover tooltip and a "Table" view.
 * The single series uses one colour; the card title names what is counted.
 */
export function CountChart({ title, data, orientation, labelHeader }: Props) {
  const t = useChartTokens();
  const [asTable, setAsTable] = useState(false);
  const horizontal = orientation === 'horizontal';
  const height = horizontal ? Math.max(190, data.length * 36 + 44) : 270;
  const tick = { fill: t.axis, fontSize: 12 };

  return (
    <figure className="card chart-card">
      <figcaption className="chart-head">
        <h2>{title}</h2>
        <div className="segmented-mini" role="group" aria-label={`Display mode for ${title}`}>
          <button
            className={`seg-btn${!asTable ? ' active' : ''}`}
            type="button"
            onClick={() => setAsTable(false)}
            aria-pressed={!asTable}
          >
            Chart
          </button>
          <button
            className={`seg-btn${asTable ? ' active' : ''}`}
            type="button"
            onClick={() => setAsTable(true)}
            aria-pressed={asTable}
          >
            Table
          </button>
        </div>
      </figcaption>

      {data.length === 0 ? (
        <p className="muted empty-inline">No data yet.</p>
      ) : asTable ? (
        <div className="table-scroll chart-table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>{labelHeader}</th>
                <th className="num">Publications</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="num">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-canvas" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout={horizontal ? 'vertical' : 'horizontal'}
              margin={{ top: 10, right: 18, bottom: 6, left: 6 }}
              barCategoryGap={horizontal ? 8 : 6}
            >
              <CartesianGrid stroke={t.grid} strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={176} tick={{ ...tick, fill: t.text }} axisLine={false} tickLine={false} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={tick} axisLine={{ stroke: t.grid }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={34} />
                </>
              )}
              <Tooltip
                cursor={{ fill: t.cursor }}
                contentStyle={{
                  background: t.surface,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  fontSize: 13,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                }}
                labelStyle={{ color: t.text, fontWeight: 600, marginBottom: 2 }}
                itemStyle={{ color: t.text }}
                formatter={(value) => [value, 'Publications']}
              />
              <Bar
                dataKey="count"
                name="Publications"
                fill={t.series}
                maxBarSize={horizontal ? 20 : 32}
                radius={horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
