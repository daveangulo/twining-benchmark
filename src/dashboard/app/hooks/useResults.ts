import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  RunIndexEntry,
  RunMetadata,
  ScoredResults,
  BenchmarkReport,
  LiveRunStatus,
  TrendDataPoint,
} from '../types';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function useFetch<T>(url: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: !!url,
    error: null,
  });

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json() as Promise<T>;
      })
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({ data: null, loading: false, error: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

export function useRuns(): FetchState<RunIndexEntry[]> {
  return useFetch<RunIndexEntry[]>('/api/runs');
}

export function useRunMetadata(runId: string | null): FetchState<RunMetadata> {
  return useFetch<RunMetadata>(runId ? `/api/runs/${runId}` : null);
}

export function useRunScores(runId: string | null): FetchState<ScoredResults[]> {
  return useFetch<ScoredResults[]>(runId ? `/api/runs/${runId}/scores` : null);
}

export function useRunReport(runId: string | null): FetchState<BenchmarkReport> {
  return useFetch<BenchmarkReport>(runId ? `/api/runs/${runId}/report` : null);
}

export function useTrends(): FetchState<TrendDataPoint[]> {
  return useFetch<TrendDataPoint[]>('/api/trends');
}

export function useStatus(): FetchState<LiveRunStatus> {
  const [state, setState] = useState<FetchState<LiveRunStatus>>({
    data: null,
    loading: true,
    error: null,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(() => {
    fetch('/api/status')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<LiveRunStatus>;
      })
      .then((data) => {
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setState({ data: null, loading: false, error: msg });
      });
  }, []);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus]);

  return state;
}

export function useTranscriptList(
  runId: string | null,
): FetchState<string[]> {
  return useFetch<string[]>(runId ? `/api/runs/${runId}/transcripts` : null);
}
