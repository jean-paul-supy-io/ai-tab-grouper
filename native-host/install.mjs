// Registers the native messaging host with Chrome for the current user.
//   npm run install-host      register (re-run after moving this folder)
//   npm run uninstall-host    remove the registration
//
// Windows: writes a per-user registry key (HKCU, no admin rights needed).
// macOS / Linux: writes the host manifest into Chrome's per-user folder.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ext = JSON.parse(readFileSync(join(here, '..', 'extension.json'), 'utf8'));
const name = ext.nativeHostName;
const manifestPath = join(here, `${name}.json`);
const isWindows = platform() === 'win32';
const regKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${name}`;
const unixManifestDir =
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
    : join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');

function findClaude() {
  try {
    const out = execFileSync(isWindows ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
    const paths = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // Prefer the real executable over npm's .cmd shim on Windows: it can be spawned without a shell.
    return paths.find((p) => /\.exe$/i.test(p)) ?? paths[0];
  } catch {
    return undefined;
  }
}

function uninstall() {
  if (isWindows) {
    try {
      execFileSync('reg', ['delete', regKey, '/f'], { stdio: 'ignore' });
    } catch {
      // not registered
    }
  } else {
    rmSync(join(unixManifestDir, `${name}.json`), { force: true });
  }
  console.log(`Removed native messaging host ${name}.`);
}

function install() {
  const claudePath = findClaude();
  if (!claudePath) {
    console.error('Could not find the `claude` command. Install Claude Code first: https://code.claude.com');
    process.exit(1);
  }
  writeFileSync(join(here, 'config.json'), `${JSON.stringify({ claudePath }, null, 2)}\n`);

  // Chrome launches hosts with a minimal environment, so pin the Node binary.
  let launcher;
  if (isWindows) {
    launcher = join(here, 'host.bat');
    writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "%~dp0host.mjs" %*\r\n`);
  } else {
    launcher = join(here, 'host.sh');
    writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/host.mjs" "$@"\n`);
    chmodSync(launcher, 0o755);
  }

  const manifest = {
    name,
    description: 'AI Tab Grouper: runs Claude Code with your own subscription',
    path: launcher,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${ext.id}/`],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (isWindows) {
    execFileSync('reg', ['add', regKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });
  } else {
    mkdirSync(unixManifestDir, { recursive: true });
    writeFileSync(join(unixManifestDir, `${name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`Registered native messaging host ${name}`);
  console.log(`  Claude Code: ${claudePath}`);
  console.log(`  Allowed extension: ${ext.id}`);
  console.log('Reload the extension in chrome://extensions, then pick "Claude subscription" in its Settings.');
}

if (process.argv.includes('--uninstall')) uninstall();
else install();
