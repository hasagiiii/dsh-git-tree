import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, ROUTE } from '../index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('route registers on ctx.connection and answers status / errors', async () => {
  const routes = [];
  const effects = [];
  const ctx = {
    connection: { fetch: { register(route) { routes.push(route); return async () => { routes.splice(routes.indexOf(route), 1); }; } } },
    effect(fn) { effects.push(fn()); },
  };
  apply(ctx);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, ROUTE);
  assert.deepEqual(routes[0].methods, ['POST']);
  const post = (body) => routes[0].fetch(new Request('http://x' + ROUTE, { method: 'POST', body: JSON.stringify(body) }));

  const ok = await (await post({ op: 'status', args: { cwd: root } })).json();
  assert.equal(ok.ok, true);
  assert.equal(ok.value.repo, true);

  const bad = await post({ op: 'rm -rf', args: {} });
  assert.equal(bad.status, 400);

  const rel = await (await post({ op: 'status', args: { cwd: 'relative' } })).json();
  assert.equal(rel.ok, false);
  assert.equal(rel.error.code, 'bad-request');

  effects.forEach((dispose) => dispose());
  assert.equal(routes.length, 0);
});
