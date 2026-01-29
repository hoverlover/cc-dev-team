---
name: Release
description: Analyze commits since last release and publish with intelligent semantic version bumping.
---

# Release

Analyze all commits since the last version tag, determine the appropriate semantic version bump (major/minor/patch), and publish to npm.

## Version Bump Rules

Semantic versioning: `MAJOR.MINOR.PATCH`

| Change Type | Bump | Indicators |
|-------------|------|------------|
| **Breaking** | MAJOR | `BREAKING CHANGE:`, `!:` suffix, API removals, incompatible changes |
| **Feature** | MINOR | `feat:`, `feature:`, `add:`, new functionality, enhancements |
| **Bugfix** | PATCH | `fix:`, `bugfix:`, `patch:`, corrections, typos, small improvements |

The highest-impact change determines the bump (MAJOR > MINOR > PATCH).

## Instructions

### Step 1: Gather Release Context

Run these commands in parallel:

1. Get the last version tag:
   ```bash
   git describe --tags --abbrev=0
   ```

2. Get commits since last tag:
   ```bash
   git log $(git describe --tags --abbrev=0)..HEAD --oneline
   ```

3. Check npm login status:
   ```bash
   npm whoami 2>/dev/null || echo "NOT_LOGGED_IN"
   ```

### Step 2: Handle npm Authentication

If the user is not logged in to npm:

1. **Ask the user**: "You're not logged in to npm. Should I run `npm login`? This will open your browser for authentication."

2. If they approve, run:
   ```bash
   echo "" | npm login
   ```
   This auto-accepts the "Press ENTER to open browser" prompt.

3. Wait for the command to complete (user authenticates in browser).

4. Verify login succeeded:
   ```bash
   npm whoami
   ```

If login fails, stop and inform the user they need to authenticate manually.

### Step 3: Analyze Commits

For each commit since the last tag, classify it:

**Conventional Commit Patterns (primary):**
- `fix:`, `fix(scope):` → PATCH
- `feat:`, `feat(scope):` → MINOR
- `BREAKING CHANGE:` in body or `!:` → MAJOR
- `docs:`, `chore:`, `style:`, `refactor:`, `test:` → PATCH (maintenance)

**Content Analysis (for non-conventional commits):**
- Look at the commit message semantics
- "Add", "Implement", "Introduce" → likely MINOR
- "Fix", "Correct", "Repair", "Resolve" → likely PATCH
- "Remove", "Delete API", "Breaking" → likely MAJOR
- "Update", "Bump", "Improve" → likely PATCH
- Release commits ("Bump installer to...") → skip (don't count)

**When uncertain:** Default to PATCH unless the change clearly adds new functionality.

### Step 4: Present Analysis

Show the user:

```
Analyzing commits since vX.Y.Z...

Commit Analysis:
  [hash] [message] → [classification] ([bump type])
  [hash] [message] → [classification] ([bump type])
  ...

Summary:
  Breaking changes: N
  New features: N
  Bugfixes/maintenance: N

Highest impact: [MAJOR|MINOR|PATCH]
Proposed version: vX.Y.Z → vA.B.C

Proceed with release?
```

Wait for user confirmation before proceeding.

### Step 5: Execute Release

Run the release script with the determined bump type:

```bash
./scripts/release.sh [patch|minor|major]
```

The script handles:
- Version bumping in package.json files
- Git commit and tag creation
- Pushing to remote
- Publishing to npm

### Step 6: Report Results

After successful release, show:
- New version number
- npm package URL
- Git tag created

## Edge Cases

**No commits since last tag:**
- Inform user there's nothing to release
- Ask if they want to force a patch bump anyway

**All commits are release/chore commits:**
- Default to PATCH bump
- Note that only maintenance commits were found

**Mixed signals in a commit:**
- If a commit adds a feature but also fixes a bug, classify by primary intent
- When truly ambiguous, ask the user

## Safety Rules

- Always show analysis and get confirmation before releasing
- Never skip the npm login check
- If any step fails, stop and report the error
- Don't push or publish without explicit user approval
