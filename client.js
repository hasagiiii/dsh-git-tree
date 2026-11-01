/*
 * Browser half of dsh-git-tree.
 *
 * 1. A right-Sidebar tab type ("Git") modelled on VS Code's Source Control
 *    view: branch picker, pull / push / fetch / sync, commit box, and the
 *    Merge Changes / Staged Changes / Changes groups with per-file and
 *    per-group stage, unstage, discard, open and inline diff.
 * 2. A marker on every workspace row of the left sidebar whose directory is a
 *    Git work tree with uncommitted files.
 *
 * All git work happens on the Host through POST api/dsh-git-tree/op.
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-tree',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    const NS = 'dshGitTree';
    const TAB_ID = 'dsh-git-tree';
    const TAB_KIND = 'dsh-git-tree';
    const POLL_MS = 4000;
    const MARKER_POLL_MS = 15000;
    const MARKER_ATTR = 'data-dsh-git-marker';

    /* ------------------------------------------------------------------ */
    /* Copy                                                                */
    /* ------------------------------------------------------------------ */

    const zh = {
      'type.label': 'Git',
      'guide.title': '源代码管理',
      'guide.description': '查看更改、暂存、提交、切换分支与同步',
      loading: '正在读取 Git 状态…',
      noWorkspace: '这个会话没有工作区目录。',
      notRepo: '当前工作区不是 Git 仓库。',
      'group.conflicts': '合并更改',
      'group.staged': '暂存的更改',
      'group.changes': '更改',
      'empty.clean': '没有需要提交的更改。',
      'commit.placeholder': '消息（按 Ctrl+Enter 在“{branch}”提交）',
      'commit.placeholderDetached': '消息（按 Ctrl+Enter 提交）',
      'commit.button': '提交',
      'commit.buttonAll': '提交全部更改',
      'commit.amend': '修改上一次提交',
      'sync.button': '同步更改 {counts}',
      'publish.button': '发布分支',
      'action.refresh': '刷新',
      'action.pull': '拉取',
      'action.push': '推送',
      'action.fetch': '抓取',
      'action.sync': '同步',
      'action.stage': '暂存更改',
      'action.unstage': '取消暂存更改',
      'action.discard': '放弃更改',
      'action.open': '打开文件',
      'action.stageAll': '暂存所有更改',
      'action.unstageAll': '取消暂存所有更改',
      'action.discardAll': '放弃所有更改',
      'action.collapse': '折叠',
      'action.expand': '展开',
      'busy.commit': '正在提交…',
      'busy.pull': '正在拉取…',
      'busy.push': '正在推送…',
      'busy.fetch': '正在抓取…',
      'busy.sync': '正在同步…',
      'busy.checkout': '正在切换分支…',
      'busy.work': '正在执行…',
      'done.commit': '已提交：{head}',
      'done.push': '已推送。',
      'done.publish': '已发布到 {remote}。',
      'done.pull': '已拉取。',
      'done.fetch': '已抓取。',
      'done.sync': '已同步。',
      'confirm.discardOne': '确定要放弃“{name}”中的更改吗？此操作不可撤销。',
      'confirm.discardUntracked': '确定要删除未跟踪的文件“{name}”吗？此操作不可撤销。',
      'confirm.discardAll': '确定要放弃全部 {n} 个文件的更改吗？未跟踪的文件将被删除，此操作不可撤销。',
      'confirm.ok': '放弃',
      'confirm.cancel': '取消',
      'branch.detached': '分离的 HEAD',
      'branch.none': '无分支',
      'branch.filter': '选择要切换到的分支，或输入新分支名',
      'branch.create': '创建新分支“{name}”',
      'branch.local': '本地分支',
      'branch.remote': '远程分支',
      'branch.loading': '正在读取分支…',
      'branch.empty': '没有匹配的分支',
      'branch.title': '切换分支 · {branch}',
      'diff.loading': '正在读取差异…',
      'diff.binary': '二进制文件，无法显示差异。',
      'diff.empty': '没有可显示的文本差异。',
      'diff.truncated': '差异过大，只显示了前面的部分。',
      'diff.renamed': '文件已重命名，内容没有变化。',
      'diff.modeOnly': '只有文件权限发生了变化。',
      'diff.mode': '差异视图',
      'diff.unified': '单栏',
      'diff.split': '双栏',
      'diff.fullTitle': '显示完整文件 / 只显示更改附近',
      'diff.prev': '上一个文件',
      'diff.next': '下一个文件',
      'diff.close': '关闭差异',
      'diff.resize': '拖动调整宽度',
      'rev.index': '暂存区',
      'rev.worktree': '工作区',
      'rev.none': '（无）',
      'side.index': '已暂存',
      'side.worktree': '工作区',
      'side.untracked': '未跟踪',
      'side.conflict': '冲突',
      'status.M': '已修改',
      'status.A': '已添加',
      'status.D': '已删除',
      'status.R': '已重命名',
      'status.C': '已复制',
      'status.U': '未跟踪',
      'status.T': '类型已更改',
      'status.conflict': '冲突',
      'error.git-missing': '找不到 git 可执行文件，请确认已安装 Git 并加入 PATH。',
      'error.not-repo': '当前目录不是 Git 仓库。',
      'error.nothing-staged': '没有暂存的更改可以提交。',
      'error.empty-message': '请输入提交消息。',
      'error.conflicts': '请先解决合并冲突再提交。',
      'error.no-remote': '这个仓库没有配置远程仓库。',
      'error.no-upstream': '当前分支没有上游分支，请先发布分支。',
      'error.detached': 'HEAD 处于分离状态，请先切换到分支。',
      'error.bad-branch': '分支名无效。',
      'error.timeout': 'Git 命令超时。',
      'error.network': '无法连接到 Harness：{message}',
      'error.generic': 'Git 出错：{message}',
      'marker.title': '{n} 个未提交的文件',
      'marker.branch': '分支 {branch}',
      'dismiss': '关闭',
    };
    const en = {
      'type.label': 'Git',
      'guide.title': 'Source Control',
      'guide.description': 'Review changes, stage, commit, switch branches and sync',
      loading: 'Reading Git status…',
      noWorkspace: 'This session has no workspace directory.',
      notRepo: 'The current workspace is not a Git repository.',
      'group.conflicts': 'Merge Changes',
      'group.staged': 'Staged Changes',
      'group.changes': 'Changes',
      'empty.clean': 'There are no changes to commit.',
      'commit.placeholder': 'Message (Ctrl+Enter to commit on "{branch}")',
      'commit.placeholderDetached': 'Message (Ctrl+Enter to commit)',
      'commit.button': 'Commit',
      'commit.buttonAll': 'Commit All Changes',
      'commit.amend': 'Amend last commit',
      'sync.button': 'Sync Changes {counts}',
      'publish.button': 'Publish Branch',
      'action.refresh': 'Refresh',
      'action.pull': 'Pull',
      'action.push': 'Push',
      'action.fetch': 'Fetch',
      'action.sync': 'Sync',
      'action.stage': 'Stage Changes',
      'action.unstage': 'Unstage Changes',
      'action.discard': 'Discard Changes',
      'action.open': 'Open File',
      'action.stageAll': 'Stage All Changes',
      'action.unstageAll': 'Unstage All Changes',
      'action.discardAll': 'Discard All Changes',
      'action.collapse': 'Collapse',
      'action.expand': 'Expand',
      'busy.commit': 'Committing…',
      'busy.pull': 'Pulling…',
      'busy.push': 'Pushing…',
      'busy.fetch': 'Fetching…',
      'busy.sync': 'Syncing…',
      'busy.checkout': 'Switching branch…',
      'busy.work': 'Working…',
      'done.commit': 'Committed: {head}',
      'done.push': 'Pushed.',
      'done.publish': 'Published to {remote}.',
      'done.pull': 'Pulled.',
      'done.fetch': 'Fetched.',
      'done.sync': 'Synced.',
      'confirm.discardOne': 'Discard changes in "{name}"? This cannot be undone.',
      'confirm.discardUntracked': 'Delete the untracked file "{name}"? This cannot be undone.',
      'confirm.discardAll': 'Discard changes in all {n} files? Untracked files will be deleted. This cannot be undone.',
      'confirm.ok': 'Discard',
      'confirm.cancel': 'Cancel',
      'branch.detached': 'Detached HEAD',
      'branch.none': 'No branch',
      'branch.filter': 'Select a branch to switch to, or type a new branch name',
      'branch.create': 'Create new branch "{name}"',
      'branch.local': 'Branches',
      'branch.remote': 'Remote branches',
      'branch.loading': 'Reading branches…',
      'branch.empty': 'No matching branch',
      'branch.title': 'Switch branch · {branch}',
      'diff.loading': 'Reading diff…',
      'diff.binary': 'Binary file; no diff to show.',
      'diff.empty': 'No textual differences.',
      'diff.truncated': 'The diff is large; only the beginning is shown.',
      'diff.renamed': 'Renamed without content changes.',
      'diff.modeOnly': 'Only the file mode changed.',
      'diff.mode': 'Diff view',
      'diff.unified': 'Inline',
      'diff.split': 'Side by side',
      'diff.fullTitle': 'Show whole file / only around changes',
      'diff.prev': 'Previous file',
      'diff.next': 'Next file',
      'diff.close': 'Close diff',
      'diff.resize': 'Drag to resize',
      'rev.index': 'Index',
      'rev.worktree': 'Working tree',
      'rev.none': '(none)',
      'side.index': 'Staged',
      'side.worktree': 'Working tree',
      'side.untracked': 'Untracked',
      'side.conflict': 'Conflict',
      'status.M': 'Modified',
      'status.A': 'Added',
      'status.D': 'Deleted',
      'status.R': 'Renamed',
      'status.C': 'Copied',
      'status.U': 'Untracked',
      'status.T': 'Type changed',
      'status.conflict': 'Conflict',
      'error.git-missing': 'The git executable was not found. Install Git and add it to PATH.',
      'error.not-repo': 'This directory is not a Git repository.',
      'error.nothing-staged': 'There are no staged changes to commit.',
      'error.empty-message': 'Enter a commit message.',
      'error.conflicts': 'Resolve merge conflicts before committing.',
      'error.no-remote': 'This repository has no remote.',
      'error.no-upstream': 'The current branch has no upstream. Publish the branch first.',
      'error.detached': 'HEAD is detached. Switch to a branch first.',
      'error.bad-branch': 'Invalid branch name.',
      'error.timeout': 'The Git command timed out.',
      'error.network': 'Could not reach the Harness: {message}',
      'error.generic': 'Git failed: {message}',
      'marker.title': '{n} uncommitted files',
      'marker.branch': 'branch {branch}',
      'dismiss': 'Dismiss',
    };

    /* ------------------------------------------------------------------ */
    /* Host calls and the change bus                                       */
    /* ------------------------------------------------------------------ */

    const bus = new EventTarget();
    const notifyChanged = () => { bus.dispatchEvent(new Event('changed')); };
    /** Commit message drafts by session, kept across tab remounts. */
    const drafts = new Map();

    class CallError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
      }
    }

    async function call(op, args) {
      const url = new URL('api/dsh-git-tree/op', document.baseURI);
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, args }),
        });
      } catch (error) {
        throw new CallError('network', String(error && error.message || error));
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new CallError('network', `HTTP ${response.status}`);
      }
      if (!body || body.ok !== true) {
        const error = body && body.error || {};
        throw new CallError(error.code || 'network', error.message || `HTTP ${response.status}`);
      }
      return body.value;
    }

    function errorText(t, error) {
      const code = error && error.code;
      const message = String(error && error.message || error);
      if (code === 'network') return t('error.network', { message });
      const known = ['git-missing', 'not-repo', 'nothing-staged', 'empty-message', 'conflicts', 'no-remote', 'no-upstream', 'detached', 'bad-branch', 'timeout'];
      if (known.includes(code)) return t(`error.${code}`);
      return t('error.generic', { message });
    }

    /* ------------------------------------------------------------------ */
    /* Paths and resource addresses                                        */
    /* ------------------------------------------------------------------ */

    const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const baseName = (p) => { const s = norm(p); const i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : s; };
    const dirName = (p) => { const s = norm(p); const i = s.lastIndexOf('/'); return i >= 0 ? s.slice(0, i) : ''; };
    const encodeSegment = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ':');
    const encodePath = (p) => p.split('/').map(encodeSegment).join('/');

    /** The Sidebar's file address for a repo-relative path, relative to the Session cwd when inside it. */
    function fileAddress(sessionId, cwd, root, rel) {
      const absolute = `${norm(root)}/${rel}`;
      const base = norm(cwd);
      const inside = base !== '' && absolute.toLowerCase().startsWith(`${base.toLowerCase()}/`);
      const p = inside ? absolute.slice(base.length + 1) : absolute;
      return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encodePath(p)}`;
    }

    /* ------------------------------------------------------------------ */
    /* Icons (original line art, 16px, currentColor)                       */
    /* ------------------------------------------------------------------ */

    function icon(children, size = 16) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false',
      }, ...children);
    }
    const IconBranch = () => icon([
      h('circle', { key: 1, cx: 4.5, cy: 3.5, r: 1.6 }),
      h('circle', { key: 2, cx: 4.5, cy: 12.5, r: 1.6 }),
      h('circle', { key: 3, cx: 11.5, cy: 5, r: 1.6 }),
      h('path', { key: 4, d: 'M4.5 5.1v5.8M11.5 6.6c0 3-7 2.2-7 4.3' }),
    ]);
    const IconRefresh = () => icon([h('path', { key: 1, d: 'M13 3.5v3h-3M3 12.5v-3h3' }), h('path', { key: 2, d: 'M12.6 6.5A5 5 0 0 0 3.6 5M3.4 9.5a5 5 0 0 0 9 1.5' })]);
    const IconPlus = () => icon([h('path', { key: 1, d: 'M8 3.5v9M3.5 8h9' })]);
    const IconMinus = () => icon([h('path', { key: 1, d: 'M3.5 8h9' })]);
    const IconDiscard = () => icon([h('path', { key: 1, d: 'M5.5 3.5 3 6l2.5 2.5' }), h('path', { key: 2, d: 'M3 6h6.5a3.5 3.5 0 0 1 0 7H6' })]);
    const IconOpen = () => icon([h('path', { key: 1, d: 'M9 2.5H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5z' }), h('path', { key: 2, d: 'M9 2.5v4h4' })]);
    const IconDown = () => icon([h('path', { key: 1, d: 'M8 2.5v10M4 8.5l4 4 4-4' })]);
    const IconUp = () => icon([h('path', { key: 1, d: 'M8 13.5v-10M4 7.5l4-4 4 4' })]);
    const IconFetch = () => icon([h('path', { key: 1, d: 'M4.5 11.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.6.6 2.7 2.7 0 0 1 0 5.4' }), h('path', { key: 2, d: 'M8 8v5.5M6 11.5l2 2 2-2' })]);
    const IconSync = () => icon([h('path', { key: 1, d: 'M12.5 2.5v3h-3M3.5 13.5v-3h3' }), h('path', { key: 2, d: 'M12.3 5.5A5 5 0 0 0 3.2 7M12.8 9a5 5 0 0 1-9.1 1.5' })]);
    const IconCheck = () => icon([h('path', { key: 1, d: 'M3 8.5 6.5 12 13 4.5' })]);
    const IconClose = () => icon([h('path', { key: 1, d: 'M4 4l8 8M12 4l-8 8' })]);
    const IconExpand = () => icon([h('path', { key: 1, d: 'M8 1.8v4.4M6 4.2l2 2 2-2M8 14.2V9.8M6 11.8l2-2 2 2M2.5 8h11' })]);
    const IconChevron = ({ open }) => h('svg', {
      width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true,
      className: `dshgit-chevron${open ? ' dshgit-chevron-open' : ''}`,
    }, h('path', { d: 'M6 4l4 4-4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }));

    /** Guide card artwork: a branch glyph on an orange tile. */
    function GuideGlyph({ size = 26, className }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 32 32', className, 'aria-hidden': true },
        h('rect', { x: 2, y: 2, width: 28, height: 28, rx: 8, fill: '#E8663D' }),
        h('g', { fill: 'none', stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round' },
          h('circle', { cx: 11, cy: 9, r: 2.6 }),
          h('circle', { cx: 11, cy: 23, r: 2.6 }),
          h('circle', { cx: 21.5, cy: 12, r: 2.6 }),
          h('path', { d: 'M11 11.6v8.8M21.5 14.6c0 4.6-10.5 3.2-10.5 6.4' })));
    }
    function TitleGlyph() {
      return h('span', { className: 'dshgit-title-icon' }, h(IconBranch));
    }

    /* ------------------------------------------------------------------ */
    /* Small building blocks                                               */
    /* ------------------------------------------------------------------ */

    function ToolButton({ label, onClick, disabled, children, className }) {
      return h('button', {
        type: 'button',
        className: `dshgit-tool${className ? ` ${className}` : ''}`,
        'aria-label': label,
        title: label,
        disabled,
        onClick: (event) => { event.stopPropagation(); onClick(event); },
      }, children);
    }

    const STATUS_CLASS = { M: 'mod', T: 'mod', A: 'add', U: 'add', D: 'del', R: 'ren', C: 'ren', '!': 'del' };

    function statusLetter(entry, group) {
      if (group === 'conflicts') return '!';
      return entry.status;
    }

    /* ------------------------------------------------------------------ */
    /* Diff model                                                          */
    /* ------------------------------------------------------------------ */

    const DIFF_HEADER = /^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|dissimilarity index|rename from|rename to|copy from|copy to|old mode|new mode|\\ No newline)/;

    /** Unified patch text → hunks of { kind, text, a, b } lines. */
    function parseDiff(text) {
      const hunks = [];
      let current = null;
      let oldNo = 0;
      let newNo = 0;
      for (const line of text.split('\n')) {
        if (DIFF_HEADER.test(line)) continue;
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
        if (hunk || line.startsWith('@@')) {
          oldNo = hunk ? Number(hunk[1]) : 1;
          newNo = hunk ? Number(hunk[2]) : 1;
          current = { header: line, lines: [] };
          hunks.push(current);
          continue;
        }
        if (current === null) continue;
        if (line.startsWith('+')) current.lines.push({ kind: 'add', text: line.slice(1), a: '', b: newNo++ });
        else if (line.startsWith('-')) current.lines.push({ kind: 'del', text: line.slice(1), a: oldNo++, b: '' });
        else if (line.startsWith(' ')) current.lines.push({ kind: 'ctx', text: line.slice(1), a: oldNo++, b: newNo++ });
      }
      return hunks;
    }

    /** Group a hunk's lines into context lines and change blocks (deletions followed by additions). */
    function blocksOf(lines) {
      const out = [];
      let i = 0;
      while (i < lines.length) {
        if (lines[i].kind === 'ctx') {
          out.push({ type: 'ctx', line: lines[i] });
          i += 1;
          continue;
        }
        const dels = [];
        const adds = [];
        while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
        while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
        out.push({ type: 'change', dels, adds });
      }
      return out;
    }

    /** Changed span between two similar lines (common prefix and suffix trimmed), or null. */
    function inlineSpan(a, b) {
      if (a.length > 2000 || b.length > 2000) return null;
      const max = Math.min(a.length, b.length);
      let p = 0;
      while (p < max && a[p] === b[p]) p += 1;
      let s = 0;
      while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
      if (p === a.length && p === b.length) return null;
      const shorter = Math.min(a.length, b.length);
      if (shorter > 6 && p + s < shorter * 0.35) return null;
      return {
        a: [a.slice(0, p), a.slice(p, a.length - s), a.slice(a.length - s)],
        b: [b.slice(0, p), b.slice(p, b.length - s), b.slice(b.length - s)],
      };
    }

    function codeContent(text, parts) {
      if (!parts || parts[1] === '') return text === '' ? ' ' : text;
      return [parts[0], h('mark', { key: 'm', className: 'dshgit-inline' }, parts[1]), parts[2]];
    }

    function UnifiedTable({ hunks }) {
      const rows = [];
      hunks.forEach((hunk, hi) => {
        rows.push(h('tr', { key: `h${hi}`, className: 'dshgit-diff-hunk' }, h('td', { colSpan: 4 }, hunk.header)));
        blocksOf(hunk.lines).forEach((block, bi) => {
          if (block.type === 'ctx') {
            const l = block.line;
            rows.push(h('tr', { key: `${hi}:${bi}`, className: 'dshgit-diff-ctx' },
              h('td', { className: 'dshgit-diff-no' }, l.a), h('td', { className: 'dshgit-diff-no' }, l.b),
              h('td', { className: 'dshgit-diff-sign' }), h('td', { className: 'dshgit-diff-code' }, codeContent(l.text))));
            return;
          }
          const pairs = Math.min(block.dels.length, block.adds.length);
          const spans = [];
          for (let k = 0; k < pairs; k += 1) spans.push(inlineSpan(block.dels[k].text, block.adds[k].text));
          block.dels.forEach((l, k) => rows.push(h('tr', { key: `${hi}:${bi}:d${k}`, className: 'dshgit-diff-del' },
            h('td', { className: 'dshgit-diff-no' }, l.a), h('td', { className: 'dshgit-diff-no' }),
            h('td', { className: 'dshgit-diff-sign' }, '-'), h('td', { className: 'dshgit-diff-code' }, codeContent(l.text, spans[k]?.a)))));
          block.adds.forEach((l, k) => rows.push(h('tr', { key: `${hi}:${bi}:a${k}`, className: 'dshgit-diff-add' },
            h('td', { className: 'dshgit-diff-no' }), h('td', { className: 'dshgit-diff-no' }, l.b),
            h('td', { className: 'dshgit-diff-sign' }, '+'), h('td', { className: 'dshgit-diff-code' }, codeContent(l.text, spans[k]?.b)))));
        });
      });
      return h('table', { className: 'dshgit-diff-table dshgit-diff-unified' }, h('tbody', null, rows));
    }

    function SplitTable({ hunks, leftLabel, rightLabel }) {
      const rows = [];
      const side = (line, kind, parts, key) => {
        const edge = key === 'r' ? ' dshgit-split-right' : '';
        const cell = line ? `dshgit-cell-${kind}` : 'dshgit-cell-empty';
        return [
          h('td', { key: `${key}n`, className: `dshgit-diff-no ${cell}${edge}` }, line ? (kind === 'add' ? line.b : line.a) : null),
          h('td', { key: `${key}c`, className: `dshgit-diff-code ${cell}` }, line ? codeContent(line.text, parts) : null),
        ];
      };
      hunks.forEach((hunk, hi) => {
        rows.push(h('tr', { key: `h${hi}`, className: 'dshgit-diff-hunk' }, h('td', { colSpan: 4 }, hunk.header)));
        blocksOf(hunk.lines).forEach((block, bi) => {
          if (block.type === 'ctx') {
            const l = block.line;
            rows.push(h('tr', { key: `${hi}:${bi}` },
              h('td', { className: 'dshgit-diff-no' }, l.a), h('td', { className: 'dshgit-diff-code' }, codeContent(l.text)),
              h('td', { className: 'dshgit-diff-no dshgit-split-right' }, l.b), h('td', { className: 'dshgit-diff-code' }, codeContent(l.text))));
            return;
          }
          const n = Math.max(block.dels.length, block.adds.length);
          for (let k = 0; k < n; k += 1) {
            const d = block.dels[k];
            const a = block.adds[k];
            const span = d && a ? inlineSpan(d.text, a.text) : null;
            rows.push(h('tr', { key: `${hi}:${bi}:${k}` }, ...side(d, 'del', span?.a, 'l'), ...side(a, 'add', span?.b, 'r')));
          }
        });
      });
      return h('table', { className: 'dshgit-diff-table dshgit-diff-split' },
        h('colgroup', null, h('col', { className: 'dshgit-col-no' }), h('col'), h('col', { className: 'dshgit-col-no' }), h('col')),
        h('thead', null, h('tr', null,
          h('th', { colSpan: 2 }, leftLabel),
          h('th', { colSpan: 2, className: 'dshgit-split-right' }, rightLabel))),
        h('tbody', null, rows));
    }

    const readPref = (key, fallback) => { try { return localStorage.getItem(`dsh-git-tree.${key}`) ?? fallback; } catch { return fallback; } };
    const writePref = (key, value) => { try { localStorage.setItem(`dsh-git-tree.${key}`, String(value)); } catch { /* ignore */ } };

    /** The diff pane to the right of the change list. */
    function DiffPane({ cwd, entry, group, stamp, mode, setMode, full, setFull, onOpen, onPrev, onNext, onClose, t }) {
      const [state, setState] = useState({ phase: 'loading' });
      const untracked = group === 'changes' && entry.status === 'U';
      useEffect(() => {
        let live = true;
        setState((current) => (current.phase === 'ready' && current.path === entry.path && current.group === group ? current : { phase: 'loading' }));
        call('diff', { cwd, path: entry.path, orig: entry.orig, staged: group === 'staged', untracked, context: full ? 'full' : 'near' })
          .then((value) => { if (live) setState({ phase: 'ready', value, path: entry.path, group }); })
          .catch((error) => { if (live) setState({ phase: 'error', error }); });
        return () => { live = false; };
      }, [cwd, entry.path, entry.orig, entry.status, group, untracked, full, stamp]);

      const letter = statusLetter(entry, group);
      const revs = group === 'staged'
        ? [entry.status === 'A' ? t('rev.none') : 'HEAD', entry.status === 'D' ? t('rev.none') : t('rev.index')]
        : group === 'conflicts'
          ? [t('rev.index'), t('rev.worktree')]
          : [untracked ? t('rev.none') : t('rev.index'), entry.status === 'D' ? t('rev.none') : t('rev.worktree')];
      const leftLabel = entry.orig ? `${revs[0]} · ${entry.orig}` : revs[0];
      const chip = group === 'staged' ? t('side.index') : group === 'conflicts' ? t('side.conflict') : untracked ? t('side.untracked') : t('side.worktree');

      let content;
      if (state.phase === 'loading') content = h('div', { className: 'dshgit-diff-note' }, t('diff.loading'));
      else if (state.phase === 'error') content = h('div', { className: 'dshgit-diff-note dshgit-error-text' }, errorText(t, state.error));
      else if (state.value.binary) content = h('div', { className: 'dshgit-diff-note' }, t('diff.binary'));
      else {
        const hunks = parseDiff(state.value.text);
        if (hunks.length === 0) {
          const renamed = /^rename from /m.test(state.value.text) || entry.orig !== undefined;
          const modeOnly = /^old mode /m.test(state.value.text);
          content = h('div', { className: 'dshgit-diff-note' }, t(renamed ? 'diff.renamed' : modeOnly ? 'diff.modeOnly' : 'diff.empty'));
        }
        else {
          content = h(React.Fragment, null,
            state.value.truncated && h('div', { className: 'dshgit-diff-note' }, t('diff.truncated')),
            mode === 'split' ? h(SplitTable, { hunks, leftLabel, rightLabel: revs[1] }) : h(UnifiedTable, { hunks }));
        }
      }

      const seg = (value, label) => h('button', {
        type: 'button',
        className: `dshgit-seg${mode === value ? ' dshgit-seg-on' : ''}`,
        'aria-pressed': mode === value,
        onClick: () => setMode(value),
      }, label);

      return h('div', { className: 'dshgit-diffpane', role: 'region', 'aria-label': entry.path },
        h('div', { className: 'dshgit-diffbar' },
          h('span', { className: `dshgit-letter dshgit-letter-${STATUS_CLASS[letter] || 'mod'}` }, letter),
          h('span', { className: 'dshgit-diff-title', title: entry.orig ? `${entry.orig} → ${entry.path}` : entry.path },
            h('span', { className: 'dshgit-name' }, baseName(entry.path)),
            dirName(entry.path) !== '' && h('span', { className: 'dshgit-dir' }, dirName(entry.path))),
          h('span', { className: 'dshgit-chip' }, chip),
          h('span', { className: 'dshgit-spacer' }),
          h('span', { className: 'dshgit-segs', role: 'group', 'aria-label': t('diff.mode') }, seg('unified', t('diff.unified')), seg('split', t('diff.split'))),
          h(ToolButton, { label: t('diff.fullTitle'), onClick: () => setFull(!full), className: full ? 'dshgit-tool-on' : '' }, h(IconExpand)),
          h(ToolButton, { label: t('diff.prev'), onClick: onPrev, disabled: !onPrev }, h(IconUp)),
          h(ToolButton, { label: t('diff.next'), onClick: onNext, disabled: !onNext }, h(IconDown)),
          onOpen && h(ToolButton, { label: t('action.open'), onClick: onOpen }, h(IconOpen)),
          h(ToolButton, { label: t('diff.close'), onClick: onClose }, h(IconClose))),
        h('div', { className: `dshgit-diff-scroll${mode === 'split' ? ' dshgit-wrap' : ''}` }, content));
    }

    /* ------------------------------------------------------------------ */
    /* File rows and groups                                                */
    /* ------------------------------------------------------------------ */

    function FileRow({ entry, group, selected, onSelect, actions, disabled, rowKey, t }) {
      const letter = statusLetter(entry, group);
      const statusLabel = group === 'conflicts' ? t('status.conflict') : t(`status.${entry.status}`);
      const dir = dirName(entry.path);
      return h('li', { className: 'dshgit-file-item' },
        h('div', {
          className: `dshgit-row dshgit-file${selected ? ' dshgit-row-selected' : ''}`,
          role: 'option',
          tabIndex: selected ? 0 : -1,
          'aria-selected': selected,
          'data-file-key': rowKey,
          title: `${entry.path}${entry.orig ? ` ← ${entry.orig}` : ''} · ${statusLabel}`,
          onClick: onSelect,
          onDoubleClick: actions.open,
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } },
        },
        h('span', { className: `dshgit-name${letter === 'D' ? ' dshgit-deleted' : ''}` }, baseName(entry.path)),
        dir !== '' && h('span', { className: 'dshgit-dir' }, dir),
        h('span', { className: 'dshgit-spacer' }),
        h('span', { className: 'dshgit-actions' },
          actions.open && h(ToolButton, { label: t('action.open'), onClick: actions.open, disabled }, h(IconOpen)),
          actions.discard && h(ToolButton, { label: t('action.discard'), onClick: actions.discard, disabled }, h(IconDiscard)),
          actions.stage && h(ToolButton, { label: t('action.stage'), onClick: actions.stage, disabled }, h(IconPlus)),
          actions.unstage && h(ToolButton, { label: t('action.unstage'), onClick: actions.unstage, disabled }, h(IconMinus))),
        h('span', { className: `dshgit-letter dshgit-letter-${STATUS_CLASS[letter] || 'mod'}`, title: statusLabel }, letter)));
    }

    function Group({ id, title, entries, collapsed, onCollapse, groupActions, renderFile, disabled, t }) {
      if (entries.length === 0) return null;
      return h('section', { className: 'dshgit-group' },
        h('div', {
          className: 'dshgit-row dshgit-group-head',
          role: 'button',
          tabIndex: 0,
          'aria-expanded': !collapsed,
          onClick: onCollapse,
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCollapse(); } },
        },
        h(IconChevron, { open: !collapsed }),
        h('span', { className: 'dshgit-group-title' }, title),
        h('span', { className: 'dshgit-spacer' }),
        h('span', { className: 'dshgit-actions' },
          groupActions.discard && h(ToolButton, { label: t('action.discardAll'), onClick: groupActions.discard, disabled }, h(IconDiscard)),
          groupActions.stage && h(ToolButton, { label: t('action.stageAll'), onClick: groupActions.stage, disabled }, h(IconPlus)),
          groupActions.unstage && h(ToolButton, { label: t('action.unstageAll'), onClick: groupActions.unstage, disabled }, h(IconMinus))),
        h('span', { className: 'dshgit-count' }, entries.length)),
        !collapsed && h('ul', { className: 'dshgit-list', 'data-group': id }, entries.map((entry) => renderFile(entry, id))));
    }

    /* ------------------------------------------------------------------ */
    /* Branch picker                                                       */
    /* ------------------------------------------------------------------ */

    function BranchPicker({ cwd, current, onPick, onClose, t }) {
      const [filter, setFilter] = useState('');
      const [state, setState] = useState({ phase: 'loading' });
      const inputRef = useRef(null);
      useEffect(() => {
        let live = true;
        call('branches', { cwd })
          .then((value) => { if (live) setState({ phase: 'ready', value }); })
          .catch((error) => { if (live) setState({ phase: 'error', error }); });
        inputRef.current?.focus();
        return () => { live = false; };
      }, [cwd]);
      const query = filter.trim().toLowerCase();
      const match = (name) => query === '' || name.toLowerCase().includes(query);
      const local = state.phase === 'ready' ? state.value.local.filter((b) => match(b.name)) : [];
      const remote = state.phase === 'ready' ? state.value.remote.filter((b) => match(b.name)) : [];
      const exact = state.phase === 'ready' && state.value.local.some((b) => b.name === filter.trim());
      const canCreate = filter.trim() !== '' && !exact && !/\s/.test(filter.trim());
      const item = (key, label, meta, onSelect, extra) => h('button', {
        key, type: 'button', className: `dshgit-menu-item${extra ? ` ${extra}` : ''}`, onClick: onSelect,
      }, h('span', { className: 'dshgit-menu-label' }, label), meta && h('span', { className: 'dshgit-menu-meta' }, meta));
      return h('div', {
        className: 'dshgit-picker',
        role: 'dialog',
        onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } },
      },
      h('input', {
        ref: inputRef,
        className: 'dshgit-input',
        value: filter,
        placeholder: t('branch.filter'),
        onChange: (event) => setFilter(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            if (canCreate) onPick({ name: filter.trim(), create: true });
            else if (local[0]) onPick({ name: local[0].name });
          }
        },
      }),
      h('div', { className: 'dshgit-menu' },
        canCreate && item('create', h('span', null, h(IconPlus), ' ', t('branch.create', { name: filter.trim() })), null, () => onPick({ name: filter.trim(), create: true }), 'dshgit-menu-create'),
        state.phase === 'loading' && h('div', { className: 'dshgit-menu-note' }, t('branch.loading')),
        state.phase === 'error' && h('div', { className: 'dshgit-menu-note dshgit-error-text' }, errorText(t, state.error)),
        local.length > 0 && h('div', { className: 'dshgit-menu-heading' }, t('branch.local')),
        local.map((b) => item(`l:${b.name}`, h('span', null, b.current ? h(IconCheck) : h('span', { className: 'dshgit-menu-pad' }), ' ', b.name), b.date, () => { if (b.name !== current) onPick({ name: b.name }); else onClose(); })),
        remote.length > 0 && h('div', { className: 'dshgit-menu-heading' }, t('branch.remote')),
        remote.map((b) => item(`r:${b.name}`, h('span', null, h('span', { className: 'dshgit-menu-pad' }), ' ', b.name), b.date, () => onPick({ name: b.name, remote: true }))),
        state.phase === 'ready' && local.length === 0 && remote.length === 0 && !canCreate && h('div', { className: 'dshgit-menu-note' }, t('branch.empty'))));
    }

    /* ------------------------------------------------------------------ */
    /* The tab body                                                        */
    /* ------------------------------------------------------------------ */

    function GitBody({ useTabInfo, sessionId, useSessions, t }) {
      const { tab } = useTabInfo();
      const cwd = useSessions((sessions) => sessions.byId[sessionId]?.cwd);
      const [state, setState] = useState({ phase: 'loading' });
      const [busy, setBusy] = useState(null);
      const busyRef = useRef(null);
      const [notice, setNotice] = useState(null);
      const [message, setMessageState] = useState(() => drafts.get(sessionId) ?? '');
      const [amend, setAmend] = useState(false);
      const [collapsed, setCollapsed] = useState({});
      const [selected, setSelected] = useState(null);
      const [diffBump, setDiffBump] = useState(0);
      const [mode, setModeState] = useState(() => (readPref('diffMode', 'split') === 'unified' ? 'unified' : 'split'));
      const [full, setFullState] = useState(() => readPref('fullFile', 'false') === 'true');
      const [listWidth, setListWidth] = useState(() => {
        const n = Number(readPref('listWidth', '320'));
        return Number.isFinite(n) ? Math.min(800, Math.max(200, n)) : 320;
      });
      const [narrow, setNarrow] = useState(false);
      const rootRef = useRef(null);
      const setMode = (value) => { writePref('diffMode', value); setModeState(value); };
      const setFull = (value) => { writePref('fullFile', value); setFullState(value); };

      useEffect(() => {
        const el = rootRef.current;
        if (el === null || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 560));
        observer.observe(el);
        return () => observer.disconnect();
      }, [state.phase === 'ready' && state.data.repo]);

      const startResize = (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = listWidth;
        const total = rootRef.current?.getBoundingClientRect().width ?? 1000;
        let latest = startWidth;
        const move = (e) => {
          latest = Math.round(Math.min(Math.max(200, startWidth + e.clientX - startX), Math.max(240, total - 260)));
          setListWidth(latest);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          document.body.style.removeProperty('cursor');
          document.body.style.removeProperty('user-select');
          writePref('listWidth', latest);
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      };
      const [confirm, setConfirm] = useState(null);
      const [picker, setPicker] = useState(false);
      const seq = useRef(0);

      const setMessage = (value) => { drafts.set(sessionId, value); setMessageState(value); };

      const refresh = useCallback(async () => {
        if (cwd === undefined) return;
        const mine = ++seq.current;
        try {
          const data = await call('status', { cwd });
          if (mine === seq.current) setState({ phase: 'ready', data });
        } catch (error) {
          if (mine === seq.current) setState({ phase: 'error', error });
        }
      }, [cwd]);

      useEffect(() => {
        setState({ phase: 'loading' });
        void refresh();
      }, [refresh]);

      useEffect(() => tab.actions.bindCommands({ refresh: () => { setDiffBump((n) => n + 1); void refresh(); } }), [tab.actions, refresh]);

      useEffect(() => {
        if (tab.visible === false) return undefined;
        const tick = () => {
          if (document.visibilityState === 'visible' && busyRef.current === null) void refresh();
        };
        const timer = setInterval(tick, POLL_MS);
        const onChanged = () => { void refresh(); };
        window.addEventListener('focus', tick);
        bus.addEventListener('changed', onChanged);
        tick();
        return () => {
          clearInterval(timer);
          window.removeEventListener('focus', tick);
          bus.removeEventListener('changed', onChanged);
        };
      }, [tab.visible, refresh]);

      const run = async (op, args, busyKey, done) => {
        busyRef.current = op;
        setBusy(busyKey);
        setNotice(null);
        try {
          const value = await call(op, { cwd, ...args });
          if (done) {
            const text = done(value);
            if (text) setNotice({ kind: 'info', text });
          }
          return value;
        } catch (error) {
          setNotice({ kind: 'error', text: errorText(t, error) });
          return undefined;
        } finally {
          busyRef.current = null;
          setBusy(null);
          setDiffBump((n) => n + 1);
          await refresh();
          notifyChanged();
        }
      };

      const data = state.phase === 'ready' ? state.data : undefined;
      const stamp = useMemo(() => `${data ? JSON.stringify([data.staged, data.changes, data.conflicts]) : ''}#${diffBump}`, [data, diffBump]);

      if (cwd === undefined) return h('div', { className: 'dshgit-root' }, h('p', { className: 'dshgit-status-line' }, t('noWorkspace')));
      if (state.phase === 'loading') return h('div', { className: 'dshgit-root' }, h('p', { className: 'dshgit-status-line' }, t('loading')));
      if (state.phase === 'error') {
        return h('div', { className: 'dshgit-root' },
          h('div', { className: 'dshgit-header' }, h('span', { className: 'dshgit-spacer' }), h(ToolButton, { label: t('action.refresh'), onClick: () => refresh() }, h(IconRefresh))),
          h('p', { className: 'dshgit-status-line dshgit-error-text' }, errorText(t, state.error)));
      }
      if (!data.repo) {
        return h('div', { className: 'dshgit-root' },
          h('div', { className: 'dshgit-header' }, h('span', { className: 'dshgit-path', title: cwd }, cwd), h('span', { className: 'dshgit-spacer' }), h(ToolButton, { label: t('action.refresh'), onClick: () => refresh() }, h(IconRefresh))),
          h('p', { className: 'dshgit-status-line' }, t('notRepo')));
      }

      const { branch, staged, changes, conflicts, remotes } = data;
      const disabled = busy !== null;
      const branchName = branch.detached ? (branch.oid ? `${branch.oid.slice(0, 8)}` : t('branch.detached')) : (branch.head || t('branch.none'));
      const hasRemote = remotes.length > 0;
      const total = staged.length + changes.length + conflicts.length;
      const commitAll = staged.length === 0 && changes.length > 0;
      const canCommit = !disabled && conflicts.length === 0 && (amend || ((staged.length > 0 || commitAll) && message.trim() !== ''));

      const commit = () => {
        if (!canCommit) {
          if (message.trim() === '' && !amend && total > 0) setNotice({ kind: 'error', text: t('error.empty-message') });
          return;
        }
        void run('commit', { message, amend, stageAll: commitAll }, 'busy.commit', (value) => {
          setMessage('');
          setAmend(false);
          return t('done.commit', { head: value.head });
        });
      };

      const askDiscard = (entries) => {
        const one = entries.length === 1 ? entries[0] : undefined;
        const text = one
          ? t(one.status === 'U' ? 'confirm.discardUntracked' : 'confirm.discardOne', { name: baseName(one.path) })
          : t('confirm.discardAll', { n: entries.length });
        setConfirm({ text, action: () => run('discard', one ? { paths: [one.path] } : { all: true }, 'busy.work') });
      };

      const ordered = [
        ...(collapsed.conflicts ? [] : conflicts.map((entry) => ({ entry, group: 'conflicts' }))),
        ...(collapsed.staged ? [] : staged.map((entry) => ({ entry, group: 'staged' }))),
        ...(collapsed.changes ? [] : changes.map((entry) => ({ entry, group: 'changes' }))),
      ];
      const keyOf = (item) => `${item.group}:${item.entry.path}`;
      const allItems = [
        ...conflicts.map((entry) => ({ entry, group: 'conflicts' })),
        ...staged.map((entry) => ({ entry, group: 'staged' })),
        ...changes.map((entry) => ({ entry, group: 'changes' })),
      ];
      // A selection survives a stage/unstage: fall back to the same path in another group.
      const current = selected === null ? undefined
        : allItems.find((item) => keyOf(item) === selected)
          ?? allItems.find((item) => item.entry.path === selected.slice(selected.indexOf(':') + 1));
      const currentKey = current ? keyOf(current) : null;
      const index = current ? ordered.findIndex((item) => keyOf(item) === currentKey) : -1;
      const step = (delta) => {
        const target = ordered[index + delta];
        if (!target) return undefined;
        return () => {
          setSelected(keyOf(target));
          requestAnimationFrame(() => rootRef.current?.querySelector(`[data-file-key="${CSS.escape(keyOf(target))}"]`)?.scrollIntoView?.({ block: 'nearest' }));
        };
      };
      const openFile = (entry) => (entry.status === 'D' ? undefined : () => tab.actions.openResource(fileAddress(sessionId, cwd, data.root, entry.path)));

      const renderFile = (entry, group) => {
        const key = `${group}:${entry.path}`;
        const actions = { open: openFile(entry) };
        if (group === 'staged') actions.unstage = () => run('unstage', { paths: entry.orig ? [entry.path, entry.orig] : [entry.path] }, 'busy.work');
        if (group === 'changes') {
          actions.discard = () => askDiscard([entry]);
          actions.stage = () => run('stage', { paths: [entry.path] }, 'busy.work');
        }
        if (group === 'conflicts') actions.stage = () => run('stage', { paths: [entry.path] }, 'busy.work');
        return h(FileRow, {
          key, entry, group, t, disabled, actions, rowKey: key,
          selected: currentKey === key,
          onSelect: () => setSelected(currentKey === key ? null : key),
        });
      };

      const toggleGroup = (id) => setCollapsed((current) => ({ ...current, [id]: !current[id] }));

      const counts = `${branch.behind > 0 ? `${branch.behind}↓ ` : ''}${branch.ahead > 0 ? `${branch.ahead}↑` : ''}`.trim();
      const showSync = !branch.detached && branch.upstream !== undefined && (branch.ahead > 0 || branch.behind > 0);
      const showPublish = !branch.detached && branch.upstream === undefined && hasRemote && data.hasCommits;

      const showDiff = current !== undefined;
      const listPane = (children) => h('div', {
        className: 'dshgit-split',
        'data-diff': showDiff ? (narrow ? 'stacked' : 'side') : 'none',
        style: showDiff && !narrow ? { '--dshgit-list-width': `${listWidth}px` } : undefined,
      },
      h('div', {
        className: 'dshgit-body',
        role: 'listbox',
        'aria-label': t('group.changes'),
        onKeyDown: (event) => {
          if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const go = step(event.key === 'ArrowDown' ? 1 : -1) ?? (index < 0 && ordered[0] ? () => setSelected(keyOf(ordered[0])) : undefined);
            if (go) { event.preventDefault(); go(); }
          } else if (event.key === 'Escape' && showDiff) {
            setSelected(null);
          }
        },
      }, ...children),
      showDiff && !narrow && h('div', {
        className: 'dshgit-splitter',
        role: 'separator',
        'aria-orientation': 'vertical',
        title: t('diff.resize'),
        onPointerDown: startResize,
        onDoubleClick: () => { setListWidth(320); writePref('listWidth', 320); },
      }),
      showDiff && h(DiffPane, {
        cwd, entry: current.entry, group: current.group, stamp, mode, setMode, full, setFull, t,
        onOpen: openFile(current.entry),
        onPrev: step(-1),
        onNext: step(1),
        onClose: () => setSelected(null),
      }));

      return h('div', {
        ref: rootRef,
        className: 'dshgit-root',
        onKeyDown: (event) => { if (event.key === 'Escape' && picker) setPicker(false); },
      },
      h('div', { className: 'dshgit-header' },
        h('button', {
          type: 'button',
          className: 'dshgit-branch',
          title: t('branch.title', { branch: branchName }),
          disabled,
          onClick: () => setPicker((v) => !v),
        },
        h(IconBranch),
        h('span', { className: 'dshgit-branch-name' }, branchName),
        branch.upstream !== undefined && (branch.ahead > 0 || branch.behind > 0) && h('span', { className: 'dshgit-ab' }, counts)),
        h('span', { className: 'dshgit-spacer' }),
        h(ToolButton, { label: t('action.refresh'), onClick: () => { setDiffBump((n) => n + 1); void refresh(); }, disabled }, h(IconRefresh)),
        hasRemote && h(ToolButton, { label: t('action.pull'), onClick: () => run('pull', {}, 'busy.pull', () => t('done.pull')), disabled }, h(IconDown)),
        hasRemote && h(ToolButton, { label: t('action.push'), onClick: () => run('push', {}, 'busy.push', (v) => (v.published ? t('done.publish', { remote: v.published }) : t('done.push'))), disabled }, h(IconUp)),
        hasRemote && h(ToolButton, { label: t('action.fetch'), onClick: () => run('fetch', {}, 'busy.fetch', () => t('done.fetch')), disabled }, h(IconFetch))),
      picker && h(BranchPicker, {
        cwd,
        current: branch.head,
        t,
        onClose: () => setPicker(false),
        onPick: (choice) => {
          setPicker(false);
          void run('checkout', choice, 'busy.checkout');
        },
      }),
      busy !== null && h('div', { className: 'dshgit-progress', role: 'status' }, h('span', { className: 'dshgit-progress-bar' }), h('span', null, t(busy))),
      notice !== null && h('div', { className: `dshgit-notice dshgit-notice-${notice.kind}`, role: notice.kind === 'error' ? 'alert' : 'status' },
        h('span', { className: 'dshgit-notice-text' }, notice.text),
        h('button', { type: 'button', className: 'dshgit-notice-close', 'aria-label': t('dismiss'), onClick: () => setNotice(null) }, '×')),
      listPane([
        h('div', { key: 'commit', className: 'dshgit-commit' },
          h('textarea', {
            className: 'dshgit-input dshgit-message',
            rows: Math.min(8, Math.max(2, message.split('\n').length)),
            value: message,
            disabled,
            placeholder: branch.detached ? t('commit.placeholderDetached') : t('commit.placeholder', { branch: branchName }),
            onChange: (event) => setMessage(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                commit();
              }
            },
          }),
          h('label', { className: 'dshgit-amend' },
            h('input', { type: 'checkbox', checked: amend, disabled: disabled || !data.hasCommits, onChange: (event) => setAmend(event.target.checked) }),
            h('span', null, t('commit.amend'))),
          h('button', {
            type: 'button',
            className: 'dshgit-primary',
            disabled: !canCommit,
            onClick: commit,
          }, h(IconCheck), h('span', null, commitAll && !amend ? t('commit.buttonAll') : t('commit.button'))),
          showSync && h('button', {
            type: 'button',
            className: 'dshgit-secondary',
            disabled,
            onClick: () => run('sync', {}, 'busy.sync', () => t('done.sync')),
          }, h(IconSync), h('span', null, t('sync.button', { counts }))),
          showPublish && h('button', {
            type: 'button',
            className: 'dshgit-secondary',
            disabled,
            onClick: () => run('push', {}, 'busy.push', (v) => (v.published ? t('done.publish', { remote: v.published }) : t('done.push'))),
          }, h(IconUp), h('span', null, t('publish.button')))),
        total === 0 && h('p', { key: 'clean', className: 'dshgit-status-line' }, t('empty.clean')),
        h(Group, {
          key: 'conflicts', id: 'conflicts', title: t('group.conflicts'), entries: conflicts, collapsed: collapsed.conflicts, t, disabled, renderFile,
          onCollapse: () => toggleGroup('conflicts'),
          groupActions: { stage: () => run('stage', { paths: conflicts.map((c) => c.path) }, 'busy.work') },
        }),
        h(Group, {
          key: 'staged', id: 'staged', title: t('group.staged'), entries: staged, collapsed: collapsed.staged, t, disabled, renderFile,
          onCollapse: () => toggleGroup('staged'),
          groupActions: { unstage: () => run('unstage', { all: true }, 'busy.work') },
        }),
        h(Group, {
          key: 'changes', id: 'changes', title: t('group.changes'), entries: changes, collapsed: collapsed.changes, t, disabled, renderFile,
          onCollapse: () => toggleGroup('changes'),
          groupActions: {
            discard: () => askDiscard(changes),
            stage: () => run('stage', { paths: changes.map((c) => c.path) }, 'busy.work'),
          },
        })]),
      confirm !== null && h('div', { className: 'dshgit-confirm-backdrop', onClick: () => setConfirm(null) },
        h('div', {
          className: 'dshgit-confirm',
          role: 'alertdialog',
          'aria-modal': true,
          onClick: (event) => event.stopPropagation(),
          onKeyDown: (event) => { if (event.key === 'Escape') setConfirm(null); },
        },
        h('p', { className: 'dshgit-confirm-text' }, confirm.text),
        h('div', { className: 'dshgit-confirm-actions' },
          h('button', { type: 'button', className: 'dshgit-secondary dshgit-inline', autoFocus: true, onClick: () => setConfirm(null) }, t('confirm.cancel')),
          h('button', {
            type: 'button',
            className: 'dshgit-danger dshgit-inline',
            onClick: () => { const action = confirm.action; setConfirm(null); void action(); },
          }, t('confirm.ok'))))));
    }

    function GitTitle({ useTabInfo }) {
      const { tab } = useTabInfo();
      return h(React.Fragment, null, h(TitleGlyph), tab.title);
    }

    /* ------------------------------------------------------------------ */
    /* Workspace row markers                                               */
    /* ------------------------------------------------------------------ */

    function WorkspaceMarkers({ useWorkspaces, t }) {
      const items = useWorkspaces((state) => state.items);
      const list = useMemo(() => (Array.isArray(items) ? items : [])
        .filter((item) => typeof item.path === 'string' && item.workspaceId !== undefined)
        .map((item) => ({ id: String(item.workspaceId), path: item.path })), [items]);
      const key = list.map((item) => `${item.id}=${item.path}`).join('|');
      const [summary, setSummary] = useState({});

      useEffect(() => {
        if (list.length === 0) return undefined;
        let live = true;
        let running = false;
        const load = async () => {
          if (running || document.visibilityState !== 'visible') return;
          running = true;
          try {
            const value = await call('statusMany', { paths: list.map((item) => item.path) });
            if (live) setSummary(value);
          } catch {
            /* markers stay as they were */
          } finally {
            running = false;
          }
        };
        const onChanged = () => { void load(); };
        const timer = setInterval(load, MARKER_POLL_MS);
        window.addEventListener('focus', onChanged);
        document.addEventListener('visibilitychange', onChanged);
        bus.addEventListener('changed', onChanged);
        void load();
        return () => {
          live = false;
          clearInterval(timer);
          window.removeEventListener('focus', onChanged);
          document.removeEventListener('visibilitychange', onChanged);
          bus.removeEventListener('changed', onChanged);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key]);

      useEffect(() => {
        const wanted = new Map();
        for (const item of list) {
          const info = summary[item.path];
          if (info && info.repo && info.count > 0) {
            const parts = [t('marker.title', { n: info.count })];
            if (info.branch && info.branch !== '(detached)') parts.push(t('marker.branch', { branch: info.branch }));
            wanted.set(item.id, { text: info.count > 99 ? '99+' : String(info.count), title: parts.join(' · '), conflict: info.conflicts > 0 });
          }
        }
        const sync = () => {
          for (const marker of document.querySelectorAll(`[${MARKER_ATTR}]`)) {
            const row = marker.parentElement;
            const id = marker.getAttribute(MARKER_ATTR);
            if (!wanted.has(id) || row === null || row.getAttribute('data-row-key') !== `workspace:${id}`) marker.remove();
          }
          for (const [id, mark] of wanted) {
            const selector = `[data-row-key="workspace:${CSS.escape(id)}"]`;
            for (const row of document.querySelectorAll(selector)) {
              let marker = row.querySelector(`:scope > [${MARKER_ATTR}]`);
              if (marker === null) {
                marker = document.createElement('span');
                marker.setAttribute(MARKER_ATTR, id);
                marker.className = 'dshgit-marker';
                const dot = document.createElement('span');
                dot.className = 'dshgit-marker-dot';
                const count = document.createElement('span');
                count.className = 'dshgit-marker-count';
                marker.append(dot, count);
                const text = row.querySelector(':scope > [class*="projectText"]');
                row.insertBefore(marker, text ? text.nextSibling : null);
              }
              const count = marker.lastChild;
              if (count.textContent !== mark.text) count.textContent = mark.text;
              if (marker.title !== mark.title) {
                marker.title = mark.title;
                marker.setAttribute('aria-label', mark.title);
              }
              const cls = `dshgit-marker${mark.conflict ? ' dshgit-marker-conflict' : ''}`;
              if (marker.className !== cls) marker.className = cls;
            }
          }
        };
        let frame = 0;
        const schedule = () => {
          if (frame !== 0) return;
          frame = requestAnimationFrame(() => { frame = 0; sync(); });
        };
        sync();
        const observer = new MutationObserver(schedule);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
          observer.disconnect();
          if (frame !== 0) cancelAnimationFrame(frame);
          for (const marker of document.querySelectorAll(`[${MARKER_ATTR}]`)) marker.remove();
        };
      }, [list, summary, t]);

      return null;
    }

    /* ------------------------------------------------------------------ */
    /* Styles (theme tokens only; artwork colours live in the SVG)         */
    /* ------------------------------------------------------------------ */

    const CSS_TEXT = `
.dshgit-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5}
.dshgit-header{box-sizing:border-box;display:flex;align-items:center;gap:2px;height:38px;flex:none;padding:0 6px 0 10px;border-bottom:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l1))}
.dshgit-spacer{flex:1 1 auto;min-width:4px}
.dshgit-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);min-width:0}
.dshgit-tool{display:inline-flex;align-items:center;justify-content:center;flex:none;width:26px;height:26px;padding:0;border:none;background:none;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshgit-tool:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dshgit-tool:disabled{opacity:.45;cursor:default}
.dshgit-tool:focus-visible,.dshgit-branch:focus-visible,.dshgit-row:focus-visible,.dshgit-primary:focus-visible,.dshgit-secondary:focus-visible,.dshgit-menu-item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dshgit-branch{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:60%;height:28px;padding:0 8px;border:none;background:none;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.dshgit-branch:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshgit-branch svg{flex:none;color:var(--dsw-alias-label-secondary)}
.dshgit-branch-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.dshgit-ab{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshgit-body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 4px 12px 8px;scrollbar-gutter:stable}
.dshgit-status-line{margin:0;padding:12px 14px;color:var(--dsw-alias-label-secondary)}
.dshgit-error-text{color:var(--dsw-alias-state-error-primary)}
.dshgit-commit{display:flex;flex-direction:column;gap:6px;padding:0 4px 10px 2px}
.dshgit-input{box-sizing:border-box;width:100%;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline:none}
.dshgit-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.dshgit-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dshgit-message{resize:vertical;min-height:52px;font-family:inherit}
.dshgit-amend{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none}
.dshgit-amend input{margin:0}
.dshgit-primary,.dshgit-secondary,.dshgit-danger{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:var(--dsw-radius-md,8px);font:inherit;font-weight:500;cursor:pointer}
.dshgit-primary{border:none;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff)}
.dshgit-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)))}
.dshgit-secondary{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dshgit-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshgit-danger{border:none;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dshgit-primary:disabled,.dshgit-secondary:disabled{opacity:.5;cursor:default}
.dshgit-inline{height:28px}
.dshgit-row{display:flex;align-items:center;gap:6px;min-width:0;height:26px;padding:0 6px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;user-select:none}
.dshgit-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgit-group+.dshgit-group{margin-top:6px}
.dshgit-group-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding-left:2px}
.dshgit-group-title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgit-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s}
.dshgit-chevron-open{transform:rotate(90deg)}
.dshgit-count{flex:none;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:18px;text-align:center}
.dshgit-list{list-style:none;margin:0;padding:0 0 0 18px}
.dshgit-file-item{margin:0;padding:0}
.dshgit-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgit-deleted{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}
.dshgit-dir{flex:0 10 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;direction:rtl;text-align:left}
.dshgit-actions{display:none;flex:none;align-items:center;gap:0}
.dshgit-actions .dshgit-tool{width:22px;height:22px}
.dshgit-row:hover .dshgit-actions,.dshgit-row:focus-within .dshgit-actions{display:inline-flex}
.dshgit-letter{flex:none;width:14px;text-align:center;font-size:12px;font-weight:600;font-family:var(--dsw-font-mono,ui-monospace,monospace)}
.dshgit-letter-mod{color:var(--dsw-alias-state-warn-primary)}
.dshgit-letter-add{color:var(--dsw-alias-state-success-primary)}
.dshgit-letter-del{color:var(--dsw-alias-state-error-primary)}
.dshgit-letter-ren{color:var(--dsw-alias-state-business-primary)}
.dshgit-row-selected,.dshgit-row-selected:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.dshgit-split{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.dshgit-split[data-diff="side"]{flex-direction:row}
.dshgit-split[data-diff="side"]>.dshgit-body{flex:0 0 var(--dshgit-list-width,320px);width:var(--dshgit-list-width,320px);min-width:200px}
.dshgit-split[data-diff="stacked"]>.dshgit-body{flex:0 1 45%;min-height:120px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshgit-splitter{flex:none;width:5px;margin:0 -2px;position:relative;z-index:2;cursor:col-resize}
.dshgit-splitter::after{content:"";position:absolute;top:0;bottom:0;left:2px;width:1px;background:var(--dsw-alias-border-l2);transition:background .12s}
.dshgit-splitter:hover::after{width:2px;left:1.5px;background:var(--dsw-alias-state-business-primary)}
.dshgit-diffpane{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
.dshgit-diffbar{box-sizing:border-box;display:flex;align-items:center;gap:4px;flex:none;height:36px;padding:0 6px 0 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshgit-diff-title{display:flex;align-items:baseline;gap:6px;min-width:0;overflow:hidden}
.dshgit-diff-title .dshgit-name{font-weight:500}
.dshgit-chip{flex:none;padding:0 6px;height:18px;line-height:18px;border-radius:9px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.dshgit-segs{display:inline-flex;flex:none;padding:2px;gap:2px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2);margin-right:4px}
.dshgit-seg{height:22px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshgit-seg:hover{color:var(--dsw-alias-label-primary)}
.dshgit-seg-on{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}
.dshgit-seg:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dshgit-tool-on{color:var(--dsw-alias-state-business-primary)}
.dshgit-diff-scroll{flex:1 1 auto;min-height:0;overflow:auto}
.dshgit-diff-note{padding:8px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshgit-diff-table{border-collapse:collapse;width:100%;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:18px}
.dshgit-diff-table td{padding:0;vertical-align:top}
.dshgit-diff-no{width:1%;min-width:36px;padding:0 8px 0 6px!important;text-align:right;color:var(--dsw-alias-label-tertiary);user-select:none;white-space:nowrap}
.dshgit-diff-sign{width:14px;text-align:center;user-select:none;color:var(--dsw-alias-label-tertiary)}
.dshgit-diff-code{white-space:pre;padding:0 12px 0 4px!important;color:var(--dsw-alias-label-primary);tab-size:4}
.dshgit-diff-unified .dshgit-diff-code{width:100%}
.dshgit-diff-add,.dshgit-cell-add{background:var(--dsw-alias-code-diff-added,color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent))}
.dshgit-diff-del,.dshgit-cell-del{background:var(--dsw-alias-code-diff-deleted,color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent))}
.dshgit-cell-empty{background:repeating-linear-gradient(-45deg,transparent 0 4px,color-mix(in srgb,var(--dsw-alias-label-tertiary) 9%,transparent) 4px 5px)}
.dshgit-diff-add .dshgit-inline,.dshgit-cell-add .dshgit-inline{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,transparent);color:inherit;border-radius:2px}
.dshgit-diff-del .dshgit-inline,.dshgit-cell-del .dshgit-inline{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent);color:inherit;border-radius:2px}
.dshgit-diff-hunk td{padding:2px 12px!important;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);white-space:pre;overflow:hidden;text-overflow:ellipsis}
.dshgit-diff-split{table-layout:fixed}
.dshgit-diff-split .dshgit-col-no{width:46px}
.dshgit-diff-split th{position:sticky;top:0;z-index:1;padding:4px 10px;text-align:left;font-weight:500;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-bottom:.5px solid var(--dsw-alias-border-l2);font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshgit-split-right{border-left:.5px solid var(--dsw-alias-border-l2)}
.dshgit-wrap .dshgit-diff-split .dshgit-diff-code{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all}
.dshgit-progress{position:relative;display:flex;align-items:center;gap:6px;flex:none;padding:4px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden}
.dshgit-progress-bar{position:absolute;left:0;top:0;height:2px;width:30%;background:var(--dsw-alias-state-business-primary);animation:dshgit-slide 1.1s ease-in-out infinite}
@keyframes dshgit-slide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
.dshgit-notice{display:flex;align-items:flex-start;gap:6px;flex:none;margin:6px 10px 0;padding:6px 8px;border-radius:var(--dsw-radius-md,8px);font-size:12px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2)}
.dshgit-notice-error{color:var(--dsw-alias-state-error-primary)}
.dshgit-notice-info{color:var(--dsw-alias-label-secondary)}
.dshgit-notice-text{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto}
.dshgit-notice-close{flex:none;border:none;background:none;color:inherit;cursor:pointer;font-size:14px;line-height:1;padding:0 2px}
.dshgit-picker{position:absolute;z-index:5;top:40px;left:8px;right:8px;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 8px 28px rgba(0,0,0,.18)}
.dshgit-menu{max-height:320px;overflow:auto;display:flex;flex-direction:column}
.dshgit-menu-heading{padding:6px 8px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dshgit-menu-item{display:flex;align-items:center;gap:8px;min-height:28px;padding:0 8px;border:none;background:none;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.dshgit-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshgit-menu-item svg{vertical-align:-3px}
.dshgit-menu-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgit-menu-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dshgit-menu-pad{display:inline-block;width:16px}
.dshgit-menu-create{color:var(--dsw-alias-state-business-primary)}
.dshgit-menu-note{padding:6px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshgit-confirm-backdrop{position:absolute;inset:0;z-index:6;display:flex;align-items:flex-start;justify-content:center;padding-top:80px;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.2))}
.dshgit-confirm{width:calc(100% - 32px);max-width:360px;padding:14px;border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:.5px solid var(--dsw-alias-border-l2);box-shadow:0 8px 28px rgba(0,0,0,.2)}
.dshgit-confirm-text{margin:0 0 12px;overflow-wrap:anywhere}
.dshgit-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.dshgit-title-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}
.dshgit-marker{display:inline-flex;align-items:center;gap:4px;flex:none;height:18px;padding:0 6px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:11px;font-weight:600;line-height:18px;pointer-events:auto;cursor:default}
.dshgit-marker-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.dshgit-marker-conflict{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:reduce){.dshgit-chevron{transition:none}.dshgit-progress-bar{animation:none;width:100%}}
`;

    /* ------------------------------------------------------------------ */
    /* Plugin                                                              */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-tree: dictionaries');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-plugin-css', 'dsh-git-tree');
          style.textContent = CSS_TEXT;
          document.head.append(style);
          return () => style.remove();
        }, 'dsh-git-tree: styles');
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('type.label'),
          guide: [{
            id: 'scm',
            order: 15,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: GuideGlyph,
          }],
        }), 'dsh-git-tree: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
        }, GitBody)), 'dsh-git-tree: tab body');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
        }, GitTitle)), 'dsh-git-tree: tab title');
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-git-tree.workspace-markers',
          order: 50,
          locale: NS,
        }, WorkspaceMarkers)), 'dsh-git-tree: workspace markers');
      },
    };
  },
});
