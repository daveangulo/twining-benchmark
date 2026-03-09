#!/usr/bin/env node

import { Command } from 'commander';
import { createRunCommand } from './commands/run.js';
import { createScenariosCommand } from './commands/scenarios.js';
import { createConditionsCommand } from './commands/conditions.js';
import { createResultsCommand } from './commands/results.js';
import { createDashboardCommand } from './commands/dashboard.js';
import { createInitCommand } from './commands/init.js';
import { createCleanCommand } from './commands/clean.js';
import { createExportCommand } from './commands/export.js';
import { createReproduceCommand } from './commands/reproduce.js';
import { createCloudCommand } from './commands/cloud.js';
import { createSmokeTestCommand } from './commands/smoke-test.js';

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
program.addCommand(createExportCommand());
program.addCommand(createReproduceCommand());
program.addCommand(createCloudCommand());
program.addCommand(createSmokeTestCommand());

program.parse();
