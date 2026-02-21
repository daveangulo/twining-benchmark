import { Command } from 'commander';
import { CONDITION_REGISTRY, getAllConditionNames } from '../../conditions/registry.js';

/**
 * Create the `conditions` command group.
 */
export function createConditionsCommand(): Command {
  const cmd = new Command('conditions')
    .description('Manage coordination conditions');

  cmd
    .command('list')
    .description('List all registered coordination conditions')
    .action(() => {
      const names = getAllConditionNames();

      console.log('');
      console.log(
        '  ' +
        'Name'.padEnd(28) +
        'Coordination Tools'
      );
      console.log('  ' + '─'.repeat(70));

      for (const name of names) {
        const entry = CONDITION_REGISTRY[name];
        if (!entry) continue;
        const tools = entry.coordinationTools.length > 0
          ? entry.coordinationTools.join(', ')
          : '(none)';
        console.log('  ' + entry.name.padEnd(28) + tools);
      }

      console.log('');
      console.log('  Descriptions:');
      for (const name of names) {
        const entry = CONDITION_REGISTRY[name];
        if (!entry) continue;
        console.log(`    ${entry.name}:`);
        console.log(`      ${entry.description}`);
      }

      console.log('');
      console.log(`  Total: ${names.length} conditions`);
      console.log('');
    });

  return cmd;
}
