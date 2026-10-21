import { Command } from 'commander';
import { VERSION } from './version.js';

const program = new Command()
  .name('whatleaks')
  .description('See what an app you run sends home, and what it still sends after you opt out.')
  .version(VERSION);

await program.parseAsync(process.argv);
