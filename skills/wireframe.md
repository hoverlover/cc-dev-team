---
name: Wireframe Builder
description: Generate visual HTML wireframes with an interactive viewer and PNG captures for project documentation.
arguments:
  - name: subdirectory
    description: Subdirectory name for this wireframe set (e.g., "gh-42-user-auth", "onboarding-flow")
    required: true
---

**Purpose**
Generate a set of visual HTML wireframe pages, an interactive viewer with navigation, and PNG image captures. This skill produces assets only — it does not create plan files or decide how assets are used. The calling agent decides what to do with the output.

**Arguments**
- `$ARGUMENTS` — The subdirectory name under `./wireframes/` for this wireframe set. Use an identifier that ties to the feature context (issue number, feature name, etc.).

---

## Process Overview

1. Create directory structure
2. Write the shared design system CSS
3. Build individual wireframe pages (HTML)
4. Build the interactive viewer (index.html)
5. Capture PNG screenshots of each wireframe page
6. Report all created assets back to the calling agent

---

## Step 1: Create Directory Structure

Create the following structure in the current project root:

```
./wireframes/$ARGUMENTS/
  index.html              <- interactive viewer
  styles/
    wireframe.css         <- shared design system
  pages/
    <page-name>.html      <- one per wireframe
  images/
    <page-name>.png       <- one per wireframe (auto-captured)
  _capture.mjs            <- PNG capture script (uses Chrome headless, no extra deps)
```

Create all directories first, including `images/` (even though it starts empty).

---

## Step 2: Write Design System

Write the following CSS to `./wireframes/$ARGUMENTS/styles/wireframe.css`. Copy it exactly — this ensures visual consistency across all wireframe pages.

