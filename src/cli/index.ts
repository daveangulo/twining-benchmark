#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('twining-bench')
  .description('Benchmark harness for evaluating multi-agent coordination strategies')
  .version('0.1.0');

program.parse();
