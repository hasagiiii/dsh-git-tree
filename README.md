# dsh-git-tree

Git Source Control for the DeepSeek Harness Web UI.

## What it adds

- **Right sidebar → Git tab** (guide card "源代码管理 / Source Control"), modelled on VS Code's Source Control view:
  - Branch button in the header, which opens a picker to switch to a local or remote branch or to create a new branch. Shows ahead/behind counts.
  - Refresh, Pull, Push and Fetch toolbar buttons. Push publishes a branch without an upstream (`push -u origin HEAD`).
  - Commit message box. Ctrl/Cmd+Enter commits. "Amend last commit" checkbox. When nothing is staged, the button reads "Commit All Changes" and stages everything first.
  - "Sync Changes n↓ m↑" (pull, then push) when the branch is ahead of or behind its upstream, and "Publish Branch" when the branch has no upstream.
  - Merge Changes, Staged Changes and Changes groups, with per-file and per-group stage, unstage and discard, and Open File (also on double-click).
  - **Diff pane to the right of the change list.** Click a file to open it; ↑/↓ moves through files.
    - **Side by side** (default) or **Inline**, with intra-line highlighting of the changed span.
    - Whole-file context toggle, previous/next file, open, and close.
    - The divider can be dragged (double-click resets it). Below 560 px the pane stacks under the list instead.
    - The mode, whole-file setting and list width are remembered.
    - The selection follows a file when it is staged or unstaged.
  - Refreshes every 4 s while visible, on window focus, and after every action.
- **Left sidebar → workspace markers**: every workspace row whose directory is inside a Git work tree with uncommitted files gets an orange pill with the file count. It turns red when there are merge conflicts. Hover it to see the count and branch. Refreshes every 15 s, on focus, and after Git tab actions.

## How it works

- `index.js` (Host) registers one authenticated exact Fetch route, `POST /api/dsh-git-tree/op`, on `ctx.connection`. That route sits behind the shell's browser authentication and Host/Origin checks.
- `lib/git.js` runs your own `git` executable:
  - Reads use `GIT_OPTIONAL_LOCKS=0`.
  - Mutations are serialized per repository.
  - Paths must stay inside the repository.
- `client.js` (browser) registers the `dsh-git-tree` right-sidebar tab type and a `shell.overlay` entry that keeps the workspace markers attached to the rows.

Discard restores tracked files to their index version and deletes untracked files. It always asks for confirmation first.

## Development

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& 'D:\dsh\DeepSeek Harness.exe' --test --test-isolation=none test/git.test.mjs
```

The installed bundle links this folder. After you change the code, disable and re-enable `dsh-git-tree` in Plugins, or restart, then refresh the page.
