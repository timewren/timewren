// Kører pnpm-scripts samtidig og skriver hvert scripts output samlet, når det er færdigt,
// så loggen ikke bliver flettet sammen. Komma betyder "efter hinanden" inden for en gruppe:
//
//   node scripts/run-parallel.mjs lint,lint:translations type-check test
//
// Exit-koden er 1, hvis ét af scripts fejlede (en gruppe stopper ved første fejl).
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import process from 'node:process';

/** @param {string} script */
function run(script) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('pnpm', ['run', '--silent', script], { env: { FORCE_COLOR: '1', ...process.env } });
    /** @type {Buffer[]} */
    const output = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => output.push(chunk));
    const finish = (/** @type {number} */ code) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(`\n===== ${script}: ${code === 0 ? 'OK' : `FEJL (exit ${code})`} på ${seconds} s =====\n`);
      process.stdout.write(Buffer.concat(output));
      resolve({ script, code, seconds });
    };
    child.on('error', (error) => {
      output.push(Buffer.from(`${error.message}\n`));
      finish(1);
    });
    child.on('close', code => finish(code ?? 1));
  });
}

/** @param {string} group */
async function runGroup(group) {
  const results = [];
  for (const script of group.split(',')) {
    const result = await run(script);
    results.push(result);
    if (result.code !== 0)
      break;
  }
  return results;
}

const results = (await Promise.all(process.argv.slice(2).map(runGroup))).flat();
process.stdout.write('\n===== Opsummering =====\n');
for (const { script, code, seconds } of results)
  process.stdout.write(`${code === 0 ? 'OK  ' : 'FEJL'} ${script} (${seconds} s)\n`);
process.exitCode = results.every(r => r.code === 0) ? 0 : 1;
