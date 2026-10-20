import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {hashPassword} from './studio-security.js';

test('Magic server: authentication, same-origin templates, protected API and private server files', async () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-security-test-'));
  const password = 'test-only-password-58';
  const passwordHash = await hashPassword(password);
  const accounts = JSON.stringify([{id: 'alice', passwordHash}, {id: 'bob', passwordHash}]);
  const children = [];
  async function launch(file, cwd, extra = {}) {
    const reserve = net.createServer();
    await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const child = spawn(process.execPath, [file], {cwd, env: {...process.env, NODE_ENV: 'test', PORT: String(port), STUDIO_SESSION_SECRET: 'a'.repeat(64), STUDIO_ACCOUNTS_JSON: accounts, ...extra}, stdio: ['ignore', 'pipe', 'pipe']});
    children.push(child);
    let output = ''; child.stderr.on('data', chunk => output += chunk);
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', code => reject(new Error(`Server exited ${code}: ${output}`)));
    });
    return `http://127.0.0.1:${port}`;
  }
  async function login(origin, username) {
    const response = await fetch(origin + '/api/session', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({username, code: password})});
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  try {
    const magicCwd = path.join(dir, 'magic');
    await fs.mkdir(path.join(magicCwd, 'public'), {recursive: true});
    for (const file of ['goods.html', 'index.html', 'studio-login.js', 'goods-desktop.html', 'desktop-fr.html']) await fs.copyFile(path.join(root, file), path.join(magicCwd, 'public', file));
    const magic = await launch(path.join(root, 'goods-video-renderer/server.js'), magicCwd);
    assert.equal((await fetch(magic + '/goods.html')).status, 200);
    assert.equal((await fetch(magic + '/studio-login.js')).status, 200);
    assert.equal((await fetch(magic + '/goods-desktop.html')).status, 200);
    assert.equal((await fetch(magic + '/desktop-fr.html')).status, 200);
    assert.equal((await fetch(magic + '/server.js')).status, 404);
    assert.equal((await fetch(magic + '/.env.example')).status, 404);
    assert.equal((await fetch(magic + '/api/goods-video-jobs/fake')).status, 401);
    const mc = await login(magic, 'alice');
    assert.equal((await fetch(magic + '/api/goods-video-jobs/fake', {headers: {Cookie: mc}})).status, 404);
    assert.equal((await fetch(magic + '/api/make/goods', {method: 'POST', headers: {Cookie: mc, Origin: magic, 'Content-Type': 'application/json'}, body: '{}'})).status, 503);
  } finally {
    for (const child of children) child.kill('SIGTERM');
    await fs.rm(dir, {recursive: true, force: true});
  }
});
