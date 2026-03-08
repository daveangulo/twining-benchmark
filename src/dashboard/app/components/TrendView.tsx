import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTrends } from '../hooks/useResults';
import type { TrendDataPoint } from '../types';

const CONDITION_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#79c0ff',
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function TrendView() {
  const { data: trends, loading, error } = useTrends();

  const { chartData, conditions } = useMemo(() => {
    if (!trends || trends.length === 0) return { chartData: [], conditions: [] };

    const conds = [...new Set(trends.map((t) => t.condition))].sort();

    // Group by run timestamp
    const byRun = new Map<string, { timestamp: string; runId: string; [key: string]: number | string }>();
    for (const t of trends) {
      const key = t.runId;
      if (!byRun.has(key)) {
        byRun.set(key, { timestamp: t.timestamp, runId: t.runId });
      }
      const entry = byRun.get(key)!;
      entry[t.condition] = t.compositeScore;
    }

    const data = [...byRun.values()]
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
      .map((d) => ({ ...d, label: formatDate(String(d.timestamp)) }));

    return { chartData: data, conditions: conds };
  }, [trends]);

  if (loading) return <div style={{ color: '#8b949e', padding: 32 }}>Loading trends...</div>;
  if (error) return <div style={{ color: '#f85149', padding: 32 }}>Error: {error}</div>;
  if (chartData.length < 2) {
    return (
      <div style={{ color: '#8b949e', padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 18, marginBottom: 8 }}>Not enough data for trends</p>
        <p>Trends require at least 2 completed benchmark runs.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Score Trends</h2>

      <div style={{
        background: '#161b22',
        borderRadius: 8,
        border: '1px solid #21262d',
        padding: 24,
      }}>
        <ResponsiveContainer width="100%" height={450}>
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#8b949e', fontSize: 12 }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#8b949e', fontSize: 12 }}
              label={{
                value: 'Composite Score',
                angle: -90,
                position: 'insideLeft',
                style: { fill: '#8b949e', fontSize: 12 },
              }}
            />
            <Tooltip
              contentStyle={{
                background: '#1c2128',
                border: '1px solid #30363d',
                borderRadius: 8,
                color: '#e1e4e8',
              }}
              labelFormatter={(label) => `Run: ${String(label)}`}
              formatter={(value: number, name: string) => [value.toFixed(1), name]}
            />
            <Legend />
            {conditions.map((cond, i) => (
              <Line
                key={cond}
                type="monotone"
                dataKey={cond}
                stroke={CONDITION_COLORS[i % CONDITION_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
