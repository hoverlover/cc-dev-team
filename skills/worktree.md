---
name: Git Worktree
description: Manage git worktrees for working on multiple features simultaneously.
---

**Purpose**
Manage git worktrees to work on multiple feature branches in parallel without context switching.

**Subcommands**

Parse the arguments to determine which action to take:

- `create <branch>` - Create a new worktree for a branch
- `list` - List all current worktrees
- `merge [branch]` - Merge a worktree branch into current branch and clean up
- `remove [path]` - Remove a worktree without merging

If no subcommand provided, ask which action to take.

---

## create

Create a new worktree for the specified branch.

**Steps:**
1. Get the branch name from arguments; if missing, ask for it
2. Get the repo name: `basename $(git rev-parse --show-toplevel)`
3. Create repo prefix: take first letter of each word (split on `-`), lowercase, max 3 chars
   - Example: `supplier-automation` → `sa`, `my-cool-project` → `mcp`
4. Pick a random adjective from: fuzzy, grumpy, sleepy, sneaky, spicy, wobbly, dizzy, bouncy, cranky, peppy
5. Pick a random animal from: otter, walrus, falcon, badger, koala, panda, squid, gecko, ferret, moose
6. Set worktree path: `~/.cc-dev-team/worktrees/<prefix>-<adjective>-<animal>`
   - Example: `~/.cc-dev-team/worktrees/sa-grumpy-walrus`
   - Create the `~/.cc-dev-team/worktrees` directory if it doesn't exist
7. Check if target directory exists - if so, inform user and stop
8. Check if branch exists with `git show-ref --verify refs/heads/<branch>`
   - If exists: `git worktree add <path> <branch>`
   - If not: `git worktree add -b <branch> <path>`
9. Copy local config files like .env* recursively from the source directory into the worktree
10. rm -rf .next in the worktree
11. Report success with the full path
12. **Immediately `cd` into the worktree** - do NOT wait for user confirmation, just change directory automatically

---

## list

Show all worktrees for the current repository.

**Steps:**
1. Run `git worktree list`
2. Display results in a readable format

---

## merge

Merge a worktree's branch into the current branch and clean up.

**Steps:**
1. If branch not specified, run `git worktree list` and ask which worktree to merge
2. Confirm the current branch is where user wants to merge INTO
3. Ask user to confirm: "Merge <branch> into <current-branch> and remove the worktree?"
4. If confirmed:
   - `git merge <branch>` - merge the branch
   - If merge succeeds:
     - Find the worktree path for that branch from `git worktree list`
     - `git worktree remove <path>` - remove the worktree
     - Ask if user also wants to delete the branch: `git branch -d <branch>`
   - If merge fails: inform user to resolve conflicts, don't remove worktree

---

## remove

Remove a worktree without merging.

**Steps:**
1. If path not specified, run `git worktree list` and ask which to remove
2. Confirm with user: "Remove worktree at <path>? (branch will be kept)"
3. If confirmed: `git worktree remove <path>`
4. Optionally ask if user wants to delete the branch too

---

**Tips**
- Worktrees share the same `.git` data, so commits are immediately visible across all worktrees
- Each worktree has its own working directory and index
- You can have different branches checked out in different worktrees simultaneously
