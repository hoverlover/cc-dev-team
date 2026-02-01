#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';

const INSTALL_DIR = join(homedir(), '.cc-dev-team');
const REPO_URL = 'https://github.com/hoverlover/cc-dev-team.git';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

function logStep(msg) {
  log(`\n${colors.cyan}▶${colors.reset} ${msg}`);
}

function logSuccess(msg) {
  log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logWarning(msg) {
  log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkPrerequisites() {
  logStep('Checking prerequisites...');

  let hasErrors = false;

  // Check Node.js version
  try {
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    const major = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (major >= 18) {
      logSuccess(`Node.js ${nodeVersion}`);
    } else {
      logError(`Node.js ${nodeVersion} (need 18+)`);
      hasErrors = true;
    }
  } catch {
    logError('Node.js not found (need 18+)');
    hasErrors = true;
  }

  // Check Bun
  if (commandExists('bun')) {
    const bunVersion = execSync('bun --version', { encoding: 'utf8' }).trim();
    logSuccess(`Bun ${bunVersion}`);
  } else {
    logError('Bun not found - install from https://bun.sh');
    hasErrors = true;
  }

  // Check Claude Code CLI
  if (commandExists('claude')) {
    logSuccess('Claude Code CLI');
  } else {
    logError('Claude Code CLI not found - install from https://claude.ai/code');
    hasErrors = true;
  }

  // Check Git
  if (commandExists('git')) {
    logSuccess('Git');
  } else {
    logError('Git not found');
    hasErrors = true;
  }

  if (hasErrors) {
    log('\nPlease install missing prerequisites and try again.', colors.red);
    process.exit(1);
  }
}

async function promptYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function install() {
  logStep(`Installing to ${INSTALL_DIR}...`);

  // Clone the repository
  log('  Cloning repository...');
  execSync(`git clone --depth 1 ${REPO_URL} "${INSTALL_DIR}"`, {
    stdio: 'inherit'
  });

  // Install dependencies
  log('  Installing dependencies...');
  execSync('npm install', {
    cwd: INSTALL_DIR,
    stdio: 'inherit'
  });

  // Install dashboard dependencies and build
  log('  Installing dashboard...');
  execSync('bun install', {
    cwd: join(INSTALL_DIR, 'dashboard'),
    stdio: 'inherit'
  });

  log('  Building dashboard...');
  execSync('bun run build', {
    cwd: join(INSTALL_DIR, 'dashboard'),
    stdio: 'inherit'
  });

  // Run the setup script
  log('  Configuring agents...');
  execSync('./scripts/install.sh', {
    cwd: INSTALL_DIR,
    stdio: 'inherit'
  });

  logSuccess('Installation complete!');
}

function getLocalVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(INSTALL_DIR, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getRemoteVersion() {
  try {
    const pkg = execSync('git show origin/main:package.json', {
      cwd: INSTALL_DIR,
      encoding: 'utf8'
    });
    return JSON.parse(pkg).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function update() {
  logStep('Checking for updates...');

  try {
    const currentVersion = getLocalVersion();
    log(`  Current version: ${colors.cyan}${currentVersion}${colors.reset}`);

    // Fetch latest
    execSync('git fetch origin main', {
      cwd: INSTALL_DIR,
      stdio: 'pipe'
    });

    // Check if we're behind
    const status = execSync('git status -uno', {
      cwd: INSTALL_DIR,
      encoding: 'utf8'
    });

    if (status.includes('behind')) {
      const newVersion = getRemoteVersion();
      log(`  New version available: ${colors.green}${newVersion}${colors.reset}`);

      const shouldUpdate = await promptYesNo('  Update now?');
      if (shouldUpdate) {
        // Reset any local changes (e.g. package-lock.json from npm install)
        // before pulling — this is an installed copy, not a dev workspace
        execSync('git reset --hard HEAD', {
          cwd: INSTALL_DIR,
          stdio: 'pipe'
        });
        execSync('git pull origin main', {
          cwd: INSTALL_DIR,
          stdio: 'inherit'
        });
        execSync('npm install', {
          cwd: INSTALL_DIR,
          stdio: 'inherit'
        });
        execSync('bun install', {
          cwd: join(INSTALL_DIR, 'dashboard'),
          stdio: 'inherit'
        });
        log('  Rebuilding dashboard...');
        execSync('bun run build', {
          cwd: join(INSTALL_DIR, 'dashboard'),
          stdio: 'inherit'
        });
        execSync('./scripts/install.sh', {
          cwd: INSTALL_DIR,
          stdio: 'inherit'
        });
        logSuccess(`Updated to version ${newVersion}!`);
      }
    } else {
      logSuccess(`Already up to date (${currentVersion})`);
    }
  } catch (err) {
    logWarning('Could not check for updates');
  }
}

function start() {
  logStep('Building dashboard...');
  execSync('bun run build', {
    cwd: join(INSTALL_DIR, 'dashboard'),
    stdio: 'inherit'
  });

  logStep('Starting CC Dev Team...');

  log(`\n${colors.bright}Dashboard:${colors.reset} http://localhost:3101`);
  log(`${colors.bright}Broker:${colors.reset}    http://localhost:3100\n`);

  // Start the orchestrator
  const child = spawn('./start-orchestrator.sh', [], {
    cwd: INSTALL_DIR,
    stdio: 'inherit',
    shell: true,
  });

  child.on('error', (err) => {
    logError(`Failed to start: ${err.message}`);
    process.exit(1);
  });

  // Forward signals
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

async function main() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════╗
║            CC Dev Team                ║
║   Multi-Agent Collaboration for       ║
║           Claude Code                 ║
╚═══════════════════════════════════════╝${colors.reset}
`);

  // Check prerequisites
  checkPrerequisites();

  // Check if already installed
  const isInstalled = existsSync(join(INSTALL_DIR, 'package.json'));

  if (!isInstalled) {
    log(`\nFirst time setup - installing to ${colors.cyan}${INSTALL_DIR}${colors.reset}`);
    install();
  } else {
    await update();
  }

  // Start the system
  start();
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
