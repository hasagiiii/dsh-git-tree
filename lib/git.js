/**
 * Git operations behind the Git tab and the workspace markers.
 *
 * Every operation runs the user's own `git` executable in the repository that
 * owns the requested directory. Read operations never take the index lock
 * (`GIT_OPTIONAL_LOCKS=0`); mutating operations are serialized per repository
 * so two clicks never race on `index.lock`.
 */
import { spawn } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const READ_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_MARKER_PATHS = 200;
const MARKER_CONCURRENCY = 4;

/** A failure the UI shows as is: `code` selects localized text, `message` carries git's own words. */
export class GitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Run one git command.
 * @param {string} cwd - directory git runs in.
 * @param {string[]} args - arguments after the global options.
 * @param {{ input?: string, timeout?: number, allow?: number[], network?: boolean, lock?: boolean }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, raw: Buffer }>}
 */
export function runGit(cwd, args, options = {}) {
  const timeout = options.timeout ?? (options.network ? NETWORK_TIMEOUT_MS : READ_TIMEOUT_MS);
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    GIT_MERGE_AUTOEDIT: 'no',
    LANG: process.env.LANG ?? 'C.UTF-8',
  };
  if (options.lock === false) env.GIT_OPTIONAL_LOCKS = '0';
  const fullArgs = ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '--no-pager', '--literal-pathspecs', ...args];
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', fullArgs, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new GitError('git-missing', String(error?.message ?? error)));
      return;
    }
    const out = [];
    const err = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new GitError('timeout', `git ${args[0]} timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new GitError('too-large', `git ${args[0]} produced more than ${MAX_OUTPUT_BYTES} bytes`));
        }
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk) => { err.push(chunk); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new GitError(error?.code === 'ENOENT' ? 'git-missing' : 'git-failed', String(error?.message ?? error)));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const raw = Buffer.concat(out);
      const result = { code: code ?? -1, stdout: raw.toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), raw };
      const allow = options.allow ?? [0];
      if (allow.includes(result.code)) resolve(result);
      else reject(new GitError('git-failed', (result.stderr.trim() || result.stdout.trim() || `git ${args[0]} exited with ${result.code}`)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatus(text) {
  const tokens = text.split('\0');
  const branch = { head: undefined, oid: undefined, upstream: undefined, ahead: 0, behind: 0, detached: false };
  const staged = [];
  const changes = [];
  const conflicts = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '') continue;
    if (token.startsWith('# ')) {
      const [, key, ...rest] = token.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') branch.oid = value;
      else if (key === 'branch.head') {
        branch.head = value;
        branch.detached = value === '(detached)';
      } else if (key === 'branch.upstream') branch.upstream = value;
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match) {
          branch.ahead = Number(match[1]);
          branch.behind = Number(match[2]);
        }
      }
      continue;
    }
    const kind = token[0];
    if (kind === '1' || kind === '2') {
      // 1 XY sub mH mI mW hH hI path   |   2 XY sub mH mI mW hH hI Xscore path\0orig
      const fields = token.split(' ');
      const xy = fields[1];
      const pathStart = kind === '1' ? 8 : 9;
      const file = fields.slice(pathStart).join(' ');
      let orig;
      if (kind === '2') {
        orig = tokens[i + 1];
        i += 1;
      }
      const x = xy[0];
      const y = xy[1];
      if (x !== '.') staged.push({ path: file, status: x, ...(orig !== undefined && (x === 'R' || x === 'C') ? { orig } : {}) });
      if (y !== '.') changes.push({ path: file, status: y });
    } else if (kind === 'u') {
      const fields = token.split(' ');
      conflicts.push({ path: fields.slice(10).join(' '), status: 'C', xy: fields[1] });
    } else if (kind === '?') {
      changes.push({ path: token.slice(2), status: 'U' });
    }
  }
  return { branch, staged, changes, conflicts };
}

async function assertDirectory(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || !path.isAbsolute(cwd)) throw new GitError('bad-request', 'cwd must be an absolute directory');
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new GitError('not-found', `Directory not found: ${cwd}`);
  }
  if (!info.isDirectory()) throw new GitError('not-found', `Not a directory: ${cwd}`);
}

/** Repository root owning `cwd`, or undefined when it is not inside a work tree. */
async function repoRoot(cwd) {
  await assertDirectory(cwd);
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel'], { allow: [0, 128], lock: false });
  if (result.code !== 0) {
    if (/not a git repository/i.test(result.stderr)) return undefined;
    throw new GitError('git-failed', result.stderr.trim());
  }
  return result.stdout.trim();
}

async function requireRoot(cwd) {
  const root = await repoRoot(cwd);
  if (root === undefined) throw new GitError('not-repo', `Not a git repository: ${cwd}`);
  return root;
}

/** Repo-relative paths only; nothing may escape the work tree. */
function checkPaths(root, paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new GitError('bad-request', 'paths must be a non-empty array');
  const base = path.resolve(root);
  return paths.map((p) => {
    if (typeof p !== 'string' || p === '' || path.isAbsolute(p) || p.includes('\0')) throw new GitError('bad-request', `Invalid path: ${String(p)}`);
    const full = path.resolve(base, p);
    const rel = path.relative(base, full);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new GitError('bad-request', `Path escapes the repository: ${p}`);
    return p;
  });
}

function checkBranchName(name) {
  if (typeof name !== 'string' || name.trim() === '' || name.startsWith('-') || /[\s~^:?*[\\\0]/.test(name)) {
    throw new GitError('bad-branch', `Invalid branch name: ${String(name)}`);
  }
  return name;
}

async function hasHead(root) {
  const result = await runGit(root, ['rev-parse', '--verify', '-q', 'HEAD'], { allow: [0, 1, 128], lock: false });
  return result.code === 0;
}

async function remotes(root) {
  const result = await runGit(root, ['remote'], { lock: false });
  return result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function readStatus(root) {
  const result = await runGit(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'], { lock: false });
  return parseStatus(result.stdout);
}

export class GitService {
  constructor() {
    /** Mutation queue per repository root. */
    this.queues = new Map();
  }

  /** Serialize mutating work on one repository. */
  exclusive(root, work) {
    const key = path.resolve(root).toLowerCase();
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    const tail = next.catch(() => {});
    this.queues.set(key, tail);
    tail.then(() => { if (this.queues.get(key) === tail) this.queues.delete(key); });
    return next;
  }

  async status({ cwd }) {
    const root = await repoRoot(cwd);
    if (root === undefined) return { repo: false };
    const [parsed, remoteNames] = await Promise.all([readStatus(root), remotes(root)]);
    return { repo: true, root, ...parsed, remotes: remoteNames, hasCommits: parsed.branch.oid !== undefined && parsed.branch.oid !== '(initial)' };
  }

  /** One summary per directory for the workspace markers. */
  async statusMany({ paths }) {
    if (!Array.isArray(paths)) throw new GitError('bad-request', 'paths must be an array');
    const unique = [...new Set(paths.filter((p) => typeof p === 'string' && p !== ''))].slice(0, MAX_MARKER_PATHS);
    const results = {};
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const dir = unique[next];
        next += 1;
        try {
          const root = await repoRoot(dir);
          if (root === undefined) {
            results[dir] = { repo: false };
            continue;
          }
          const parsed = await readStatus(root);
          const files = new Set();
          for (const entry of [...parsed.staged, ...parsed.changes, ...parsed.conflicts]) files.add(entry.path);
          results[dir] = {
            repo: true,
            count: files.size,
            staged: parsed.staged.length,
            conflicts: parsed.conflicts.length,
            branch: parsed.branch.head,
            ahead: parsed.branch.ahead,
            behind: parsed.branch.behind,
          };
        } catch (error) {
          results[dir] = { repo: false, error: error?.code ?? 'error' };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MARKER_CONCURRENCY, unique.length) }, worker));
    return results;
  }

  async diff({ cwd, path: file, orig, staged, untracked, context }) {
    const root = await requireRoot(cwd);
    const [rel] = checkPaths(root, [file]);
    const origRel = typeof orig === 'string' && orig !== '' ? checkPaths(root, [orig])[0] : undefined;
    const unified = context === 'full' ? 100000 : 3;
    if (untracked) {
      const full = path.resolve(root, rel);
      let bytes;
      try {
        bytes = await readFile(full);
      } catch (error) {
        throw new GitError('not-found', String(error?.message ?? error));
      }
      if (bytes.subarray(0, 8000).includes(0)) return { binary: true, text: '', truncated: false };
      const truncated = bytes.length > MAX_DIFF_BYTES;
      const text = bytes.subarray(0, MAX_DIFF_BYTES).toString('utf8').replace(/\r\n/g, '\n');
      const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
      const body = lines.map((line) => `+${line}`).join('\n');
      return { binary: false, truncated, text: `@@ -0,0 +1,${lines.length} @@ (new file)\n${body}` };
    }
    const args = ['diff', '--no-color', '--no-ext-diff', '--patch', `--unified=${unified}`, '-M'];
    if (staged) args.push('--cached');
    args.push('--', rel);
    if (origRel !== undefined && staged) args.push(origRel);
    const result = await runGit(root, args, { lock: false });
    const truncated = result.raw.length > MAX_DIFF_BYTES;
    const text = result.raw.subarray(0, MAX_DIFF_BYTES).toString('utf8');
    return { binary: /^Binary files /m.test(text), truncated, text };
  }

  async stage({ cwd, paths, all }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      if (all) await runGit(root, ['add', '-A']);
      else await runGit(root, ['add', '-A', '--', ...checkPaths(root, paths)]);
      return { ok: true };
    });
  }

  async unstage({ cwd, paths, all }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      const head = await hasHead(root);
      if (all) {
        if (head) await runGit(root, ['reset', '-q']);
        else await runGit(root, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', '.']);
      } else {
        const list = checkPaths(root, paths);
        if (head) await runGit(root, ['restore', '--staged', '--', ...list]);
        else await runGit(root, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...list]);
      }
      return { ok: true };
    });
  }

  /**
   * Throw away working-tree changes: tracked files return to their index
   * version, untracked files are deleted. Staged changes are kept.
   */
  async discard({ cwd, paths, all }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      const parsed = await readStatus(root);
      const untracked = new Set(parsed.changes.filter((c) => c.status === 'U').map((c) => c.path));
      const trackedChanged = new Set(parsed.changes.filter((c) => c.status !== 'U').map((c) => c.path));
      const wanted = all ? [...untracked, ...trackedChanged] : checkPaths(root, paths);
      const restore = wanted.filter((p) => trackedChanged.has(p));
      const remove = wanted.filter((p) => untracked.has(p));
      if (restore.length > 0) await runGit(root, ['restore', '--worktree', '--', ...restore]);
      for (const p of remove) {
        const full = path.resolve(root, checkPaths(root, [p])[0]);
        await rm(full, { recursive: true, force: true });
      }
      return { ok: true, restored: restore.length, removed: remove.length };
    });
  }

  async commit({ cwd, message, amend, stageAll }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      const text = typeof message === 'string' ? message : '';
      if (text.trim() === '' && !amend) throw new GitError('empty-message', 'Commit message is empty');
      if (stageAll) await runGit(root, ['add', '-A']);
      const parsed = await readStatus(root);
      if (parsed.conflicts.length > 0) throw new GitError('conflicts', 'Resolve merge conflicts before committing');
      if (parsed.staged.length === 0 && !amend) throw new GitError('nothing-staged', 'There are no staged changes to commit');
      const args = ['commit', '-q', '--cleanup=strip'];
      if (amend) args.push('--amend');
      if (text.trim() === '') args.push('--no-edit');
      else args.push('-F', '-');
      await runGit(root, args, { input: text, timeout: 120_000 });
      const head = await runGit(root, ['log', '-1', '--format=%h %s'], { lock: false });
      return { ok: true, head: head.stdout.trim() };
    });
  }

  async branches({ cwd }) {
    const root = await requireRoot(cwd);
    const format = '%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(objectname:short)%09%(committerdate:relative)';
    const result = await runGit(root, ['for-each-ref', '--sort=-committerdate', `--format=${format}`, 'refs/heads', 'refs/remotes'], { lock: false });
    const local = [];
    const remote = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line === '') continue;
      const [ref, name, head, upstream, oid, date] = line.split('\t');
      if (ref.startsWith('refs/heads/')) local.push({ name, current: head === '*', upstream: upstream || undefined, oid, date });
      else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remote.push({ name, oid, date });
    }
    return { local, remote };
  }

  async checkout({ cwd, name, create, remote }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      checkBranchName(name);
      if (create) {
        const check = await runGit(root, ['check-ref-format', '--branch', name], { allow: [0, 1, 128] });
        if (check.code !== 0) throw new GitError('bad-branch', `Invalid branch name: ${name}`);
        await runGit(root, ['switch', '-c', name]);
      } else if (remote) {
        const slash = name.indexOf('/');
        const localName = slash >= 0 ? name.slice(slash + 1) : name;
        const exists = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${localName}`], { allow: [0, 1] });
        if (exists.code === 0) await runGit(root, ['switch', localName]);
        else await runGit(root, ['switch', '--track', name]);
      } else {
        await runGit(root, ['switch', name]);
      }
      return { ok: true };
    });
  }

  async fetch({ cwd }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      if ((await remotes(root)).length === 0) throw new GitError('no-remote', 'This repository has no remote');
      await runGit(root, ['fetch', '--all', '--prune'], { network: true });
      return { ok: true };
    });
  }

  async pull({ cwd }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, () => this.pullLocked(root));
  }

  async pullLocked(root) {
    const parsed = await readStatus(root);
    if (parsed.branch.upstream === undefined) throw new GitError('no-upstream', 'The current branch has no upstream branch');
    // Honour the user's pull.rebase / pull.ff; without either, merge (git's
    // historical default) instead of failing on divergent branches.
    const args = ['pull', '--no-edit'];
    const rebase = await runGit(root, ['config', '--get', 'pull.rebase'], { allow: [0, 1], lock: false });
    const ff = await runGit(root, ['config', '--get', 'pull.ff'], { allow: [0, 1], lock: false });
    if (rebase.code !== 0 && ff.code !== 0) args.push('--no-rebase');
    const result = await runGit(root, args, { network: true });
    return { ok: true, output: (result.stdout + result.stderr).trim() };
  }

  async push({ cwd }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, () => this.pushLocked(root));
  }

  async pushLocked(root) {
    const parsed = await readStatus(root);
    if (parsed.branch.detached) throw new GitError('detached', 'HEAD is detached; switch to a branch before pushing');
    if (parsed.branch.upstream !== undefined) {
      await runGit(root, ['push'], { network: true });
      return { ok: true };
    }
    const names = await remotes(root);
    if (names.length === 0) throw new GitError('no-remote', 'This repository has no remote');
    const target = names.includes('origin') ? 'origin' : names[0];
    await runGit(root, ['push', '-u', target, 'HEAD'], { network: true });
    return { ok: true, published: target };
  }

  async sync({ cwd }) {
    const root = await requireRoot(cwd);
    return this.exclusive(root, async () => {
      const parsed = await readStatus(root);
      if (parsed.branch.upstream === undefined) return this.pushLocked(root);
      await this.pullLocked(root);
      await runGit(root, ['push'], { network: true });
      return { ok: true };
    });
  }
}

/** Operations the route accepts, by name. */
export const OPERATIONS = ['status', 'statusMany', 'diff', 'stage', 'unstage', 'discard', 'commit', 'branches', 'checkout', 'fetch', 'pull', 'push', 'sync'];
