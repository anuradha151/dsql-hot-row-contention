import { execFileSync } from 'node:child_process';

for (const folder of [
  'restApi/inventory/decrement',
  'restApi/inventory/decrementSingleQuery',
  'restApi/inventory/getStock',
  'restApi/inventory/setStock',
  'database/setup'
]) {
  execFileSync('npm', ['ci', '--ignore-scripts'], {
    cwd: new URL(`../function/${folder}/`, import.meta.url),
    stdio: 'inherit'
  });
}