```css
/* Wireframe Design System */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --wf-bg: #F7F8FA;
  --wf-surface: #FFFFFF;
  --wf-surface-alt: #F0F2F5;
  --wf-border: #E2E5EA;
  --wf-border-strong: #CDD1D9;
  --wf-text: #2D3142;
  --wf-text-secondary: #6B7084;
  --wf-text-muted: #9A9EB1;
  --wf-accent: #5B7FFF;
  --wf-accent-hover: #4A6BE0;
  --wf-accent-light: #EEF1FF;
  --wf-success: #34C759;
  --wf-success-light: #E8F9ED;
  --wf-warning: #F5A623;
  --wf-warning-light: #FFF5E0;
  --wf-danger: #E5484D;
  --wf-danger-light: #FDECED;
  --wf-shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --wf-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
  --wf-shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --wf-shadow-lg: 0 12px 40px rgba(0,0,0,0.12);
  --wf-radius-sm: 4px;
  --wf-radius: 8px;
  --wf-radius-lg: 12px;
  --wf-radius-xl: 16px;
  --wf-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --wf-transition: 0.15s ease;
}

*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--wf-font);
  background: var(--wf-bg);
  color: var(--wf-text);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ── Typography ── */
h1 { font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
h2 { font-size: 22px; font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
h3 { font-size: 17px; font-weight: 600; line-height: 1.4; }
h4 { font-size: 14px; font-weight: 600; line-height: 1.4; }
p { color: var(--wf-text-secondary); line-height: 1.6; }
small { font-size: 12px; color: var(--wf-text-muted); }
.wf-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wf-text-muted);
}
a { color: var(--wf-accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Layout ── */
.wf-page { min-height: 100vh; display: flex; flex-direction: column; }
.wf-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; width: 100%; }
.wf-container-sm { max-width: 640px; margin: 0 auto; padding: 0 24px; width: 100%; }
.wf-container-md { max-width: 840px; margin: 0 auto; padding: 0 24px; width: 100%; }

.wf-row { display: flex; gap: 16px; }
.wf-row-tight { display: flex; gap: 8px; }
.wf-col { flex: 1; min-width: 0; }
.wf-stack { display: flex; flex-direction: column; gap: 12px; }
.wf-stack-tight { display: flex; flex-direction: column; gap: 6px; }
.wf-stack-loose { display: flex; flex-direction: column; gap: 20px; }
.wf-center { display: flex; align-items: center; justify-content: center; }
.wf-between { display: flex; align-items: center; justify-content: space-between; }
.wf-align-center { align-items: center; }
.wf-wrap { flex-wrap: wrap; }
.wf-grow { flex-grow: 1; }

.wf-grid { display: grid; gap: 16px; }
.wf-grid-2 { grid-template-columns: repeat(2, 1fr); }
.wf-grid-3 { grid-template-columns: repeat(3, 1fr); }
.wf-grid-4 { grid-template-columns: repeat(4, 1fr); }

/* ── App Layout (sidebar + content) ── */
.wf-app-layout { display: flex; min-height: 100vh; }
.wf-app-sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--wf-surface);
  border-right: 1px solid var(--wf-border);
  padding: 20px 0;
  display: flex;
  flex-direction: column;
}
.wf-app-content { flex: 1; min-width: 0; padding: 32px; }
.wf-sidebar-header { padding: 0 20px 16px; border-bottom: 1px solid var(--wf-border); margin-bottom: 8px; }
.wf-sidebar-section { padding: 8px 12px; }
.wf-sidebar-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--wf-text-muted); padding: 8px 20px 4px; }
.wf-sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
  color: var(--wf-text-secondary);
  font-size: 14px;
  border-radius: 6px;
  margin: 1px 8px;
  cursor: pointer;
  transition: all var(--wf-transition);
}
.wf-sidebar-item:hover { background: var(--wf-surface-alt); color: var(--wf-text); text-decoration: none; }
.wf-sidebar-item-active { background: var(--wf-accent-light); color: var(--wf-accent); font-weight: 500; }

/* ── Navbar ── */
.wf-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: var(--wf-surface);
  border-bottom: 1px solid var(--wf-border);
  flex-shrink: 0;
}
.wf-navbar-brand { font-size: 16px; font-weight: 700; color: var(--wf-text); display: flex; align-items: center; gap: 10px; }
.wf-navbar-nav { display: flex; align-items: center; gap: 4px; }
.wf-navbar-link {
  padding: 6px 14px;
  font-size: 14px;
  color: var(--wf-text-secondary);
  border-radius: 6px;
  transition: all var(--wf-transition);
}
.wf-navbar-link:hover { background: var(--wf-surface-alt); color: var(--wf-text); text-decoration: none; }
.wf-navbar-link-active { color: var(--wf-accent); font-weight: 500; }

/* ── Cards ── */
.wf-card {
  background: var(--wf-surface);
  border: 1px solid var(--wf-border);
  border-radius: var(--wf-radius-lg);
  padding: 24px;
  box-shadow: var(--wf-shadow-sm);
}
.wf-card-hover:hover { box-shadow: var(--wf-shadow-md); border-color: var(--wf-border-strong); cursor: pointer; }
.wf-card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.wf-card-flat { background: var(--wf-surface); border: 1px solid var(--wf-border); border-radius: var(--wf-radius); padding: 16px; }

/* ── Buttons ── */
.wf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 18px;
  border-radius: var(--wf-radius);
  font-size: 14px;
  font-weight: 500;
  font-family: var(--wf-font);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--wf-transition);
  white-space: nowrap;
}
.wf-btn-primary { background: var(--wf-accent); color: #fff; }
.wf-btn-primary:hover { background: var(--wf-accent-hover); }
.wf-btn-secondary { background: var(--wf-surface); border-color: var(--wf-border); color: var(--wf-text); }
.wf-btn-secondary:hover { background: var(--wf-surface-alt); border-color: var(--wf-border-strong); }
.wf-btn-ghost { background: transparent; color: var(--wf-accent); }
.wf-btn-ghost:hover { background: var(--wf-accent-light); }
.wf-btn-danger { background: var(--wf-danger); color: #fff; }
.wf-btn-danger:hover { background: #d13438; }
.wf-btn-sm { padding: 5px 12px; font-size: 13px; border-radius: var(--wf-radius-sm); }
.wf-btn-lg { padding: 12px 24px; font-size: 16px; }
.wf-btn-icon { padding: 8px; border-radius: var(--wf-radius); }
.wf-btn-block { width: 100%; }

/* ── Form Controls ── */
.wf-field { display: flex; flex-direction: column; gap: 6px; }
.wf-field label { font-size: 13px; font-weight: 500; color: var(--wf-text); }
.wf-input {
  width: 100%;
  padding: 9px 14px;
  border: 1px solid var(--wf-border);
  border-radius: var(--wf-radius);
  font-size: 14px;
  font-family: var(--wf-font);
  background: var(--wf-surface);
  color: var(--wf-text);
  outline: none;
  transition: all var(--wf-transition);
}
.wf-input:focus { border-color: var(--wf-accent); box-shadow: 0 0 0 3px var(--wf-accent-light); }
.wf-input::placeholder { color: var(--wf-text-muted); }
textarea.wf-input { min-height: 80px; resize: vertical; }
select.wf-input { appearance: none; background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236B7084' stroke-width='1.5' fill='none'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 36px; }
.wf-checkbox { display: flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.wf-hint { font-size: 12px; color: var(--wf-text-muted); }
.wf-input-error { border-color: var(--wf-danger); }
.wf-error-text { font-size: 12px; color: var(--wf-danger); }

/* ── Table ── */
.wf-table-wrap { overflow-x: auto; border: 1px solid var(--wf-border); border-radius: var(--wf-radius-lg); }
.wf-table { width: 100%; border-collapse: collapse; }
.wf-table th {
  padding: 10px 16px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wf-text-muted);
  background: var(--wf-surface-alt);
  border-bottom: 1px solid var(--wf-border);
}
.wf-table td { padding: 12px 16px; border-bottom: 1px solid var(--wf-border); }
.wf-table tr:last-child td { border-bottom: none; }
.wf-table tr:hover td { background: var(--wf-surface-alt); }

/* ── Avatar ── */
.wf-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--wf-accent-light); color: var(--wf-accent);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; flex-shrink: 0;
}
.wf-avatar-sm { width: 28px; height: 28px; font-size: 11px; }
.wf-avatar-lg { width: 48px; height: 48px; font-size: 18px; }
.wf-avatar-xl { width: 72px; height: 72px; font-size: 28px; }

/* ── Badges & Tags ── */
.wf-badge {
  display: inline-flex; align-items: center; padding: 2px 10px;
  border-radius: 12px; font-size: 12px; font-weight: 500;
}
.wf-badge-default { background: var(--wf-surface-alt); color: var(--wf-text-secondary); }
.wf-badge-primary { background: var(--wf-accent-light); color: var(--wf-accent); }
.wf-badge-success { background: var(--wf-success-light); color: var(--wf-success); }
.wf-badge-warning { background: var(--wf-warning-light); color: var(--wf-warning); }
.wf-badge-danger { background: var(--wf-danger-light); color: var(--wf-danger); }

/* ── Tabs ── */
.wf-tabs { display: flex; border-bottom: 1px solid var(--wf-border); gap: 0; }
.wf-tab {
  padding: 10px 18px; font-size: 14px; color: var(--wf-text-secondary);
  border-bottom: 2px solid transparent; cursor: pointer; transition: all var(--wf-transition);
}
.wf-tab:hover { color: var(--wf-text); }
.wf-tab-active { color: var(--wf-accent); border-bottom-color: var(--wf-accent); font-weight: 500; }

/* ── Modal ── */
.wf-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; backdrop-filter: blur(2px);
}
.wf-modal {
  background: var(--wf-surface); border-radius: var(--wf-radius-xl);
  padding: 28px; max-width: 520px; width: 90%;
  box-shadow: var(--wf-shadow-lg); max-height: 90vh; overflow-y: auto;
}
.wf-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.wf-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--wf-border); }

/* ── Breadcrumbs ── */
.wf-breadcrumbs { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--wf-text-muted); }
.wf-breadcrumbs a { color: var(--wf-text-secondary); }
.wf-breadcrumbs a:hover { color: var(--wf-accent); }
.wf-breadcrumbs-sep::before { content: '/'; margin: 0 2px; }

/* ── Placeholder / Empty States ── */
.wf-placeholder-img {
  background: var(--wf-surface-alt); border: 1px dashed var(--wf-border-strong);
  border-radius: var(--wf-radius); display: flex; align-items: center; justify-content: center;
  color: var(--wf-text-muted); font-size: 13px; min-height: 180px;
}
.wf-empty-state {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60px 24px; text-align: center; color: var(--wf-text-muted);
}
.wf-empty-state-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.4; }

/* ── Alerts ── */
.wf-alert {
  padding: 12px 16px; border-radius: var(--wf-radius); font-size: 14px;
  display: flex; align-items: flex-start; gap: 10px;
}
.wf-alert-info { background: var(--wf-accent-light); color: var(--wf-accent); }
.wf-alert-success { background: var(--wf-success-light); color: #1a7a33; }
.wf-alert-warning { background: var(--wf-warning-light); color: #946200; }
.wf-alert-danger { background: var(--wf-danger-light); color: var(--wf-danger); }

/* ── Tooltip (title-based for wireframes) ── */
[data-tooltip] { position: relative; cursor: help; }

/* ── Divider ── */
.wf-divider { border: none; border-top: 1px solid var(--wf-border); margin: 16px 0; }

/* ── Progress Bar ── */
.wf-progress { height: 6px; background: var(--wf-surface-alt); border-radius: 3px; overflow: hidden; }
.wf-progress-bar { height: 100%; background: var(--wf-accent); border-radius: 3px; transition: width 0.3s ease; }

/* ── Toggle Switch ── */
.wf-toggle {
  width: 44px; height: 24px; background: var(--wf-border-strong);
  border-radius: 12px; position: relative; cursor: pointer; transition: background var(--wf-transition);
}
.wf-toggle-active { background: var(--wf-accent); }
.wf-toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; background: #fff; border-radius: 50%;
  transition: transform var(--wf-transition); box-shadow: var(--wf-shadow-sm);
}
.wf-toggle-active::after { transform: translateX(20px); }

/* ── Skeleton Loaders ── */
.wf-skeleton {
  background: linear-gradient(90deg, var(--wf-surface-alt) 25%, #e8eaef 50%, var(--wf-surface-alt) 75%);
  background-size: 200% 100%; border-radius: var(--wf-radius-sm);
  animation: wf-shimmer 1.5s infinite;
}
@keyframes wf-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── Spacing Utilities ── */
.wf-mt-0 { margin-top: 0; } .wf-mt-1 { margin-top: 8px; } .wf-mt-2 { margin-top: 16px; } .wf-mt-3 { margin-top: 24px; } .wf-mt-4 { margin-top: 32px; } .wf-mt-5 { margin-top: 48px; }
.wf-mb-0 { margin-bottom: 0; } .wf-mb-1 { margin-bottom: 8px; } .wf-mb-2 { margin-bottom: 16px; } .wf-mb-3 { margin-bottom: 24px; } .wf-mb-4 { margin-bottom: 32px; }
.wf-ml-auto { margin-left: auto; }
.wf-p-0 { padding: 0; } .wf-p-1 { padding: 8px; } .wf-p-2 { padding: 16px; } .wf-p-3 { padding: 24px; } .wf-p-4 { padding: 32px; }
.wf-px-2 { padding-left: 16px; padding-right: 16px; }
.wf-py-2 { padding-top: 16px; padding-bottom: 16px; }
.wf-gap-1 { gap: 8px; } .wf-gap-2 { gap: 16px; } .wf-gap-3 { gap: 24px; }

/* ── Display Utilities ── */
.wf-hidden { display: none; }
.wf-block { display: block; }
.wf-inline { display: inline; }
.wf-text-center { text-align: center; }
.wf-text-right { text-align: right; }
.wf-text-muted { color: var(--wf-text-muted); }
.wf-text-accent { color: var(--wf-accent); }
.wf-text-danger { color: var(--wf-danger); }
.wf-text-success { color: var(--wf-success); }
.wf-font-medium { font-weight: 500; }
.wf-font-semibold { font-weight: 600; }
.wf-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-rounded { border-radius: var(--wf-radius); }
.wf-border { border: 1px solid var(--wf-border); }
.wf-full-width { width: 100%; }
```

