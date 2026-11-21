// Runs before `npm run dev`.
// On Windows, Ctrl+C can stop npm but leave its child servers running; the next `npm run dev` then fails with
// "address already in use :::3600". This stops such leftovers - but only node processes of THIS project
// (their command line contains this folder). Anything else on the ports is reported, never killed.
//   node scripts/dev-ports.mjs                 stop leftovers
//   node scripts/dev-ports.mjs --dry-run       only show what would be stopped
//   node scripts/dev-ports.mjs --ports=4600,3600  only free these ports
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const custom = process.argv.find((a) => a.startsWith('--ports='));
const PORTS = custom ? custom.slice('--ports='.length).split(',').map(Number) : [4600, 3600];
const DRY = process.argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').toLowerCase().replace(/\//g, '\\');
const win = process.platform === 'win32';
const run = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

/** pid -> command line of every node process. */
function nodeProcesses() {
  if (win) {
    const out = run('powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | ForEach-Object { \\"$($_.ProcessId)`t$($_.CommandLine)\\" }"');
    return new Map(out.split(/\r?\n/).filter(Boolean).map((l) => [Number(l.split('\t')[0]), l.split('\t').slice(1).join('\t')]));
  }
  const out = run('ps -eo pid=,command=');
  return new Map(out.split('\n').filter((l) => /node/.test(l)).map((l) => [Number(l.trim().split(/\s+/)[0]), l.trim().split(/\s+/).slice(1).join(' ')]));
}

function listening(port) {
  if (win) {
    const out = run('netstat -ano -p tcp');
    return [...new Set(out.split(/\r?\n/).filter((l) => new RegExp(`[:.]${port}\\s+\\S+\\s+LISTENING`).test(l)).map((l) => Number(l.trim().split(/\s+/).pop())))];
  }
  return run(`lsof -ti tcp:${port} -sTCP:LISTEN`).split('\n').filter(Boolean).map(Number);
}

const procs = nodeProcesses();
// root + '\' so a sibling folder whose name only starts the same (erpforsellnew vs erpforsellnew_v2) is not ours
const ours = (cmd) => cmd.toLowerCase().replace(/\//g, '\\').includes(root + '\\');
// Old watchers of this project would restart a server on the next file change and take the port again.
// The demo web server (npm run dev:demo, port 3300) is not a leftover of npm run dev - leave it running.
const watcher = (cmd) => /nest(\.js)?"?\s+start\s+--watch|tsup.*--watch|next"?\s+dev\b/.test(cmd) && !/--port[ =]3300\b/.test(cmd);

const victims = new Map();
if (!custom) for (const [pid, cmd] of procs) if (ours(cmd) && watcher(cmd)) victims.set(pid, cmd);
let blocked = false;
for (const port of PORTS) {
  for (const pid of listening(port)) {
    const cmd = procs.get(pid);
    if (cmd && ours(cmd)) victims.set(pid, cmd);
    else {
      blocked = true;
      console.error(`Port ${port} is used by another program (pid ${pid}${cmd ? '' : ', not node'}). Close it, then try again.`);
    }
  }
}

for (const [pid, cmd] of victims) {
  console.log(`${DRY ? 'Would stop' : 'Stopping'} leftover dev process ${pid}: ${cmd.slice(0, 110)}`);
  if (!DRY) run(win ? `taskkill /F /T /PID ${pid}` : `kill ${pid}`);
}
process.exitCode = blocked ? 1 : 0;
