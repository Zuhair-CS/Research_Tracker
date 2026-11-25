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
      cursor: v('--hover'),
    };
  };
  const [tokens, setTokens] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTokens(read());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
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
  const height = horizontal ? Math.max(180, data.length * 34 + 40) : 260;
  const tick = { fill: t.axis, fontSize: 12 };

  return (
    <figure className="card chart-card">
      <figcaption className="chart-head">
        <h2>{title}</h2>
        <button className="btn small ghost" type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </figcaption>

      {data.length === 0 ? (
        <p className="muted">No data yet.</p>
      ) : asTable ? (
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
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout={horizontal ? 'vertical' : 'horizontal'}
              margin={{ top: 8, right: 16, bottom: 4, left: 4 }}
              barCategoryGap={horizontal ? 6 : 4}
            >
              <CartesianGrid stroke={t.grid} vertical={horizontal} horizontal={!horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={170} tick={{ ...tick, fill: t.text }} axisLine={false} tickLine={false} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={tick} axisLine={{ stroke: t.grid }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={32} />
                </>
              )}
              <Tooltip
                cursor={{ fill: t.cursor }}
                contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, borderRadius: 6, fontSize: 13 }}
                labelStyle={{ color: t.text, fontWeight: 600 }}
                itemStyle={{ color: t.text }}
                formatter={(value) => [value, 'Publications']}
              />
              <Bar
                dataKey="count"
                name="Publications"
                fill={t.series}
                maxBarSize={horizontal ? 18 : 28}
                radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
