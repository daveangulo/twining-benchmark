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
        'Sessions'.padEnd(10) +
        'Est. Duration'.padEnd(16) +
        'Target Type'.padEnd(25) +
        'Excl.'
      );
      console.log('  ' + '─'.repeat(82));

      for (const name of names) {
        const entry = SCENARIO_REGISTRY[name];
        if (!entry) continue;
        const m = entry.metadata;
        console.log(
          '  ' +
          m.name.padEnd(25) +
          String(m.agentSessionCount).padEnd(10) +
          `${m.estimatedDurationMinutes} min`.padEnd(16) +
          m.requiredTargetType.padEnd(25) +
          (m.excludeFromAll ? 'yes' : 'no')
        );
      }

      console.log('');
      console.log('  Scoring dimensions per scenario:');

      for (const name of names) {
        const entry = SCENARIO_REGISTRY[name];
        if (!entry) continue;
        console.log(`    ${entry.metadata.name}: ${entry.metadata.scoringDimensions.join(', ')}`);
      }

      console.log('');
      console.log(`  Total: ${names.length} scenarios`);
      console.log(`  Note: "Excl." = excluded from --scenario all (must be explicitly specified)`);
      console.log('');
    });

  return cmd;
}
