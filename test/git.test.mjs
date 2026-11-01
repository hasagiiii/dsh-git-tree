import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitService, runGit } from '../lib/git.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = path.resolve(here, '..', '.scratch');

async function makeRepo() {
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(path.join(scratch, 'repo-'));
  await runGit(dir, ['init', '-q', '-b', 'main']);
  await runGit(dir, ['config', 'user.email', 't@example.com']);
  await runGit(dir, ['config', 'user.name', 'Test']);
  await runGit(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

test('status, stage, unstage, diff, commit, discard, branches, checkout', async () => {
  const git = new GitService();
  const dir = await makeRepo();
  try {
    let s = await git.status({ cwd: dir });
    assert.equal(s.repo, true);
    assert.equal(s.hasCommits, false);
    assert.equal(s.branch.head, 'main');

    await writeFile(path.join(dir, 'a.txt'), 'one\n');
    await mkdir(path.join(dir, 'sub dir'));
    await writeFile(path.join(dir, 'sub dir', 'b 中.txt'), 'b\n');
    s = await git.status({ cwd: dir });
    assert.deepEqual(s.changes.map((c) => [c.path, c.status]).sort(), [['a.txt', 'U'], ['sub dir/b 中.txt', 'U']]);

    const untracked = await git.diff({ cwd: dir, path: 'a.txt', untracked: true });
    assert.match(untracked.text, /\+one/);

    await git.stage({ cwd: dir, paths: ['a.txt'] });
    s = await git.status({ cwd: dir });
    assert.deepEqual(s.staged.map((c) => [c.path, c.status]), [['a.txt', 'A']]);

    // unstage without HEAD
    await git.unstage({ cwd: dir, paths: ['a.txt'] });
    s = await git.status({ cwd: dir });
    assert.equal(s.staged.length, 0);

    await assert.rejects(git.commit({ cwd: dir, message: 'x' }), { code: 'nothing-staged' });
    await assert.rejects(git.commit({ cwd: dir, message: '  ', stageAll: true }), { code: 'empty-message' });

    const c1 = await git.commit({ cwd: dir, message: 'first commit', stageAll: true });
    assert.match(c1.head, /first commit/);
    s = await git.status({ cwd: dir });
    assert.equal(s.hasCommits, true);
    assert.equal(s.changes.length + s.staged.length, 0);

    await writeFile(path.join(dir, 'a.txt'), 'one\ntwo\n');
    const d = await git.diff({ cwd: dir, path: 'a.txt' });
    assert.match(d.text, /^\+two$/m);
    await git.stage({ cwd: dir, all: true });
    const ds = await git.diff({ cwd: dir, path: 'a.txt', staged: true });
    assert.match(ds.text, /^\+two$/m);
    await git.unstage({ cwd: dir, all: true });
    s = await git.status({ cwd: dir });
    assert.deepEqual(s.changes.map((c) => c.status), ['M']);

    await writeFile(path.join(dir, 'new.txt'), 'n\n');
    await git.discard({ cwd: dir, all: true });
    s = await git.status({ cwd: dir });
    assert.equal(s.changes.length, 0);
    assert.equal(await readFile(path.join(dir, 'a.txt'), 'utf8'), 'one\n');

    await assert.rejects(git.stage({ cwd: dir, paths: ['../escape'] }), { code: 'bad-request' });

    await git.checkout({ cwd: dir, name: 'feature/x', create: true });
    s = await git.status({ cwd: dir });
    assert.equal(s.branch.head, 'feature/x');
    const b = await git.branches({ cwd: dir });
    assert.deepEqual(b.local.map((x) => x.name).sort(), ['feature/x', 'main']);
    await git.checkout({ cwd: dir, name: 'main' });
    assert.equal((await git.status({ cwd: dir })).branch.head, 'main');
    await assert.rejects(git.checkout({ cwd: dir, name: '-bad', create: true }), { code: 'bad-branch' });

    await assert.rejects(git.push({ cwd: dir }), { code: 'no-remote' });
    await assert.rejects(git.pull({ cwd: dir }), { code: 'no-upstream' });

    await git.commit({ cwd: dir, message: 'first commit (amended)', amend: true });

    const many = await git.statusMany({ paths: [dir, scratch] });
    assert.equal(many[dir].repo, true);
    assert.equal(many[dir].count, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('push, pull and sync against a bare remote', async () => {
  const git = new GitService();
  const remote = await mkdtemp(path.join(scratch, 'bare-'));
  const dir = await makeRepo();
  const other = await mkdtemp(path.join(scratch, 'clone-'));
  try {
    await runGit(remote, ['init', '-q', '--bare', '-b', 'main']);
    await runGit(dir, ['remote', 'add', 'origin', remote]);
    await writeFile(path.join(dir, 'a.txt'), '1\n');
    await git.commit({ cwd: dir, message: 'c1', stageAll: true });
    const published = await git.push({ cwd: dir });
    assert.equal(published.published, 'origin');
    let s = await git.status({ cwd: dir });
    assert.equal(s.branch.upstream, 'origin/main');

    await runGit(other, ['clone', '-q', remote, '.']);
    await runGit(other, ['config', 'user.email', 't@example.com']);
    await runGit(other, ['config', 'user.name', 'Test']);
    await writeFile(path.join(other, 'b.txt'), '2\n');
    await runGit(other, ['add', '-A']);
    await runGit(other, ['commit', '-q', '-m', 'c2']);
    await runGit(other, ['push', '-q']);

    await git.fetch({ cwd: dir });
    s = await git.status({ cwd: dir });
    assert.equal(s.branch.behind, 1);
    await writeFile(path.join(dir, 'c.txt'), '3\n');
    await git.commit({ cwd: dir, message: 'c3', stageAll: true });
    await git.sync({ cwd: dir });
    s = await git.status({ cwd: dir });
    assert.equal(s.branch.ahead, 0);
    assert.equal(s.branch.behind, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
  }
});
