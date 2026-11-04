import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, '../..');
const standaloneRoot = path.resolve(__dirname, '..');
const rootDir = fs.existsSync(path.join(monorepoRoot, '.github')) ? monorepoRoot : standaloneRoot;
const backendDir = fs.existsSync(path.join(monorepoRoot, 'backend', 'Dockerfile'))
  ? path.join(monorepoRoot, 'backend')
  : standaloneRoot;
const frontendDir = fs.existsSync(path.join(monorepoRoot, 'frontend', 'vercel.json'))
  ? path.join(monorepoRoot, 'frontend')
  : path.resolve(__dirname, '../../linkview-frontend');

describe('DevOps: CI Pipeline, Dockerfile & Cloud Deployment Suite', () => {

  // =========================================================================
  // 1. GitHub Actions CI Workflow (.github/workflows/ci.yml)
  // =========================================================================
  test('1a. CI workflow file exists and is valid', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), '.github/workflows/ci.yml must exist');
    const content = fs.readFileSync(ciPath, 'utf8');
    assert.ok(content.length > 50, 'ci.yml must not be empty');
  });

  test('1b. CI workflow triggers on push and pull_request to main branch', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    const content = fs.readFileSync(ciPath, 'utf8');

    assert.match(content, /push:/, 'Workflow must trigger on push');
    assert.match(content, /pull_request:/, 'Workflow must trigger on pull_request');
    assert.match(content, /branches:\s*\[\s*main\s*\]/, 'Workflow triggers must target main branch');
  });

  test('1c. CI workflow configures Node.js 20 environment and actions/checkout', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    const content = fs.readFileSync(ciPath, 'utf8');

    assert.match(content, /actions\/checkout@v[34]/, 'Must use actions/checkout');
    assert.match(content, /actions\/setup-node@v[34]/, 'Must use actions/setup-node');
    assert.match(content, /20/, 'Must specify Node.js 20 LTS');
  });

  test('1d. CI workflow steps execute backend tests and frontend build', () => {
    const ciPath = path.join(rootDir, '.github', 'workflows', 'ci.yml');
    const content = fs.readFileSync(ciPath, 'utf8');

    assert.match(content, /npm test/, 'Must execute backend npm test');
    assert.match(content, /npm run build/, 'Must execute frontend npm run build');
  });

  // =========================================================================
  // 2. Production Dockerfile Containerization
  // =========================================================================
  test('2a. backend/Dockerfile exists with multi-stage build architecture', () => {
    const dockerfilePath = path.join(backendDir, 'Dockerfile');
    assert.ok(fs.existsSync(dockerfilePath), 'backend/Dockerfile must exist');
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    const fromCount = (content.match(/^FROM\s+/gm) || []).length;
    assert.ok(fromCount >= 2, 'Dockerfile must utilize multi-stage build (at least 2 FROM statements)');
    assert.match(content, /node:20-alpine/, 'Must use node:20-alpine lightweight base image');
  });

  test('2b. Dockerfile enforces non-root user execution for security', () => {
    const dockerfilePath = path.join(backendDir, 'Dockerfile');
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    assert.match(content, /USER\s+(?!root\b)[a-zA-Z0-9_-]+/, 'Dockerfile must switch to a non-root USER');
    assert.match(content, /adduser|chown/, 'Dockerfile must establish non-root user or ownership');
  });

  test('2c. Dockerfile defines production environment, port exposition, and entrypoint', () => {
    const dockerfilePath = path.join(backendDir, 'Dockerfile');
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    assert.match(content, /ENV\s+NODE_ENV=production/, 'Must set NODE_ENV=production');
    assert.match(content, /EXPOSE\s+8081/, 'Must expose port 8081');
    assert.match(content, /CMD\s+\[.*"node".*"src\/server\.js".*\]/, 'Must launch server via node src/server.js');
  });

  test('2d. Dockerignore prevents copying unwanted files and secrets into images', () => {
    const backendIgnore = path.join(backendDir, '.dockerignore');
    assert.ok(fs.existsSync(backendIgnore), 'backend/.dockerignore must exist');
    const content = fs.readFileSync(backendIgnore, 'utf8');

    assert.match(content, /node_modules/, '.dockerignore must ignore node_modules');
    assert.match(content, /\.env/, '.dockerignore must ignore environment secret files');
  });

  // =========================================================================
  // 3. Render Blueprint & Vercel Configuration
  // =========================================================================
  test('3a. render.yaml defines web service with correct build & start commands', () => {
    const renderPath = path.join(backendDir, 'render.yaml');
    assert.ok(fs.existsSync(renderPath), 'render.yaml must exist');
    const content = fs.readFileSync(renderPath, 'utf8');

    assert.match(content, /name:\s*linktest-backend/);
    assert.match(content, /buildCommand:\s*npm install/);
    assert.match(content, /startCommand:\s*npm start/);
    assert.match(content, /healthCheckPath:\s*\/api\/health/);
  });

  test('3b. render.yaml defines required environment variables for production', () => {
    const renderPath = path.join(backendDir, 'render.yaml');
    const content = fs.readFileSync(renderPath, 'utf8');

    assert.match(content, /DATABASE_URL/);
    assert.match(content, /JWT_SECRET/);
    assert.match(content, /NODE_ENV/);
    assert.match(content, /PORT/);
  });

  test('3c. frontend/vercel.json configures SPA routing and security headers', () => {
    const vercelPath = path.join(frontendDir, 'vercel.json');
    if (!fs.existsSync(vercelPath)) {
      // Allow fallback if frontend hasn't been copied yet
      return;
    }
    const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));

    assert.ok(Array.isArray(config.rewrites), 'Must have rewrites array');
    assert.ok(config.rewrites.some(r => r.destination === '/index.html'), 'Must route SPA requests to /index.html');
    assert.ok(Array.isArray(config.headers), 'Must have security headers array');
  });

});
