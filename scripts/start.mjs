import { spawn, spawnSync } from 'child_process';

const SCRIPTS = '/app/scripts';
const PORT    = process.env.PORT || '8080';

// 1. Run write-key.mjs synchronously — must complete before anything else starts
const init = spawnSync('node', [`${SCRIPTS}/write-key.mjs`], { stdio: 'inherit' });
if (init.status !== 0) process.exit(init.status ?? 1);

// 2. Spawn scheduler daemon with auto-restart on crash
function spawnDaemon() {
    const d = spawn('node', [`${SCRIPTS}/scheduler-daemon.mjs`], { stdio: 'inherit' });
    d.on('exit', (code) => {
        console.error(`[Start] Daemon exited (code ${code ?? 'null'}), restarting in 5s…`);
        setTimeout(spawnDaemon, 5000);
    });
}
spawnDaemon();

// 3. Spawn OpenClaw gateway — exit propagates to Railway health check
const gw = spawn(
    'node',
    ['/app/openclaw.mjs', 'gateway', 'run', '--bind', 'lan', '--port', PORT, '--allow-unconfigured'],
    { stdio: 'inherit', env: { ...process.env, OPENCLAW_CONFIG_PATH: '/app/openclaw.json' } }
);
gw.on('exit', (code) => process.exit(code ?? 0));
