import { lstat, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { TaskWeaveError, loadConfig, planTasks } from './config.mjs';
import { runTasks } from './runner.mjs';

const HELP = `TaskWeave 1.0.0 — jalankan tugas sesuai dependensi

Pemakaian:
  taskweave plan <config.json> [target ...] [--json]
  taskweave run <config.json> [target ...] [--jobs 1..32] [--report hasil.json] [--json]

Target kosong berarti semua tugas. Dependensi target selalu disertakan.
--jobs, -j   Maksimal proses paralel, default 2.
--report     Simpan JSON ke berkas baru; tujuan yang sudah ada ditolak.
--json       Keluaran stdout berupa JSON.
--help, -h   Tampilkan bantuan.
--version    Tampilkan versi.

Contoh:
  node bin/taskweave.mjs run examples/taskweave.json verify --jobs 2
`;

async function checkReportDestination(filename) {
  const destination = path.resolve(filename);
  try {
    await lstat(destination);
    throw new TaskWeaveError('Tujuan laporan sudah ada; pilih nama berkas baru.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!(await stat(path.dirname(destination))).isDirectory()) throw new TaskWeaveError('Direktori laporan tidak valid.');
  return destination;
}

function textReport(report) {
  const lines = [`Hasil: ${report.status}; ${report.durationMs} ms; batas paralel ${report.jobs}`];
  for (const task of report.tasks) {
    lines.push(`${task.id}: ${task.status} (${task.durationMs} ms${task.exitCode !== null ? `, exit ${task.exitCode}` : ''})`);
    if (task.reason) lines.push(`  ${task.reason}`);
    if (task.stdout) lines.push(`  stdout: ${task.stdout.trimEnd()}`);
    if (task.stderr) lines.push(`  stderr: ${task.stderr.trimEnd()}`);
    if (task.stdoutTruncated || task.stderrTruncated) lines.push('  Keluaran dipotong pada batas 64 KiB per stream.');
  }
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  let json = false;
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
      json: { type: 'boolean' },
      jobs: { type: 'string', short: 'j' },
      report: { type: 'string' },
    } });
    json = values.json ?? false;
    if (values.help || !args.length) { console.log(HELP); return 0; }
    if (values.version) { console.log('TaskWeave 1.0.0'); return 0; }
    const [mode, filename, ...targets] = positionals;
    if (!['plan', 'run'].includes(mode) || !filename) throw new TaskWeaveError('Gunakan plan/run dan path konfigurasi. Lihat --help.');
    if (mode === 'plan' && (values.jobs !== undefined || values.report !== undefined)) throw new TaskWeaveError('--jobs dan --report hanya untuk run.');
    if (values.jobs !== undefined && !/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(values.jobs)) throw new TaskWeaveError('--jobs harus integer 1–32.');
    const config = await loadConfig(filename);
    const plan = planTasks(config, targets);
    if (mode === 'plan') {
      if (json) console.log(JSON.stringify({ schemaVersion: 1, configFile: config.configFile, order: plan.map((task) => task.id), tasks: plan }, null, 2));
      else console.log(plan.map((task, index) => `${index + 1}. ${task.id} [dependensi: ${task.dependsOn.join(', ') || '-'}]\n   ${JSON.stringify(task.command)}\n   cwd: ${task.cwd}; timeout: ${task.timeoutMs} ms`).join('\n'));
      return 0;
    }
    const reportFile = values.report !== undefined ? await checkReportDestination(values.report) : null;
    const controller = new AbortController();
    let interrupted = null;
    const onInt = () => { interrupted ??= 'SIGINT'; controller.abort(); };
    const onTerm = () => { interrupted ??= 'SIGTERM'; controller.abort(); };
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    let report;
    try {
      if (!json) console.error(`Menjalankan ${plan.length} tugas...`);
      report = await runTasks(config, { targets, jobs: values.jobs === undefined ? 2 : Number(values.jobs), signal: controller.signal });
    } finally {
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
    }
    // wx mencegah penimpaan, termasuk bila tujuan dibuat proses lain saat tugas berjalan.
    if (reportFile) await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log(json ? JSON.stringify(report, null, 2) : textReport(report));
    if (reportFile && !json) console.error(`Laporan tersimpan: ${reportFile}`);
    if (interrupted) return interrupted === 'SIGTERM' ? 143 : 130;
    return report.status === 'success' ? 0 : 1;
  } catch (error) {
    if (json) console.log(JSON.stringify({ schemaVersion: 1, status: 'error', error: error.message }));
    else console.error(`Gagal: ${error.message}`);
    return 2;
  }
}
