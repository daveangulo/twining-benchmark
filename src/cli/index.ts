#!/usr/bin/env node

import { Command } from 'commander';
import { createRunCommand } from './commands/run.js';
import { createScenariosCommand } from './commands/scenarios.js';
import { createConditionsCommand } from './commands/conditions.js';
import { createResultsCommand } from './commands/results.js';
import { createDashboardCommand } from './commands/dashboard.js';
import { createInitCommand } from './commands/init.js';
import { createCleanCommand } from './commands/clean.js';

const program = new Command();

program
  .name('twining-bench')
  .description('Benchmark harness for evaluating multi-agent coordination strategies')
  .version('0.1.0');

program.addCommand(createRunCommand());
program.addCommand(createScenariosCommand());
program.addCommand(createConditionsCommand());
program.addCommand(createResultsCommand());
program.addCommand(createDashboardCommand());
program.addCommand(createInitCommand());
program.addCommand(createCleanCommand());

program.parse();
