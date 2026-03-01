/**
 * Updates tsconfig.json "exclude" so that every .js file that has a sibling .ts
 * (same directory, same basename) is excluded. Prevents "overwritten by multiple
 * input files" when migrating JS to TS with a re-export .js.
 *
 * Run before build (see package.json). When the JS→TS migration is complete and
 * there are no more re-export .js files, this script can be removed and
 * "exclude" in tsconfig.json can be left as ["node_modules", "dist"].
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const tsconfigPath = join(root, 'tsconfig.json');

function findJsWithSiblingTs(dir, basePath = 'src') {
  const entries = readdirSync(dir, { withFileTypes: true });
  const reExports = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = join(basePath, e.name);
    if (e.isDirectory()) {
      reExports.push(...findJsWithSiblingTs(full, rel));
    } else if (e.isFile() && e.name.endsWith('.js')) {
      const tsPath = full.slice(0, -3) + '.ts';
      if (existsSync(tsPath)) {
        reExports.push(rel.replace(/\\/g, '/'));
      }
    }
  }
  return reExports;
}

const reExportJs = findJsWithSiblingTs(srcDir).sort();
const exclude = ['node_modules', 'dist', ...reExportJs];

const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
const prevExclude = tsconfig.exclude;
const same =
  Array.isArray(prevExclude) &&
  prevExclude.length === exclude.length &&
  prevExclude.every((x, i) => x === exclude[i]);
if (same) {
  process.exit(0);
}

tsconfig.exclude = exclude;
writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n', 'utf8');
console.log('tsconfig.json exclude updated:', reExportJs.length, 're-export .js');
