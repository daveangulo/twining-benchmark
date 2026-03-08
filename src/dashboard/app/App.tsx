import React, { useState } from 'react';
import type { View } from './types';
import { useStatus } from './hooks/useResults';
import { RunList } from './components/RunList';
import { ConditionComparison } from './components/ConditionComparison';
import { TrendView } from './components/TrendView';

const TABS: { id: View; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'compare', label: 'Compare' },
  { id: 'trends', label: 'Trends' },
];

export function App() {
  const [activeView, setActiveView] = useState<View>('runs');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const status = useStatus();

  const handleSelectRun = (runId: string) => {
    setSelectedRunId(runId);
    setActiveView('compare');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        borderBottom: '1px solid #2d333b',
        background: '#161b22',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#f0f6fc' }}>
            Twining Benchmark
          </h1>
          <nav style={{ display: 'flex', gap: 4 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  background: activeView === tab.id ? '#21262d' : 'transparent',
                  color: activeView === tab.id ? '#f0f6fc' : '#8b949e',
                }}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Status indicator */}
        {status.data?.active && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            background: '#0d419d',
            borderRadius: 12,
            fontSize: 13,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#58a6ff',
              animation: 'pulse 2s infinite',
            }} />
            Running: {status.data.scenario}/{status.data.condition}
            {status.data.percentComplete != null &&
              ` (${Math.round(status.data.percentComplete)}%)`}
          </div>
        )}
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: 24 }}>
        {activeView === 'runs' && (
          <RunList onSelectRun={handleSelectRun} />
        )}
        {activeView === 'compare' && (
          <ConditionComparison runId={selectedRunId} />
        )}
        {activeView === 'trends' && (
          <TrendView />
        )}
      </main>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
