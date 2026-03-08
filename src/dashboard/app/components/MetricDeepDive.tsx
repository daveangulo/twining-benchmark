import React, { useMemo, useState } from 'react';
import {
  ComposedChart,
  Bar,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
} from 'recharts';
import type { ScoredResults } from '../types';

interface MetricDeepDiveProps {
  dimension: string;
  scores: ScoredResults[];
  onClose: () => void;
}

const CONDITION_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#79c0ff',
];

export function MetricDeepDive({ dimension, scores, onClose }: MetricDeepDiveProps) {
  const [expandedJustification, setExpandedJustification] = useState<number | null>(null);

  const { conditions, boxData, scatterData, justifications, tokenData } = useMemo(() => {
    const groups = new Map<string, ScoredResults[]>();
    for (const s of scores) {
      const arr = groups.get(s.condition) ?? [];
      arr.push(s);
      groups.set(s.condition, arr);
    }

    const conds = [...groups.keys()].sort();

    // Box plot data (using bar + error bar to approximate)
    const bData = conds.map((cond) => {
      const group = groups.get(cond) ?? [];
      const vals = group.map((s) => s.scores[dimension]?.value ?? 0).sort((a, b) => a - b);
      const n = vals.length;
      if (n === 0) return { condition: cond, median: 0, q1: 0, q3: 0, min: 0, max: 0 };
      const median = n % 2 === 0 ? ((vals[n / 2 - 1] ?? 0) + (vals[n / 2] ?? 0)) / 2 : vals[Math.floor(n / 2)] ?? 0;
      const q1 = vals[Math.floor(n * 0.25)] ?? 0;
      const q3 = vals[Math.floor(n * 0.75)] ?? 0;
      return {
        condition: cond,
        median,
        q1,
        q3,
        min: vals[0] ?? 0,
        max: vals[n - 1] ?? 0,
        range: [q1, q3] as [number, number],
      };
    });

    // Scatter points for individual runs
    const sData = conds.flatMap((cond, ci) =>
      (groups.get(cond) ?? []).map((s, i) => ({
        condition: cond,
        value: s.scores[dimension]?.value ?? 0,
        x: ci,
        iteration: s.iteration,
        colorIdx: ci,
        key: `${cond}-${i}`,
      })),
    );

    // Justifications
    const justs: { condition: string; iteration: number; text: string; method: string }[] = [];
    for (const s of scores) {
      const dim = s.scores[dimension];
      if (dim?.justification) {
        justs.push({
          condition: s.condition,
          iteration: s.iteration,
          text: dim.justification,
          method: dim.method,
        });
      }
    }

    // Token usage per condition
    const tData = conds.map((cond) => {
      const group = groups.get(cond) ?? [];
      const avgInput = group.reduce((a, s) => a + s.metrics.inputTokens, 0) / (group.length || 1);
      const avgOutput = group.reduce((a, s) => a + s.metrics.outputTokens, 0) / (group.length || 1);
      const avgWall = group.reduce((a, s) => a + s.metrics.wallTimeMs, 0) / (group.length || 1);
      return { condition: cond, inputTokens: avgInput, outputTokens: avgOutput, wallTimeMs: avgWall };
    });

    return { conditions: conds, boxData: bData, scatterData: sData, justifications: justs, tokenData: tData };
  }, [scores, dimension]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: '50%',
      minWidth: 500,
      height: '100vh',
      background: '#0d1117',
      borderLeft: '1px solid #21262d',
      overflowY: 'auto',
      zIndex: 100,
      boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
      padding: 24,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>
          {dimension}
          <span style={{ color: '#8b949e', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            Deep Dive
          </span>
        </h3>
        <button
          onClick={onClose}
          style={{
            background: '#21262d',
            color: '#e1e4e8',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Close
        </button>
      </div>

      {/* Box plot approximation using bars */}
      <div style={{
        background: '#161b22',
        borderRadius: 8,
        border: '1px solid #21262d',
        padding: 16,
        marginBottom: 20,
      }}>
        <h4 style={{ fontSize: 14, color: '#8b949e', marginBottom: 12 }}>Score Distribution</h4>
        <ResponsiveContainer width="100%" height={250}>
          <ComposedChart data={boxData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="condition" tick={{ fill: '#8b949e', fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: '#1c2128',
                border: '1px solid #30363d',
                borderRadius: 8,
                color: '#e1e4e8',
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [value.toFixed(1), name]}
            />
            <Bar dataKey="median" fill="#58a6ff" radius={[4, 4, 0, 0]} name="Median" />
            <Scatter data={scatterData} fill="#f0f6fc" name="Individual runs">
              {scatterData.map((entry) => (
                <circle key={entry.key} r={4} fill={CONDITION_COLORS[entry.colorIdx % CONDITION_COLORS.length]} opacity={0.7} />
              ))}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
          {boxData.map((b) => (
            <span key={b.condition} style={{ fontSize: 12, color: '#8b949e' }}>
              {b.condition}: {b.min.toFixed(0)}\u2013{b.max.toFixed(0)} (med: {b.median.toFixed(1)})
            </span>
          ))}
        </div>
      </div>

      {/* Token usage */}
      <div style={{
        background: '#161b22',
        borderRadius: 8,
        border: '1px solid #21262d',
        padding: 16,
        marginBottom: 20,
      }}>
        <h4 style={{ fontSize: 14, color: '#8b949e', marginBottom: 12 }}>Token Usage (avg per iteration)</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={tokenData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
            <XAxis dataKey="condition" tick={{ fill: '#8b949e', fontSize: 11 }} />
            <YAxis tick={{ fill: '#8b949e', fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{
                background: '#1c2128',
                border: '1px solid #30363d',
                borderRadius: 8,
                color: '#e1e4e8',
                fontSize: 12,
              }}
              formatter={(v: number) => v.toLocaleString()}
            />
            <Legend />
            <Bar dataKey="inputTokens" fill="#58a6ff" name="Input" radius={[4, 4, 0, 0]} />
            <Bar dataKey="outputTokens" fill="#3fb950" name="Output" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Justifications */}
      {justifications.length > 0 && (
        <div style={{
          background: '#161b22',
          borderRadius: 8,
          border: '1px solid #21262d',
          padding: 16,
        }}>
          <h4 style={{ fontSize: 14, color: '#8b949e', marginBottom: 12 }}>
            LLM-Judge Justifications ({justifications.length})
          </h4>
          {justifications.map((j, i) => (
            <div
              key={i}
              style={{
                padding: '8px 12px',
                borderBottom: i < justifications.length - 1 ? '1px solid #21262d' : 'none',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setExpandedJustification(expandedJustification === i ? null : i)}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  {j.condition} / iter {j.iteration}
                </span>
                <span style={{
                  fontSize: 11,
                  padding: '1px 6px',
                  background: '#21262d',
                  borderRadius: 4,
                  color: '#8b949e',
                }}>
                  {j.method}
                </span>
              </div>
              {expandedJustification === i && (
                <p style={{ fontSize: 13, color: '#b1bac4', marginTop: 8, lineHeight: 1.5 }}>
                  {j.text}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
