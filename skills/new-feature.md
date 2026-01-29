---
name: New Feature
description: Create a detailed user story with acceptance criteria as a GitHub issue tagged with "feature".
arguments:
  - name: description
    description: Initial description of the feature (optional starting point)
    required: false
---

**Purpose**
Guide the user through creating a comprehensive user story and submit it as a GitHub issue in the current repository with the "feature" label.

**Arguments**
- `$ARGUMENTS` - Optional initial description of the feature. Use this as a starting point to extract or infer details, reducing the number of questions needed.

---

## Workflow

### Step 0: Parse Initial Input

If the user provided arguments (`$ARGUMENTS`), analyze them to extract:
- A potential feature title
- User persona hints (who might benefit)
- Problem context
- Any acceptance criteria mentioned
- Technical context or constraints

Use this information to:
1. Pre-fill answers where the input is clear
2. Skip questions that are already answered
3. Confirm inferred details rather than asking from scratch

**Example:**
- Input: "Add a real-time inventory dashboard so warehouse managers can see stock levels"
- Extracted: Title likely "Real-time inventory dashboard", persona is "warehouse manager", outcome is "see stock levels"
- Questions to skip: Title, persona, outcome
- Questions to ask: Acceptance criteria, additional context

---

### Step 1: Verify GitHub CLI and Repository

Before asking questions, verify the environment:

1. Check that `gh` CLI is installed and authenticated: `gh auth status`
2. Verify we're in a git repository: `git rev-parse --is-inside-work-tree`
3. Get the repo info: `gh repo view --json nameWithOwner -q .nameWithOwner`
4. Check if the "feature" label exists: `gh label list --search "feature" --json name -q '.[].name'`
   - If it doesn't exist, create it: `gh label create feature --description "New feature or enhancement" --color "a2eeef"`

If any of these fail, inform the user and stop.

---

### Step 2: Gather Information

Use the AskUserQuestion tool to gather the following information. **Skip or confirm** any details that were already provided in the initial input. Only ask questions for missing information.

If the initial input was detailed, you might only need to:
- Confirm the extracted details are correct
- Ask for acceptance criteria (the most commonly missing piece)

**Required Information (ask only if not provided or unclear):**

1. **Feature Title**
   - Ask: "What is the title/name of this feature?"
   - This becomes the issue title

2. **User Persona**
   - Ask: "Who is the primary user that will benefit from this feature?"
   - Options could include: End User, Admin, Developer, Operations, or custom
   - Example: "As a warehouse manager..."

3. **Problem/Need**
   - Ask: "What problem does this solve or what need does it address?"
   - This explains the "why" behind the feature
   - Example: "I need to see real-time inventory levels..."

4. **Desired Outcome**
   - Ask: "What should the user be able to do once this feature is implemented?"
   - This completes the user story statement
   - Example: "...so that I can make informed restocking decisions"

5. **Acceptance Criteria**
   - Ask: "What are the acceptance criteria? (Enter each criterion on a new line, or describe them and I'll help format them)"
   - These define when the feature is "done"
   - Help the user write testable, specific criteria using Given/When/Then format if appropriate

**Optional Information:**

6. **Additional Context**
   - Ask: "Any additional context, constraints, or technical notes? (or skip)"
   - Screenshots, mockups, related issues, technical constraints, etc.

7. **Priority**
   - Ask: "What priority level would you assign?"
   - Options: High, Medium, Low
   - This can be added as a label if the repo uses priority labels

---

### Step 3: Format the User Story

Structure the issue body using this template:

```markdown
## User Story

**As a** [user persona],
**I want** [desired capability/feature],
**So that** [benefit/value].

## Problem Statement

[Problem/need description from Step 2]

## Acceptance Criteria

- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]
...

## Additional Context

[Any additional context, technical notes, or constraints]

---
*Created via new-feature skill*
```

---

### Step 4: Preview and Confirm

Before creating the issue:

1. Display a formatted preview of the issue to the user
2. Show the title, labels, and body
3. Ask: "Does this look good? Should I create this issue, or would you like to make changes?"
4. If changes requested, go back and update the relevant sections

---

### Step 5: Create the GitHub Issue

Once confirmed:

1. Create the issue using `gh issue create`:
   ```bash
   gh issue create --title "<title>" --body "<body>" --label "feature"
   ```
2. If priority was specified and the repo has priority labels, add that label too
3. Display the issue URL to the user
4. Offer to open the issue in the browser: `gh issue view <number> --web`

---

## Tips for Good User Stories

When helping the user, guide them toward:

- **Specific personas**: "warehouse manager" is better than "user"
- **Clear outcomes**: Focus on what they can DO, not how it's built
- **Testable criteria**: Each criterion should be verifiable
- **Independent scope**: The story should be deliverable on its own
- **Reasonable size**: If too large, suggest breaking into multiple stories

## Example Output

**Title:** Real-time inventory dashboard for warehouse managers

**Body:**
```markdown
## User Story

**As a** warehouse manager,
**I want** to view real-time inventory levels on a dashboard,
**So that** I can make informed restocking decisions without manually checking each SKU.

## Problem Statement

Currently, inventory levels are only visible by navigating to individual product pages. Warehouse managers need to check dozens of SKUs daily, which is time-consuming and error-prone. A centralized dashboard would save 2+ hours per day.

## Acceptance Criteria

- [ ] Dashboard displays all SKUs with current stock levels
- [ ] Stock levels update in real-time (within 30 seconds of changes)
- [ ] Items below reorder threshold are highlighted in red
- [ ] Dashboard can be filtered by product category
- [ ] Export functionality to download inventory report as CSV

## Additional Context

- Should integrate with existing Shopify inventory data
- Mobile-responsive design is required
- See mockup: [link]

---
*Created via new-feature skill*
```
