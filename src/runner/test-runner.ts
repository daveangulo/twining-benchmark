/**
 * Run the target project's test suite and return pass/fail counts.
 *
 * Checks TypeScript compilation first, then runs vitest with JSON reporter
 * to extract structured pass/fail counts.
 */
export async function runTests(
  workingDir: string,
): Promise<{ pass: number; fail: number; compiles: boolean }> {
  try {
    const { execa } = await import('execa');

    // Check compilation
    let compiles = true;
    try {
      await execa('npx', ['tsc', '--noEmit'], {
        cwd: workingDir,
        stdio: 'pipe',
        timeout: 60_000,
      });
    } catch {
      compiles = false;
    }

    // Run tests
    try {
      const result = await execa('npx', ['vitest', 'run', '--reporter=json'], {
        cwd: workingDir,
        stdio: 'pipe',
        timeout: 120_000,
      });

      // Parse JSON output to get pass/fail counts
      try {
        const jsonOutput = JSON.parse(result.stdout) as {
          numPassedTests?: number;
          numFailedTests?: number;
        };
        return {
          pass: jsonOutput.numPassedTests ?? 0,
          fail: jsonOutput.numFailedTests ?? 0,
          compiles,
        };
      } catch {
        // JSON parse failed — infer from exit code
        return { pass: 1, fail: 0, compiles };
      }
    } catch {
      return { pass: 0, fail: 1, compiles };
    }
  } catch {
    return { pass: 0, fail: 0, compiles: false };
  }
}
