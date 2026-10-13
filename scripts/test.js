#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');

function findPython() {
  const candidates = [
    path.join(ROOT_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(ROOT_DIR, 'venv', 'bin', 'python'),
    path.join(ROOT_DIR, '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT_DIR, '.venv', 'bin', 'python'),
    path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe'),
    path.join(BACKEND_DIR, 'venv', 'bin', 'python'),
    'python3',
    'python',
    'py'
  ];
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    try {
      const res = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 4000
      });
      if (res.status === 0 && res.stdout.trim() === '3') return candidate;
    } catch {}
  }
  return null;
}

const python = findPython();
if (!python) {
  console.error('\x1b[31m[ZeroUI] Error: Python 3 was not found.\x1b[0m');
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(python, ['-m', 'pytest', ...args], {
  cwd: BACKEND_DIR,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