---

## Step 3: Build Wireframe Pages

For each wireframe page, create an HTML file in `./wireframes/$ARGUMENTS/pages/`. Each page must be a self-contained HTML document that links to the shared design system.

**Page template:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAGE_TITLE — Wireframe</title>
  <link rel="stylesheet" href="../styles/wireframe.css">
  <style>
    /* Page-specific styles go here if needed */
  </style>
</head>
<body>
  <div class="wf-page">

    <!-- Build the wireframe layout here using the design system classes -->

  </div>
</body>
</html>
```

**Guidelines for building wireframe pages:**

- Use the design system classes (`wf-*`) for all components — do not invent custom styles unless absolutely necessary for a page-specific element.
- Keep content realistic but clearly placeholder: use real-sounding names, labels, and text. Avoid "Lorem ipsum" — use short, contextual placeholder text instead (e.g., "Monthly revenue report" not "Lorem ipsum dolor sit amet").
- For images, use `<div class="wf-placeholder-img">` with descriptive text inside (e.g., "Hero Banner 1400x400", "User Avatar", "Product Image").
- For icons, use simple text symbols or single emoji characters sparingly. Do NOT link to external icon libraries. Good alternatives: use text labels, CSS shapes, or Unicode symbols (e.g., &#9776; for menu, &#10005; for close, &#8592; for back arrow).
- Each wireframe page should represent a single screen or distinct component view.
- Make wireframe pages interactive where appropriate: functional tabs, hover states on buttons, expandable sections. Use minimal inline `<script>` tags for simple interactivity (e.g., tab switching, toggling visibility). This helps humans who review the wireframes in the viewer.
- Target viewport: 1280x800 (desktop). Design for this size primarily.

---

## Step 4: Build the Viewer

Create `./wireframes/$ARGUMENTS/index.html` — an interactive page with left navigation that loads wireframe pages in an iframe.

**Viewer template:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wireframes — FEATURE_NAME</title>
  <link rel="stylesheet" href="styles/wireframe.css">
  <style>
    html, body { height: 100%; overflow: hidden; }
    body { background: var(--wf-bg); }

    .viewer { display: flex; height: 100vh; }

    .viewer-sidebar {
      width: 260px; flex-shrink: 0; background: var(--wf-surface);
      border-right: 1px solid var(--wf-border); display: flex;
      flex-direction: column; overflow-y: auto;
    }
    .viewer-brand {
      padding: 20px 20px 16px; border-bottom: 1px solid var(--wf-border);
      font-size: 14px; font-weight: 700; color: var(--wf-text);
    }
    .viewer-brand small { display: block; font-size: 11px; font-weight: 500; color: var(--wf-text-muted); margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
    .viewer-nav { padding: 12px 8px; flex: 1; }
    .viewer-nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 16px; margin: 2px 0; border-radius: 8px;
      font-size: 14px; color: var(--wf-text-secondary); cursor: pointer;
      transition: all 0.15s ease; text-decoration: none; user-select: none;
    }
    .viewer-nav-item:hover { background: var(--wf-surface-alt); color: var(--wf-text); text-decoration: none; }
    .viewer-nav-item-active { background: var(--wf-accent-light); color: var(--wf-accent); font-weight: 500; }
    .viewer-nav-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--wf-border-strong); flex-shrink: 0;
    }
    .viewer-nav-item-active .viewer-nav-dot { background: var(--wf-accent); }

    .viewer-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .viewer-toolbar {
      height: 48px; padding: 0 20px; display: flex; align-items: center;
      justify-content: space-between; background: var(--wf-surface);
      border-bottom: 1px solid var(--wf-border); flex-shrink: 0;
    }
    .viewer-toolbar-title { font-size: 13px; font-weight: 500; color: var(--wf-text-secondary); }
    .viewer-viewport-btns { display: flex; gap: 4px; }
    .viewer-viewport-btn {
      padding: 4px 12px; font-size: 12px; font-weight: 500; border: 1px solid var(--wf-border);
      border-radius: 6px; background: var(--wf-surface); color: var(--wf-text-secondary);
      cursor: pointer; transition: all 0.15s ease; font-family: var(--wf-font);
    }
    .viewer-viewport-btn:hover { border-color: var(--wf-border-strong); color: var(--wf-text); }
    .viewer-viewport-btn-active { background: var(--wf-accent); border-color: var(--wf-accent); color: #fff; }

    .viewer-content {
      flex: 1; display: flex; align-items: flex-start; justify-content: center;
      padding: 24px; overflow: auto; background: var(--wf-bg);
    }
    .viewer-frame-wrap {
      background: var(--wf-surface); border-radius: 12px; box-shadow: var(--wf-shadow-md);
      overflow: hidden; transition: width 0.3s ease;
    }
    .viewer-frame-wrap iframe {
      display: block; width: 100%; height: 800px; border: none;
    }

    .viewer-footer {
      padding: 8px 20px; font-size: 11px; color: var(--wf-text-muted);
      border-top: 1px solid var(--wf-border); background: var(--wf-surface);
      text-align: center; flex-shrink: 0;
    }
  </style>
</head>
<body>
<div class="viewer">
  <aside class="viewer-sidebar">
    <div class="viewer-brand">
      FEATURE_NAME
      <small>Wireframes</small>
    </div>
    <nav class="viewer-nav" id="nav">
      <!-- NAV_ITEMS: one per wireframe page -->
      <!-- Example:
      <a class="viewer-nav-item viewer-nav-item-active" data-page="pages/login.html" onclick="loadPage(this)">
        <span class="viewer-nav-dot"></span> Login
      </a>
      <a class="viewer-nav-item" data-page="pages/dashboard.html" onclick="loadPage(this)">
        <span class="viewer-nav-dot"></span> Dashboard
      </a>
      -->
    </nav>
  </aside>

  <main class="viewer-main">
    <div class="viewer-toolbar">
      <span class="viewer-toolbar-title" id="currentPage">Select a wireframe</span>
      <div class="viewer-viewport-btns">
        <button class="viewer-viewport-btn viewer-viewport-btn-active" onclick="setViewport(1280, this)">Desktop</button>
        <button class="viewer-viewport-btn" onclick="setViewport(768, this)">Tablet</button>
        <button class="viewer-viewport-btn" onclick="setViewport(375, this)">Mobile</button>
      </div>
    </div>
    <div class="viewer-content">
      <div class="viewer-frame-wrap" id="frameWrap" style="width:100%; max-width:1280px;">
        <iframe id="frame" src="about:blank"></iframe>
      </div>
    </div>
    <div class="viewer-footer">Wireframe Viewer</div>
  </main>
</div>

<script>
  function loadPage(el) {
    document.querySelectorAll('.viewer-nav-item').forEach(n => n.classList.remove('viewer-nav-item-active'));
    el.classList.add('viewer-nav-item-active');
    const src = el.getAttribute('data-page');
    document.getElementById('frame').src = src;
    document.getElementById('currentPage').textContent = el.textContent.trim();
  }
  function setViewport(width, btn) {
    document.querySelectorAll('.viewer-viewport-btn').forEach(b => b.classList.remove('viewer-viewport-btn-active'));
    btn.classList.add('viewer-viewport-btn-active');
    const wrap = document.getElementById('frameWrap');
    wrap.style.maxWidth = width + 'px';
  }
  // Auto-load first page
  window.addEventListener('DOMContentLoaded', () => {
    const first = document.querySelector('.viewer-nav-item');
    if (first) loadPage(first);
  });
</script>
</body>
</html>
```

