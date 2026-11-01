/**
 * Host half of dsh-git-tree: one authenticated JSON route that runs git for
 * the Git tab and the workspace markers.
 *
 * The route is an exact Fetch route of `ctx.connection`, so it lives under the
 * shell's `/api` channel and inherits browser authentication and the
 * Host/Origin fence; a request without the page's credential never reaches it.
 */
import { GitError, GitService, OPERATIONS } from './lib/git.js';

export const name = 'dsh-git-tree';
export const inject = ['connection'];

/** Route path; keep in sync with `ROUTE` in client.js. */
export const ROUTE = '/api/dsh-git-tree/op';

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function apply(ctx) {
  const git = new GitService();
  const handle = async (request) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { ok: false, error: { code: 'bad-request', message: 'Body must be JSON' } });
    }
    const op = body?.op;
    if (typeof op !== 'string' || !OPERATIONS.includes(op)) {
      return json(400, { ok: false, error: { code: 'bad-request', message: `Unknown operation: ${String(op)}` } });
    }
    try {
      const value = await git[op](body.args ?? {});
      return json(200, { ok: true, value });
    } catch (error) {
      if (error instanceof GitError) return json(200, { ok: false, error: { code: error.code, message: error.message } });
      ctx.logger?.('dsh-git-tree')?.warn?.(error);
      return json(500, { ok: false, error: { code: 'internal', message: String(error?.message ?? error) } });
    }
  };
  ctx.effect(() => {
    const dispose = ctx.connection.fetch.register({
      path: ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: handle,
    });
    return () => { void dispose(); };
  }, 'dsh-git-tree: git route');
}
