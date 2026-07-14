import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Docker enables the Chromium container compatibility mode', () => {
  const dockerfile = readProjectFile('Dockerfile');
  const composeDockerfile = readProjectFile('Dockerfile.compose');
  const compose = readProjectFile('docker-compose.yml');

  assert.match(dockerfile, /\nENV PUPPETEER_NO_SANDBOX=true\n/);
  assert.match(composeDockerfile, /\nENV PUPPETEER_NO_SANDBOX=true\n/);
  assert.match(compose, /PUPPETEER_NO_SANDBOX: \$\{PUPPETEER_NO_SANDBOX:-true\}/);
});

test('Docker still runs the application as a non-root user', () => {
  const dockerfile = readProjectFile('Dockerfile');
  const composeDockerfile = readProjectFile('Dockerfile.compose');

  assert.match(dockerfile, /\nUSER node\n/);
  assert.match(composeDockerfile, /\nUSER node\n/);
});