**Instructions for the viewer:**

- Replace `FEATURE_NAME` with a human-readable name for this wireframe set.
- Add one `<a class="viewer-nav-item" ...>` per wireframe page in the `#nav` element.
- Set the first nav item's class to include `viewer-nav-item-active`.
- The `data-page` attribute should point to the relative path (e.g., `pages/login.html`).

---

## Step 5: Capture PNG Screenshots

After all HTML wireframe pages and the viewer are created, capture a PNG screenshot of each wireframe page.

**IMPORTANT: Do NOT use the `claude-in-chrome` / `mcp__claude-in-chrome__*` browser automation tools for this step.** Those tools are for interactive browsing and cannot save screenshots to disk. Instead, write and run the capture script below, which uses Chrome's built-in headless CLI mode (or Playwright as a fallback). Just write the script and execute it with `node`.

Write the following capture script to `./wireframes/$ARGUMENTS/_capture.mjs`:

```javascript
import { readdir, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const VIEWPORT_W = 1280;
const VIEWPORT_H = 800;
const dir = new URL('.', import.meta.url).pathname;
const pagesDir = join(dir, 'pages');
const imagesDir = join(dir, 'images');

// ── Strategy 1: Chrome / Chromium headless CLI ──
function findChrome() {
  const candidates = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const found = execSync(
      'which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null || which chromium 2>/dev/null',
      { encoding: 'utf8' }
    ).trim();
    return found || null;
  } catch {
    return null;
  }
}

// ── Strategy 2: Playwright CLI ──
function findPlaywright() {
  try {
    return execSync('which playwright 2>/dev/null', { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

// ── Strategy 3: Puppeteer (via Node.js import) ──
async function findPuppeteer() {
  try {
    const mod = await import('puppeteer');
    return mod.default || mod;
  } catch { return null; }
}

// ── Detect best available strategy ──
const chrome = findChrome();
const playwright = !chrome ? findPlaywright() : null;
const puppeteer = (!chrome && !playwright) ? await findPuppeteer() : null;

let captureOne, strategyName, cleanup;

if (chrome) {
  strategyName = 'Chrome headless';
  captureOne = (filePath, imgPath) => {
    execSync(
      `"${chrome}" --headless=new --screenshot="${imgPath}" --window-size=${VIEWPORT_W},${VIEWPORT_H} --force-device-scale-factor=2 --hide-scrollbars --disable-gpu --no-sandbox "file://${filePath}"`,
      { stdio: 'pipe', timeout: 15000 }
    );
  };
} else if (playwright) {
  strategyName = 'Playwright CLI';
  captureOne = (filePath, imgPath) => {
    execSync(
      `"${playwright}" screenshot --viewport-size="${VIEWPORT_W},${VIEWPORT_H}" --full-page "file://${filePath}" "${imgPath}"`,
      { stdio: 'pipe', timeout: 15000 }
    );
  };
} else if (puppeteer) {
  strategyName = 'Puppeteer';
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 2 });
  cleanup = () => browser.close();
  captureOne = async (filePath, imgPath) => {
    await page.goto('file://' + filePath, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: imgPath, fullPage: true });
  };
} else {
  console.log('');
  console.log('PNG capture skipped — no screenshot tool found.');
  console.log('');
  console.log('HTML wireframes are still fully usable in the viewer.');
  console.log('To enable PNG image capture, install one of the following:');
  console.log('');
  console.log('  Option 1 (recommended): Install Google Chrome');
  console.log('    https://www.google.com/chrome/');
  console.log('');
  console.log('  Option 2: npm install -g puppeteer');
  console.log('');
  console.log('  Option 3: npm install -g playwright && npx playwright install chromium');
  console.log('');
  console.log('Then re-run: node _capture.mjs');
  process.exit(0);
}

console.log('Capture strategy: ' + strategyName);
await mkdir(imagesDir, { recursive: true });

const files = (await readdir(pagesDir)).filter(f => f.endsWith('.html'));
const captured = [];

for (const file of files) {
  const filePath = join(pagesDir, file);
  const imgName = basename(file, '.html') + '.png';
  const imgPath = join(imagesDir, imgName);

  try {
    await captureOne(filePath, imgPath);
    captured.push(imgName);
    console.log('Captured: ' + imgName);
  } catch (err) {
    console.error('Failed to capture ' + file + ': ' + err.message);
  }
}

if (cleanup) await cleanup();
console.log('Done. ' + captured.length + '/' + files.length + ' images captured to images/');
```

