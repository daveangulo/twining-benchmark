import { Command } from 'commander';
import { SCENARIO_REGISTRY, getAllScenarioNames } from '../../scenarios/registry.js';

/**
 * Create the `scenarios` command group.
 */
export function createScenariosCommand(): Command {
  const cmd = new Command('scenarios')
    .description('Manage benchmark scenarios');

  cmd
    .command('list')
    .description('List all registered scenarios')
    .action(() => {
      const names = getAllScenarioNames();

      // Table header
      console.log('');
      console.log(
        '  ' +
        'Name'.padEnd(25) +
        'Agents'.padEnd(8) +
        'Est. Duration'.padEnd(16) +
        'Target Type'.padEnd(16) +
        'Scoring Dimensions'
      );
      console.log('  ' + '─'.repeat(95));

      for (const name of names) {
        const entry = SCENARIO_REGISTRY[name];
        if (!entry) continue;
        const m = entry.metadata;
        const dims = m.scoringDimensions.join(', ');
        console.log(
          '  ' +
          m.name.padEnd(25) +
          String(m.agentSessionCount).padEnd(8) +
          `${m.estimatedDurationMinutes} min`.padEnd(16) +
          m.requiredTargetType.padEnd(16) +
          dims
        );
      }

      console.log('');
      console.log(`  Total: ${names.length} scenarios`);
      console.log(`  Note: scale-stress-test is excluded from --scenario all (must be explicitly specified)`);
      console.log('');
    });

  return cmd;
}
