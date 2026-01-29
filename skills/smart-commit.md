---
name: Smart Commit
description: Analyze uncommitted changes and create logical, atomic commits that group related changes together.
---

# Smart Commit

Analyze all uncommitted changes in the project and create logical, atomic commits that group related changes together. Each commit must be self-contained and leave the codebase in a compilable, working state.

This command supports **partial file commits** — when a single file contains changes for multiple features, it will split them into separate commits automatically.

## Instructions

### Step 1: Gather Information

Run these commands in parallel to understand the current state:

1. `git status` - See all modified, added, and untracked files
2. `git diff` - See unstaged changes
3. `git diff --cached` - See staged changes
4. `git log --oneline -10` - See recent commit style

### Step 2: Analyze Changes at Hunk Level

For each changed file, analyze the diff output to understand:

1. **Identify individual hunks**: Each `@@` marker in the diff starts a new hunk
2. **Classify each hunk's purpose**: What feature, fix, or change does this hunk implement?
3. **Group related hunks**: Hunks that implement the same feature belong together, even across files
4. **Detect mixed-purpose files**: Flag files where different hunks serve different purposes

When analyzing hunks, consider:
- Function/method being modified (hunks in the same function are often related)
- Variable names and imports being added/changed
- Comments that explain the change's purpose
- Proximity to other hunks (adjacent hunks are often related)

### Step 3: Plan Commit Groups

Group changes into logical commits based on:

1. **Feature cohesion**: Hunks that implement the same feature belong together
2. **Layer grouping**: Related changes across layers (types, utils, components, actions) for one feature
3. **Build integrity**: Each commit must compile successfully on its own
4. **Dependency order**: Commit dependencies before dependents (e.g., types before components that use them)

For files with mixed-purpose changes:
- Split the file's hunks across multiple commits
- Ensure each partial commit leaves the file in a valid state
- If hunks are interleaved and can't be cleanly separated, keep them together and note why

For each planned commit, verify:
- All imports will resolve (no missing dependencies)
- All types referenced are available
- The build would succeed at that point in history

### Step 4: Present Plan

Before committing, present the plan to the user showing:
- Number of commits to create
- For each commit:
  - Files included (mark partial files with "partial" indicator)
  - Hunks included for partial files (briefly describe what each hunk does)
  - Brief description of what the commit does
  - Why these changes are grouped together

**Automatic grouping**: If the purpose of each hunk is clear, present the plan directly.

**Ambiguous hunks**: If you cannot confidently determine which commit a hunk belongs to:
1. Show the hunk content
2. Explain your uncertainty
3. Ask the user which commit it should join

Ask for confirmation before proceeding.

### Step 5: Execute Commits

For each commit group, in order:

#### For whole-file commits:
1. Reset the staging area: `git reset HEAD`
2. Stage the files: `git add <files>`
3. Create the commit

#### For partial-file commits (specific hunks only):
1. Reset the staging area: `git reset HEAD`
2. Stage whole files that are fully included: `git add <whole-files>`
3. For partial files, use interactive patch mode:
   ```bash
   git diff <file> > /tmp/full.patch
   ```
4. Edit the patch to include only the relevant hunks, then apply:
   ```bash
   git apply --cached /tmp/partial.patch
   ```
5. Create the commit
6. Verify only the intended hunks were committed: `git show --stat HEAD`

**Alternative approach for partial staging** (simpler for small changes):
- Use `git add -p <file>` conceptually, but since this is interactive, instead:
- Stage the whole file, then unstage unwanted hunks:
  ```bash
  git add <file>
  git reset -p HEAD <file>  # Interactively unstage hunks
  ```
- Or create a precise patch file with only the desired hunks

### Patch File Format

When creating partial patches, ensure proper format:
```diff
diff --git a/path/to/file b/path/to/file
index abc123..def456 100644
--- a/path/to/file
+++ b/path/to/file
@@ -10,6 +10,8 @@ context line
 context
+added line
 context
```

Each hunk must:
- Have correct line numbers in the `@@` header
- Include 3 lines of context before and after (standard git diff)
- Be a complete, valid hunk that can apply cleanly

### Commit Message Guidelines

- Use imperative mood ("Add feature" not "Added feature")
- First line: concise summary (50 chars or less ideally)
- If needed, add blank line then detailed explanation
- Include `Co-Authored-By: Claude <noreply@anthropic.com>` at the end

### Safety Rules

- Never use `--force` or destructive git commands
- Never modify commits that have been pushed to remote
- If a planned commit would break the build, reorganize the groups
- If unsure about grouping, ask the user for guidance
- Do not push to remote unless explicitly requested
- When splitting hunks, verify each partial commit leaves valid code

### Example: Partial File Commit

**Scenario**: `user-service.ts` has two unrelated changes:
1. Lines 10-20: Bug fix for null check
2. Lines 45-60: New feature adding email validation

**Plan**:
```
Commit 1: "Fix null pointer in user lookup"
- src/services/user-service.ts (partial: lines 10-20 - null check fix)

Commit 2: "Add email validation to user service"
- src/services/user-service.ts (partial: lines 45-60 - validation logic)
- src/utils/validators.ts (whole file - new validation helpers)
```

**Execution**:
```bash
# Commit 1: Stage only the bug fix hunk
git diff src/services/user-service.ts | head -n 30 > /tmp/fix.patch
# (edit patch to keep only first hunk)
git apply --cached /tmp/fix.patch
git commit -m "Fix null pointer in user lookup"

# Commit 2: Stage the rest
git add src/services/user-service.ts src/utils/validators.ts
git commit -m "Add email validation to user service"
```

### Example Groupings (Whole Files)

**Good grouping** (single feature):
```
Commit 1: "Add user authentication types and utilities"
- src/types/auth.ts (new types)
- src/lib/auth/utils.ts (utilities using those types)

Commit 2: "Add login form component"
- src/components/auth/login-form.tsx (uses types from commit 1)
- src/components/auth/login-form.test.tsx (tests for the component)
```

**Bad grouping** (would break build):
```
Commit 1: "Add login form component"
- src/components/auth/login-form.tsx (FAILS - imports types that don't exist yet)

Commit 2: "Add auth types"
- src/types/auth.ts (too late - needed in commit 1)
```

## Output

After completing all commits, show:
1. Summary of commits created with their hashes
2. Note which commits included partial file staging
3. `git log --oneline` showing the new commits
4. Reminder that commits are local only (not pushed)