**After writing the script, run it:**

```bash
cd ./wireframes/$ARGUMENTS && node _capture.mjs
```

- The script auto-detects the best available tool in this order: Chrome headless → Playwright CLI → Puppeteer (Node.js import).
- If none are found, it exits gracefully with clear install instructions for the user.
- On success, PNGs are saved to `./wireframes/$ARGUMENTS/images/`.
- **Do NOT modify this script.** If it fails, report the error output to the user — do not attempt to rewrite it or use alternative tools.

---

## Step 6: Report Output

When all steps are complete, report the following to the calling agent or user:

1. **Viewer path**: `./wireframes/$ARGUMENTS/index.html` — open in browser to interactively browse wireframes
2. **Wireframe pages created**: list each page file with a brief description
3. **PNG images**: list each image path, or note if PNG capture was skipped
4. **Directory**: full path to `./wireframes/$ARGUMENTS/`

Format the report as a structured summary so the calling agent can decide how to use the assets (embed in plan files, hand off to dev agents, etc.).

**Example report:**

```
Wireframe assets created in ./wireframes/gh-42-user-auth/

Viewer:   ./wireframes/gh-42-user-auth/index.html

Pages:
  - pages/login.html         — Login screen with email/password and OAuth
  - pages/signup.html         — Registration form with validation states
  - pages/forgot-password.html — Password reset flow
  - pages/dashboard.html      — Post-login dashboard overview

Images:
  - images/login.png
  - images/signup.png
  - images/forgot-password.png
  - images/dashboard.png
```

---

## Design Principles

When deciding how to lay out wireframe pages, follow these principles:

- **Clarity over decoration**: Wireframes communicate structure, hierarchy, and flow. Every element should have a clear purpose.
- **Realistic content**: Use plausible placeholder content. "Jane Cooper" not "User 1". "$42.99" not "$XX.XX". "3 items in cart" not "N items".
- **Consistent spacing**: Use the spacing utilities (wf-mt-*, wf-p-*, wf-gap-*) consistently. 8px base unit.
- **Visual hierarchy**: Use font sizes, weights, and color (text vs text-secondary vs text-muted) to establish clear hierarchy.
- **Whitespace**: Don't overcrowd. Let sections breathe. When in doubt, add more space.
- **Component reuse**: Use the same component patterns across pages for consistency (same button styles, same card layouts, same form field patterns).
