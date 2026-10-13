#!/usr/bin/env node

const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const PORT = process.env.ZEROUI_PORT || 8000;
const HOST = process.env.ZEROUI_HOST || '0.0.0.0';

// 1. Find Python executable
function findPython() {
  const candidates = [
    // Project virtual environments
    path.join(ROOT_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(ROOT_DIR, 'venv', 'bin', 'python'),
    path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT_DIR, '.venv', 'bin', 'python'),
    path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(BACKEND_DIR, 'venv', 'bin', 'python'),
    // System executables
    'python3',
    'python',
    'py'
  ];

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
      continue;
    }
    try {
      const res = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000
      });
      if (res.status === 0 && res.stdout.trim() === '3') {
        return candidate;
      }
    } catch {
      // continue to next candidate
    }
  }
  return null;
}

// 2. Kill process on port if occupied
function freePortIfOccupied(port) {
  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[3] === 'LISTENING') {
          const localAddr = parts[1];
          if (localAddr.endsWith(`:${port}`)) {
            const pid = parseInt(parts[4], 10);
            if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
              console.log(`\x1b[33m[ZeroUI] Port ${port} is currently in use by PID ${pid}. Stopping previous process...\x1b[0m`);
              try {
                execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
              } catch (_) {}
              // Brief pause for socket release
              const end = Date.now() + 1000;
              while (Date.now() < end) {}
              return;
            }
          }
        }
      }
    } else {
      const pidStr = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (pidStr) {
        const pids = pidStr.split('\n');
        for (const p of pids) {
          const pid = parseInt(p.trim(), 10);
          if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
            console.log(`\x1b[33m[ZeroUI] Port ${port} is currently in use by PID ${pid}. Stopping previous process...\x1b[0m`);
            try {
              execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            } catch (_) {}
          }
        }
        const end = Date.now() + 1000;
        while (Date.now() < end) {}
      }
    }
  } catch (_) {
    // Ignore error if port is free
  }
}

// 3. Ensure dependencies
function checkDependencies(python) {
  const check = spawnSync(python, ['-c', 'import fastapi, uvicorn'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout: 5000
  });

  if (check.status !== 0) {
    console.log('\x1b[36m[ZeroUI] Installing missing dependencies from backend/requirements.txt...\x1b[0m');
    const reqPath = path.join(BACKEND_DIR, 'requirements.txt');
    const install = spawnSync(python, ['-m', 'pip', 'install', '-r', reqPath], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });
    if (install.status !== 0) {
      console.error('\x1b[31m[ZeroUI] Error: Failed to install Python dependencies.\x1b[0m');
      process.exit(1);
    }
  }
}

// 4. Main runner
function main() {
  console.log('\x1b[36m[ZeroUI] Preparing development environment...\x1b[0m');

  const python = findPython();
  if (!python) {
    console.error('\x1b[31m[ZeroUI] Error: Python 3 was not found.\x1b[0m');
    console.error('Please install Python 3.12 or ensure your virtualenv is configured in ./venv');
    process.exit(1);
  }

  checkDependencies(python);
  freePortIfOccupied(PORT);

  const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;

  console.log('\n\x1b[32m' + '─'.repeat(60) + '\x1b[0m');
  console.log('  \x1b[1m\x1b[36m🛡️  Zero UI — Emergency Assistance System\x1b[0m');
  console.log('\x1b[32m' + '─'.repeat(60) + '\x1b[0m');
  console.log(`  \x1b[1m➜  Authority Dashboard:\x1b[0m  http://${displayHost}:${PORT}/dashboard/`);
  console.log(`  \x1b[1m➜  Mobile Simulator:\x1b[0m     http://${displayHost}:${PORT}/mobile/`);
  console.log(`  \x1b[1m➜  API Docs (Swagger):\x1b[0m   http://${displayHost}:${PORT}/docs`);
  console.log(`  \x1b[1m➜  Health Endpoint:\x1b[0m      http://${displayHost}:${PORT}/health`);
  console.log(`  \x1b[90m🔑 Sign-in token:         zeroui-dev-dashboard-token\x1b[0m`);
  console.log('\x1b[32m' + '─'.repeat(60) + '\x1b[0m\n');
  console.log('\x1b[90mStarting FastAPI/Uvicorn server with hot reload... (Ctrl+C to stop)\x1b[0m\n');

  const child = spawn(
    python,
    ['-m', 'uvicorn', 'main:app', '--host', HOST, '--port', String(PORT), '--reload'],
    {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    }
  );

  const cleanup = () => {
    if (child && !child.killed) {
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
        } catch (_) {}
      } else {
        child.kill('SIGTERM');
      }
    }
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.on('exit', cleanup);

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();
