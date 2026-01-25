# Present Plan Skill

Present an implementation plan to the user for approval.

## Arguments
- `path`: The path to the plan file (e.g., `.claude/plans/42-feature-name.md`)

## Instructions

1. **Read the plan file** at the path provided in the arguments using the Read tool
2. **Present the plan** to the user with clear formatting:
   - Show the full plan contents
   - Highlight key sections (requirements, approach, test strategy)
3. **Ask for explicit approval:**

```
## Implementation Plan Ready for Review

[Display the plan contents here]

---

**Please review this implementation plan.**

Do you approve this plan for implementation?
- Reply "approved" or "yes" to proceed
- Or describe any changes you'd like made
```

4. **Wait for user response:**
   - If approved: Send task assignment to Engineer via `send-msg`
   - If changes requested: Update the plan file and present again

**CRITICAL REMINDER:** You are the PM. After approval, you MUST delegate implementation to the Engineer using:
```bash
send-msg pm engineer TASK_ASSIGNMENT "Story #[number]: [title]. Implementation plan is at [plan-path]. Read the plan and implement it."
```

You do NOT implement anything yourself. Ever.
