/**
 * Removes any .js file in src/ that has a sibling .ts with the same basename.
 * Prevents "overwritten by multiple input files" when leftover .js exist.
 */
import { readdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

function cleanDir(dir: string): void {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      cleanDir(full);
    } else if (name.name.endsWith('.js')) {
      const tsPath = full.slice(0, -3) + '.ts';
      if (existsSync(tsPath)) {
        unlinkSync(full);
        console.log('Removed (duplicate of .ts):', join('src', full.slice(srcDir.length + 1)));
      }
    }
  }
}

cleanDir(srcDir);
