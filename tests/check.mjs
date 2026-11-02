// Syntax check for every shipped script without executing it. Run with `npm run check`
// (needs --experimental-vm-modules so ES modules can be parsed).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : file.endsWith('.js') ? [file] : [];
  });

const failures = [];
const parse = (file, create) => {
  try {
    create(readFileSync(file, 'utf8'));
  } catch (err) {
    failures.push(`${file}: ${err.message}`);
  }
};

const modules = walk('src');
if (typeof vm.SourceTextModule !== 'function') {
  console.error('vm.SourceTextModule is unavailable: run with --experimental-vm-modules');
  process.exit(1);
}
modules.forEach((file) => parse(file, (src) => new vm.SourceTextModule(src, { identifier: file })));
parse('sw.js', (src) => new vm.Script(src, { filename: 'sw.js' }));

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`${modules.length + 1} Dateien ohne Syntaxfehler.`);
