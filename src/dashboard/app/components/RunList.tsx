import React, { useState, useMemo } from 'react';
import { useRuns } from '../hooks/useResults';
import type { RunIndexEntry } from '../types';
import { ExportButton } from './ExportButton';

interface RunListProps {
  onSelectRun: (runId: string) => void;
}

type SortField = 'timestamp' | 'compositeScore' | 'duration';
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
  completed: '#3fb950',
  partial: '#d29922',
  failed: '#f85149',
  running: '#58a6ff',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RunList({ onSelectRun }: RunListProps) {
  const { data: runs, loading, error } = useRuns();
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [scenarioFilter, setScenarioFilter] = useState<string>('');

  const allScenarios = useMemo(() => {
    if (!runs) return [];
    const set = new Set<string>();
    for (const r of runs) for (const s of r.scenarios) set.add(s);
    return [...set].sort();
  }, [runs]);

  const sortedRuns = useMemo(() => {
    if (!runs) return [];
    let filtered = runs;
    if (scenarioFilter) {
      filtered = runs.filter((r) => r.scenarios.includes(scenarioFilter));
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'timestamp') cmp = a.timestamp.localeCompare(b.timestamp);
      else if (sortField === 'compositeScore') cmp = (a.compositeScore ?? 0) - (b.compositeScore ?? 0);
      else if (sortField === 'duration') cmp = a.duration - b.duration;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [runs, sortField, sortDir, scenarioFilter]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';

  if (loading) return <div style={{ color: '#8b949e', padding: 32 }}>Loading runs...</div>;
  if (error) return <div style={{ color: '#f85149', padding: 32 }}>Error: {error}</div>;
  if (!runs || runs.length === 0) {
    return (
      <div style={{ color: '#8b949e', padding: 32, textAlign: 'center' }}>
        <p style={{ fontSize: 18, marginBottom: 8 }}>No benchmark runs found</p>
        <p>Run <code style={{ background: '#21262d', padding: '2px 6px', borderRadius: 4 }}>twining-bench run --scenario &lt;name&gt;</code> to get started.</p>
      </div>
    );
  }

  const cellStyle: React.CSSProperties = {
    padding: '10px 16px',
    borderBottom: '1px solid #21262d',
    fontSize: 14,
    whiteSpace: 'nowrap',
  };
  const headerStyle: React.CSSProperties = {
    ...cellStyle,
    fontWeight: 600,
    color: '#8b949e',
    cursor: 'pointer',
    userSelect: 'none',
    position: 'sticky',
    top: 0,
    background: '#161b22',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Benchmark Runs</h2>
          <span style={{ color: '#8b949e', fontSize: 14 }}>{sortedRuns.length} runs</span>
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
        </div>
      </div>

      <div style={{
        borderRadius: 8,
        border: '1px solid #21262d',
        overflow: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headerStyle} onClick={() => toggleSort('timestamp')}>
                Date{sortIndicator('timestamp')}
              </th>
              <th style={headerStyle}>Run ID</th>
              <th style={headerStyle}>Scenarios</th>
              <th style={headerStyle}>Conditions</th>
              <th style={headerStyle}>Status</th>
              <th style={headerStyle} onClick={() => toggleSort('compositeScore')}>
                CES{sortIndicator('compositeScore')}
              </th>
              <th style={headerStyle} onClick={() => toggleSort('duration')}>
                Duration{sortIndicator('duration')}
              </th>
              <th style={headerStyle}>Export</th>
            </tr>
          </thead>
          <tbody>
            {sortedRuns.map((run) => (
              <tr
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '#161b22';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = '';
                }}
              >
                <td style={cellStyle}>{formatDate(run.timestamp)}</td>
                <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 13 }}>
                  {run.id.slice(0, 8)}
                </td>
                <td style={cellStyle}>{run.scenarios.join(', ')}</td>
                <td style={cellStyle}>{run.conditions.length}</td>
                <td style={cellStyle}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 500,
                    background: `${STATUS_COLORS[run.status] ?? '#8b949e'}20`,
                    color: STATUS_COLORS[run.status] ?? '#8b949e',
                  }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: STATUS_COLORS[run.status] ?? '#8b949e',
                    }} />
                    {run.status}
                  </span>
                </td>
                <td style={{ ...cellStyle, fontWeight: 600, fontFamily: 'monospace' }}>
                  {run.compositeScore != null ? run.compositeScore.toFixed(1) : '\u2014'}
                </td>
                <td style={cellStyle}>{formatDuration(run.duration)}</td>
                <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
                  <ExportButton runId={run.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
