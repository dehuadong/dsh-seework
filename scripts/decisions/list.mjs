import { collect, directoryNavigation } from './lib.mjs';

const args = process.argv.slice(2);
let selection;
if (args.length === 0) selection = {};
else if (args.length === 1 && args[0] === '--shared') selection = {kind: 'shared'};
else if (args.length === 1 && args[0] === '--legacy') selection = {kind: 'legacy'};
else if (args.length === 2 && args[0] === '--context' && args[1]) selection = {kind: 'context', id: args[1]};
else {
  console.error('Usage: node scripts/decisions/list.mjs [--context <id> | --shared | --legacy]');
  process.exitCode = 2;
}
if (selection) {
  const { records, recordRoots, errors } = await collect();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else if (selection.kind === 'shared' && !recordRoots.some(owner => owner.context === null)) {
    console.error('No shared record directory is configured');
    process.exitCode = 2;
  } else if (selection.kind === 'context' && !recordRoots.some(owner => owner.context === selection.id)) {
    console.error(`Unknown record context: ${selection.id}`);
    process.exitCode = 2;
  } else console.log(directoryNavigation(records, recordRoots, selection).join('\n'));
}
