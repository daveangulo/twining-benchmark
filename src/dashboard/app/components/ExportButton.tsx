import React, { useState, useRef, useEffect } from 'react';

interface ExportButtonProps {
  runId: string;
}

type ExportFormat = 'markdown' | 'csv' | 'aggregated-csv' | 'png';

const FORMATS: { id: ExportFormat; label: string; ext: string }[] = [
  { id: 'markdown', label: 'Markdown', ext: '.md' },
  { id: 'csv', label: 'CSV (raw)', ext: '.csv' },
  { id: 'aggregated-csv', label: 'CSV (aggregated)', ext: '.csv' },
  { id: 'png', label: 'PNG Screenshot', ext: '.png' },
];

export function ExportButton({ runId }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doExport = async (format: ExportFormat) => {
    setExporting(true);
    setOpen(false);

    try {
      if (format === 'png') {
        // Use html2canvas to capture the main content area
        const el = document.querySelector('main');
        if (el) {
          const { default: html2canvas } = await import('html2canvas');
          const canvas = await html2canvas(el as HTMLElement);
          const link = document.createElement('a');
          link.download = `benchmark-${runId.slice(0, 8)}.png`;
          link.href = canvas.toDataURL('image/png');
          link.click();
        }
      } else {
        const res = await fetch(`/api/runs/${runId}/export/${format}`);
        if (!res.ok) throw new Error(`Export failed: ${res.statusText}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const fmt = FORMATS.find((f) => f.id === format);
        link.download = `benchmark-${runId.slice(0, 8)}${fmt?.ext ?? '.txt'}`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={exporting}
        style={{
          background: '#21262d',
          color: '#e1e4e8',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          cursor: exporting ? 'wait' : 'pointer',
          opacity: exporting ? 0.6 : 1,
        }}
      >
        {exporting ? 'Exporting...' : 'Export'}
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: '100%',
          marginTop: 4,
          background: '#1c2128',
          border: '1px solid #30363d',
          borderRadius: 8,
          overflow: 'hidden',
          zIndex: 10,
          minWidth: 160,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {FORMATS.map((fmt) => (
            <button
              key={fmt.id}
              onClick={() => doExport(fmt.id)}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 16px',
                background: 'transparent',
                color: '#e1e4e8',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = '#21262d';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {fmt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
