import React, { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ErrorBar,
  ResponsiveContainer,
} from 'recharts';
import { useRunScores, useRunMetadata } from '../hooks/useResults';
import type { ScoredResults } from '../types';
import { MetricDeepDive } from './MetricDeepDive';
import { ExportButton } from './ExportButton';

interface ConditionComparisonProps {
  runId: string | null;
}

const CONDITION_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#79c0ff',
];

interface ChartDatum {
  dimension: string;
  [key: string]: number | string | undefined;
}

function aggregate(scores: ScoredResults[]) {
  const groups = new Map<string, ScoredResults[]>();
  for (const s of scores) {
    const arr = groups.get(s.condition) ?? [];
    arr.push(s);
    groups.set(s.condition, arr);
  }

  const conditions = [...groups.keys()].sort();
  const dimensions = new Set<string>();
  for (const s of scores) for (const d of Object.keys(s.scores)) dimensions.add(d);

  const chartData: ChartDatum[] = [...dimensions].map((dim) => {
    const datum: ChartDatum = { dimension: dim };
    for (const cond of conditions) {
      const group = groups.get(cond) ?? [];
      const vals = group.map((s) => s.scores[dim]?.value ?? 0);
      const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const stddev = vals.length > 1
        ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1))
        : 0;
      datum[cond] = mean;
      datum[`${cond}_err`] = stddev;
    }
    return datum;
  });

  // Composite summary per condition
  const summary = conditions.map((cond) => {
    const group = groups.get(cond) ?? [];
    const composites = group.map((s) => s.composite);
    const mean = composites.length > 0
      ? composites.reduce((a, b) => a + b, 0) / composites.length
      : 0;
    const best = Math.max(...conditions.map((c) => {
      const g = groups.get(c) ?? [];
      return g.length > 0 ? g.reduce((a, s) => a + s.composite, 0) / g.length : 0;
    }));
    return { condition: cond, ces: mean, delta: mean - best };
  });

  return { conditions, chartData, summary, dimensions: [...dimensions] };
}

export function ConditionComparison({ runId }: ConditionComparisonProps) {
  const { data: scores, loading, error } = useRunScores(runId);
  const { data: metadata } = useRunMetadata(runId);
  const [deepDiveDimension, setDeepDiveDimension] = useState<string | null>(null);
  const [scenarioFilter, setScenarioFilter] = useState<string>('');

  const filteredScores = useMemo(() => {
    if (!scores) return [];
    if (!scenarioFilter) return scores;
    return scores.filter((s) => s.scenario === scenarioFilter);
  }, [scores, scenarioFilter]);

  const allScenarios = useMemo(() => {
    if (!scores) return [];
    return [...new Set(scores.map((s) => s.scenario))].sort();
  }, [scores]);

  const { conditions, chartData, summary } = useMemo(
    () => aggregate(filteredScores),
    [filteredScores],
  );

  if (!runId) {
    return (
      <div style={{ color: '#8b949e', padding: 32, textAlign: 'center' }}>
        Select a run from the Runs tab to compare conditions.
      </div>
    );
  }
  if (loading) return <div style={{ color: '#8b949e', padding: 32 }}>Loading scores...</div>;
  if (error) return <div style={{ color: '#f85149', padding: 32 }}>Error: {error}</div>;
  if (!scores || scores.length === 0) {
    return <div style={{ color: '#8b949e', padding: 32 }}>No scored results for this run.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>
            Condition Comparison
            {metadata && (
              <span style={{ color: '#8b949e', fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
                Run {runId.slice(0, 8)}
              </span>
            )}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {allScenarios.length > 1 && (
            <select
              value={scenarioFilter}
              onChange={(e) => setScenarioFilter(e.target.value)}
              style={{
                background: '#21262d',
                color: '#e1e4e8',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 13,
              }}
            >
              <option value="">All scenarios</option>
              {allScenarios.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <ExportButton runId={runId} />
        </div>
      </div>

      {/* Bar chart */}
      <div style={{
        background: '#161b22',
        borderRadius: 8,
        border: '1px solid #21262d',
        padding: 24,
        marginBottom: 24,
      }}>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis
              dataKey="dimension"
              tick={{ fill: '#8b949e', fontSize: 12 }}
              onClick={(e) => {
                if (e && typeof e.value === 'string') setDeepDiveDimension(e.value);
              }}
              style={{ cursor: 'pointer' }}
            />
            <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                background: '#1c2128',
                border: '1px solid #30363d',
                borderRadius: 8,
                color: '#e1e4e8',
              }}
            />
            <Legend />
            {conditions.map((cond, i) => (
              <Bar
                key={cond}
                dataKey={cond}
                fill={CONDITION_COLORS[i % CONDITION_COLORS.length]}
                radius={[4, 4, 0, 0]}
              >
                <ErrorBar dataKey={`${cond}_err`} width={4} stroke="#8b949e" />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        <p style={{ color: '#484f58', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
          Click a dimension name to see detailed breakdown
        </p>
      </div>

      {/* Summary table */}
      <div style={{
        borderRadius: 8,
        border: '1px solid #21262d',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Condition', 'CES', 'vs. Best', 'Status'].map((h) => (
                <th key={h} style={{
                  padding: '10px 16px',
                  fontWeight: 600,
                  color: '#8b949e',
                  fontSize: 13,
                  textAlign: 'left',
                  borderBottom: '1px solid #21262d',
                  background: '#161b22',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.map((row, i) => (
              <tr key={row.condition}>
                <td style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #21262d',
                  fontSize: 14,
                }}>
                  <span style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: CONDITION_COLORS[i % CONDITION_COLORS.length],
                    marginRight: 8,
                  }} />
                  {row.condition}
                </td>
                <td style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #21262d',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  fontSize: 14,
                }}>
                  {row.ces.toFixed(1)}
                </td>
                <td style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #21262d',
                  fontFamily: 'monospace',
                  fontSize: 14,
                  color: row.delta === 0 ? '#8b949e'
                    : row.delta > 0 ? '#3fb950' : '#f85149',
                }}>
                  {row.delta === 0 ? '\u2014' : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(1)}`}
                </td>
                <td style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #21262d',
                  fontSize: 13,
                  color: row.delta === 0 ? '#3fb950' : '#8b949e',
                }}>
                  {row.delta === 0 ? 'Best' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Deep dive panel */}
      {deepDiveDimension && (
        <MetricDeepDive
          dimension={deepDiveDimension}
          scores={filteredScores}
          onClose={() => setDeepDiveDimension(null)}
        />
      )}
    </div>
  );
}
