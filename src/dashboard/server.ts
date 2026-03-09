import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ResultsStore } from '../results/store.js';
import { IndexManager } from '../results/index-manager.js';
import {
  exportMarkdown,
  exportCsv,
  exportAggregatedCsv,
} from '../results/exporter.js';
import { buildReport } from '../cli/commands/results.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface DashboardServerOptions {
  resultsDir: string;
  port: number;
  /** Optional basic auth in "user:pass" format */
  auth?: string;
}

// ─── Basic Auth Middleware ──────────────────────────────────────────

function basicAuthMiddleware(
  userPass: string,
): (req: Request, res: Response, next: NextFunction) => void {
  const expected = Buffer.from(userPass).toString('base64');

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = header.slice('Basic '.length);
    if (token !== expected) {
      res.status(403).json({ error: 'Invalid credentials' });
      return;
    }

    next();
  };
}

// ─── Server Factory ────────────────────────────────────────────────

export function createDashboardServer(options: DashboardServerOptions): Express {
  const app = express();
  const store = new ResultsStore(options.resultsDir);
  const index = new IndexManager(options.resultsDir);

  // Basic auth guard (if configured)
  if (options.auth) {
    app.use(basicAuthMiddleware(options.auth));
  }

  // JSON parsing
  app.use(express.json());

  // ── API Routes ─────────────────────────────────────────────────

  // GET /api/runs — list all runs
  app.get('/api/runs', async (_req: Request, res: Response) => {
    try {
      const runs = await index.listAll();
      res.json(runs);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/runs/:id — single run metadata
  app.get('/api/runs/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const metadata = await store.getMetadata(id);
      res.json(metadata);
    } catch (err) {
      res.status(404).json({ error: `Run not found: ${req.params['id'] as string}` });
    }
  });

  // GET /api/runs/:id/scores — scored results
  app.get('/api/runs/:id/scores', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const scores = await store.loadScores(id);
      res.json(scores);
    } catch (err) {
      res.status(404).json({ error: `Scores not found for run: ${req.params['id'] as string}` });
    }
  });

  // GET /api/runs/:id/transcripts — list transcript session IDs
  app.get('/api/runs/:id/transcripts', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string;
      const transcripts = await store.loadAllTranscripts(id);
      const sessionIds = transcripts.map((t) => t.sessionId);
      res.json(sessionIds);
    } catch (err) {
      res.status(404).json({ error: `Transcripts not found for run: ${req.params['id'] as string}` });
    }
  });

  // GET /api/runs/:id/transcripts/:sessionId — specific transcript
  app.get(
    '/api/runs/:id/transcripts/:sessionId',
    async (req: Request, res: Response) => {
      try {
        const id = req.params['id'] as string;
        const sessionId = req.params['sessionId'] as string;
        const transcript = await store.loadTranscript(id, sessionId);
        res.json(transcript);
      } catch (err) {
        const sessionId = req.params['sessionId'] as string;
        const id = req.params['id'] as string;
        res.status(404).json({
          error: `Transcript not found: ${sessionId} in run ${id}`,
        });
      }
    },
  );

  // GET /api/runs/:id/export/:format — export as markdown/csv/aggregated-csv
  app.get(
    '/api/runs/:id/export/:format',
    async (req: Request, res: Response) => {
      try {
        const id = req.params['id'] as string;
        const format = req.params['format'] as string;
        const metadata = await store.getMetadata(id);
        const scores = await store.loadScores(id);
        const report = buildReport(metadata, scores);

        switch (format) {
          case 'markdown': {
            const md = exportMarkdown(report);
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${id}-report.md"`,
            );
            res.send(md);
            break;
          }
          case 'csv': {
            const csv = exportCsv(scores);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${id}-scores.csv"`,
            );
            res.send(csv);
            break;
          }
          case 'aggregated-csv': {
            const aggCsv = exportAggregatedCsv(report.aggregated);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="${id}-aggregated.csv"`,
            );
            res.send(aggCsv);
            break;
          }
          default:
            res.status(400).json({
              error: `Unsupported format: ${format}. Use markdown, csv, or aggregated-csv.`,
            });
        }
      } catch (err) {
        res.status(404).json({ error: `Export failed for run: ${req.params['id'] as string}` });
      }
    },
  );

  // GET /api/trends — score trends across runs
  app.get('/api/trends', async (_req: Request, res: Response) => {
    try {
      const runs = await index.listAll();
      const trends: Record<
        string,
        { runId: string; timestamp: string; compositeScore: number }[]
      > = {};

      for (const run of runs) {
        if (run.status !== 'completed') continue;

        try {
          const scores = await store.loadScores(run.id);
          // Group scores by condition and compute mean composite
          const conditionScores = new Map<string, number[]>();
          for (const score of scores) {
            const arr = conditionScores.get(score.condition) ?? [];
            arr.push(score.composite);
            conditionScores.set(score.condition, arr);
          }

          for (const [condition, composites] of conditionScores) {
            if (!trends[condition]) {
              trends[condition] = [];
            }
            const mean =
              composites.reduce((a, b) => a + b, 0) / composites.length;
            trends[condition].push({
              runId: run.id,
              timestamp: run.timestamp,
              compositeScore: Math.round(mean * 10) / 10,
            });
          }
        } catch {
          // Skip runs with missing score data
        }
      }

      // Flatten to array of TrendDataPoint
      const trendPoints: { runId: string; timestamp: string; condition: string; compositeScore: number }[] = [];
      for (const [condition, points] of Object.entries(trends)) {
        for (const point of points) {
          trendPoints.push({ ...point, condition });
        }
      }

      res.json(trendPoints);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/status — current run status
  app.get('/api/status', async (_req: Request, res: Response) => {
    try {
      const statusPath = join(options.resultsDir, '.current-run-status.json');
      const raw = await readFile(statusPath, 'utf-8');
      res.json(JSON.parse(raw));
    } catch {
      res.json({ active: false });
    }
  });

  // ── Static SPA Serving ─────────────────────────────────────────

  const distDir = resolve(
    import.meta.dirname ?? new URL('.', import.meta.url).pathname,
    '../../dist/dashboard/public',
  );

  app.use(express.static(distDir));

  // Catch-all for client-side routing — serve index.html
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(join(distDir, 'index.html'), (err) => {
      if (err) {
        // SPA not built yet; return 404 for non-API routes
        res.status(404).json({ error: 'Dashboard SPA not built' });
      }
    });
  });

  return app;
}

// ─── Server Startup ────────────────────────────────────────────────

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<void> {
  const app = createDashboardServer(options);

  return new Promise<void>((resolvePromise) => {
    app.listen(options.port, '0.0.0.0', () => {
      console.log(`Dashboard server listening on http://0.0.0.0:${options.port}`);
      resolvePromise();
    });
  });
}
