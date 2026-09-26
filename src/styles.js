/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

export const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Work+Sans:wght@400;500;600;700&display=swap');

/* Neutralizes the default Vite template's #root centering (max-width /
   margin: 0 auto / padding), which otherwise boxes this whole app into a
   fixed-width column regardless of anything set below. */
#root {
  max-width: none;
  margin: 0;
  padding: 0;
  text-align: left;
  width: 100%;
}

/* Theme variables live on :root (the <html> element), not scoped to
   .ledger-root — HouseholdGate.jsx renders its own UI (the floating
   Settings button, panel, and pre-household screens) as a DOM sibling
   of .ledger-root, not a descendant, so anything scoped to .ledger-root
   wouldn't be visible there. :root is visible everywhere. HouseholdGate
   owns the actual theme state and sets data-theme on <html> directly;
   this file only needs to read the resulting variables. */

:root {
  --heading: #1E241F;
  --bg: #F5F6F1;
  --panel: #FFFFFF;
  --ink: #1E241F;
  --ink-muted: #62685E;
  --border: #DAD9CC;
  --accent: #C2661E;
  --accent-hover: #9C4F15;
  --accent-button: #A8561A; --accent-button-hover: #8A4613; --on-accent: #FFFFFF; --on-danger: #FFFFFF;
  --accent-tint: #F7E9DC;
  --income: #3F7D5C;
  --expense: #AC4A2C;
  --warn-bg: #FBF1DA;
  --warn-border: #E3B558;
  --warn-ink: #8A5A15;
  --danger: #A6392B;
  --danger-tint-bg: #FBEAE6;
  --danger-tint-border: #E3A190;
  --subtle-bg: #F2F1E9;
  --chart-1: #3B5BA0;
  --chart-2: #3F7D5C;
  --chart-3: #AC4A2C;
  --chart-4: #8A5A15;
  --chart-5: #6B5B95;
  --chart-6: #2E8B8B;
  --chart-7: #9C4F6E;
  --chart-other: #8C8C86;
  --radius: 6px;
}

:root[data-theme="light-slate"] {
  --heading: #1C2430;
  --bg: #F3F5F8;
  --panel: #FFFFFF;
  --ink: #1C2430;
  --ink-muted: #5B6675;
  --border: #D6DCE3;
  --accent: #2B6CB0;
  --accent-hover: #1E5490;
  --accent-button: #2B6CB0; --accent-button-hover: #1E5490; --on-accent: #FFFFFF; --on-danger: #FFFFFF;
  --accent-tint: #E7EFF8;
  --income: #2F8F6F;
  --expense: #C1502F;
  --warn-bg: #FCF3D9;
  --warn-border: #DDAE3E;
  --warn-ink: #7A5A0D;
  --danger: #B0402E;
  --danger-tint-bg: #FBEAE6;
  --danger-tint-border: #E0AA98;
  --subtle-bg: #EDF0F4;
  --chart-1: #2B6CB0;
  --chart-2: #2F8F6F;
  --chart-3: #C1502F;
  --chart-4: #9C7A1E;
  --chart-5: #6857A0;
  --chart-6: #2593A0;
  --chart-7: #A84B78;
  --chart-other: #8890A0;
}

:root[data-theme="dark-midnight"] {
  --heading: #C8CDD8;
  --bg: #10131B;
  --panel: #1B2030;
  --ink: #E7E9F1;
  --ink-muted: #9BA3B5;
  --border: #2C3346;
  --accent: #7B9EE0;
  --accent-hover: #9AB6EA;
  --accent-button: #7B9EE0; --accent-button-hover: #9AB6EA; --on-accent: #10131B; --on-danger: #10131B;
  --accent-tint: #232A42;
  --income: #6FCB9A;
  --expense: #E2896A;
  --warn-bg: #3B301A;
  --warn-border: #C99A3E;
  --warn-ink: #EAC581;
  --danger: #E2685A;
  --danger-tint-bg: #3A2420;
  --danger-tint-border: #7A4038;
  --subtle-bg: #242A3D;
  --chart-1: #7B9EE0;
  --chart-2: #6FCB9A;
  --chart-3: #E2896A;
  --chart-4: #D9A94E;
  --chart-5: #A99AE0;
  --chart-6: #5FC4C4;
  --chart-7: #E08FB0;
  --chart-other: #7C879C;
}

.ledger-root {
  isolation: isolate;
  font-family: 'Work Sans', -apple-system, sans-serif;
  color: var(--ink);
  background: var(--bg);
  min-height: 100vh;
  font-variant-numeric: tabular-nums;
}

.ledger-root * { box-sizing: border-box; }

/* Safety net: form controls don't reliably inherit color/background from
   the page in every browser (this is exactly the "bright white input on
   a dark theme" bug) — every input/select/textarea/button gets an
   explicit theme-correct baseline here. Anything with a more specific
   rule elsewhere (e.g. .btn-primary's own background) still wins, since
   these are plain element selectors with low specificity. */
.ledger-root input, .ledger-root select, .ledger-root textarea, .ledger-root button {
  font-family: inherit;
  color: var(--ink);
}
.ledger-root input, .ledger-root select, .ledger-root textarea {
  background: var(--panel);
}

/* Headings get an explicit theme color (not just inherited), so no
   outside stylesheet (like leftover Vite template styles in index.css)
   can turn them dark on the dark theme. */
.ledger-root h1, .ledger-root h2, .ledger-root h3 {
  color: var(--heading);
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  margin: 0;
  letter-spacing: -0.01em;
}

.app-shell {
  display: grid;
  grid-template-columns: 216px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.sidebar-brand {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 19px;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  line-height: 1.25;
  word-break: break-word;
}

.sidebar-brand-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex-shrink: 0;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-muted);
  font-weight: 600;
  padding: 6px 10px 4px;
}
.sidebar-nav-label:first-child { padding-top: 2px; }

.sidebar-section-divider {
  border-top: 1px solid var(--border);
  margin: 12px 10px 4px;
}

.nav-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  padding: 8px 10px;
  border-radius: var(--radius);
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.nav-btn:hover { background: var(--subtle-bg); color: var(--ink); }
.nav-btn.active { background: var(--accent-tint); color: var(--accent); font-weight: 600; }

.sidebar-stats {
  margin-top: auto;
  border-top: 1px solid var(--border);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--ink-muted);
}

.sidebar-stats .stat-row { display: flex; justify-content: space-between; }
.sidebar-stats .stat-net { color: var(--ink); font-weight: 600; font-size: 14px; }

.main {
  padding: 28px 44px 60px;
  max-width: 1360px;
  width: 100%;
  min-width: 0;
}

.view-header {
  margin-bottom: 22px;
}

.view-header h1 { font-size: 24px; }
.view-header p { color: var(--ink-muted); margin: 6px 0 0; font-size: 14.5px; max-width: 60ch; }

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
}

.panel + .panel { margin-top: 16px; }

.btn {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* Filled buttons use each theme's button color and the text color that's
   readable on it (4.5:1 or better); ".ledger-root" makes these outrank the
   general form-control text color above. */
.ledger-root .btn-primary { background: var(--accent-button); color: var(--on-accent); }
.ledger-root .btn-primary:hover:not(:disabled) { background: var(--accent-button-hover); }

.btn-secondary { background: transparent; border-color: var(--border); color: var(--ink); }
.btn-secondary:hover:not(:disabled) { border-color: var(--ink-muted); }

.btn-danger { background: transparent; border-color: var(--danger); color: var(--danger); }
.ledger-root .btn-danger:hover:not(:disabled) { background: var(--danger); color: var(--on-danger); }

.btn-ghost { background: transparent; border: none; color: var(--ink-muted); padding: 6px 8px; }
.btn-ghost:hover { color: var(--ink); }

.btn-sm { padding: 5px 10px; font-size: 12.5px; }

.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.field label { font-size: 13px; font-weight: 600; color: var(--ink); }
.field .hint { font-size: 12px; color: var(--ink-muted); margin-top: 1px; }

.field input[type="text"],
.field input[type="date"],
.field input[type="number"],
.field select {
  font-family: inherit;
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--ink);
}
.field input:focus, .field select:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; max-width: 640px; }
.form-grid .field.span-2 { grid-column: 1 / -1; }

.radio-row { display: flex; gap: 16px; margin-bottom: 16px; }
.radio-option { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; flex-wrap: wrap; }

.budget-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.budget-row-label { font-size: 12.5px; color: var(--ink-muted); font-weight: 600; }
.budget-amount-input {
  width: 70px; font-family: inherit; font-size: 13px; padding: 5px 7px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--panel); color: var(--ink);
}
.budget-row select {
  font-family: inherit; font-size: 12.5px; padding: 5px 7px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); color: var(--ink);
}

.invert-note {
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: var(--radius);
  padding: 10px 12px;
  margin-bottom: 14px;
}
.invert-note .hint { color: var(--warn-ink); margin: 0; }
.invert-note .radio-option { color: var(--ink); }

.dropzone {
  border: 1.5px dashed var(--border);
  border-radius: var(--radius);
  padding: 34px 20px;
  text-align: center;
  color: var(--ink-muted);
  font-size: 14px;
  background: var(--subtle-bg);
}
.dropzone strong { color: var(--ink); }

.file-input-label {
  display: inline-block;
  margin-top: 12px;
}
.file-input-label input { display: none; }

.error-banner {
  background: var(--danger-tint-bg);
  border: 1px solid var(--danger-tint-border);
  color: var(--danger);
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13.5px;
  margin-bottom: 14px;
}

.sync-banner {
  background: var(--accent-tint);
  border: 1px solid var(--accent);
  color: var(--accent-hover);
  padding: 10px 14px;
  border-radius: var(--radius);
  font-size: 13.5px;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); margin-top: 6px; }
.preview-table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.preview-table th, .preview-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  text-align: left;
}
.preview-table th { background: var(--subtle-bg); color: var(--ink-muted); font-weight: 600; }

.summary-row { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 18px; }
.summary-stat .num { font-family: 'Fraunces', serif; font-size: 22px; font-weight: 500; }
.summary-stat .label { font-size: 12px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; }

.invalid-list { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); }
.invalid-row { padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 12.5px; display: flex; justify-content: space-between; gap: 10px; }
.invalid-row:last-child { border-bottom: none; }
.invalid-row .reason { color: var(--danger); }

.actions-row { display: flex; gap: 10px; margin-top: 18px; }

.filter-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.filter-bar select, .filter-bar input[type="text"] {
  font-family: inherit; font-size: 13.5px; padding: 7px 9px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--panel); color: var(--ink);
}
.filter-bar .checkbox-filter { display: flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--ink-muted); }

.tx-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.tx-table th {
  text-align: left; padding: 8px 10px; font-size: 11.5px; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-muted); border-bottom: 1px solid var(--border); font-weight: 600;
}
.th-sort-btn {
  font-family: inherit; font-size: 11.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-muted); background: none; border: none; padding: 0;
  cursor: pointer;
}
.th-sort-btn:hover { color: var(--ink); }
.tx-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.tx-table tr:last-child td { border-bottom: none; }
.tx-table select {
  font-family: inherit;
  font-size: 12.5px;
  padding: 5px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--ink);
  max-width: 150px;
}
.category-cell { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.category-select.suggested {
  border: 1px dashed var(--accent);
  background: var(--accent-tint);
  color: var(--accent);
  font-style: italic;
}
.suggested-confirm-btn {
  border: 1px solid var(--accent);
  color: var(--accent);
  background: none;
  border-radius: var(--radius);
  font-size: 10.5px;
  padding: 3px 6px;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}
.suggested-confirm-btn:hover { background: var(--accent-tint); }
.tx-table td.desc-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tx-table .muted-cell { color: var(--ink-muted); }
.money-in { color: var(--income); font-weight: 600; }
.money-out { color: var(--expense); font-weight: 600; }

.toggle-group { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 4px; }
.toggle-btn {
  padding: 7px 16px; font-family: inherit; font-size: 13px; font-weight: 600;
  border: none; background: var(--panel); color: var(--ink-muted); cursor: pointer;
}
.ledger-root .toggle-btn.active { background: var(--accent-button); color: var(--on-accent); }
.toggle-btn + .toggle-btn { border-left: 1px solid var(--border); }

.chart-card { padding: 18px 20px 8px; }
.chart-wrap { width: 100%; height: 280px; margin-top: 6px; }

.pivot-table { border-collapse: collapse; font-size: 13px; white-space: nowrap; width: 100%; }

.dual-scroll-top { overflow-x: auto; overflow-y: hidden; height: 16px; border-bottom: 1px solid var(--border); }
.pivot-table th, .pivot-table td { padding: 8px 14px; text-align: right; border-bottom: 1px solid var(--border); }
.pivot-table th:first-child, .pivot-table td:first-child {
  text-align: left; position: sticky; left: 0; background: var(--panel); z-index: 1;
}
.pivot-table thead th {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--ink-muted); font-weight: 600; border-bottom: 2px solid var(--border);
}
.pivot-table tfoot td { border-top: 2px solid var(--border); border-bottom: none; background: var(--subtle-bg); font-weight: 700; }
.pivot-table tbody tr:last-child td { border-bottom: none; }
.pivot-row-label { font-weight: 500; }
.pivot-row-budget { font-weight: 400; font-size: 12px; color: var(--ink-muted); margin-top: 2px; }
.pivot-total-col { font-weight: 600; }

.excluded-note {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--ink-muted); margin-top: 12px; padding: 10px 14px;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--subtle-bg);
}

.budget-card-grid { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 22px; }
.budget-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px 16px; flex: 1 1 230px; max-width: 280px;
}
.budget-card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 8px; }
.budget-card-name { font-weight: 600; font-size: 14px; }
.budget-card-period { font-size: 10.5px; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
.budget-bar-track { height: 8px; border-radius: 999px; background: var(--subtle-bg); overflow: hidden; margin-bottom: 8px; }
.budget-bar-fill { height: 100%; border-radius: 999px; transition: width 0.2s ease; }
.budget-card-figures { font-size: 13px; }
.budget-card-figures .muted-cell { font-size: 12.5px; }

.budget-group-tag {
  display: inline-block; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--accent); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 5px; margin-left: 6px;
  vertical-align: middle;
}

.group-chip {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px;
  padding: 4px 6px 4px 10px; border-radius: 999px; background: var(--subtle-bg); border: 1px solid var(--border);
}
.group-chip-remove {
  border: none; background: none; cursor: pointer; color: var(--ink-muted); font-size: 14px; line-height: 1; padding: 2px;
}
.group-chip-remove:hover { color: var(--danger); }

.badge {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600;
  padding: 2px 7px; border-radius: 999px; border: 1px solid var(--warn-border);
  background: var(--warn-bg); color: var(--warn-ink); cursor: pointer;
}

.dup-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.dup-cell .btn-ghost { padding: 0; font-size: 11px; color: var(--ink-muted); }

.dup-detail-row td { background: var(--subtle-bg); padding: 10px 14px; }
.dup-detail-title { font-size: 12px; font-weight: 600; color: var(--warn-ink); margin-bottom: 6px; }
.dup-detail-item { font-size: 12.5px; color: var(--ink-muted); padding: 3px 0; }

.row-actions { display: flex; gap: 6px; }
.row-actions input[type="text"] {
  font-family: inherit;
  font-size: 14px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.confirm-inline { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--danger); }

.empty-state {
  text-align: center; padding: 50px 20px; color: var(--ink-muted);
}
.empty-state h2 { color: var(--heading); font-size: 19px; margin-bottom: 8px; }
.empty-state-star { width: 56px; height: 56px; margin-bottom: 14px; }
.inline-star { width: 18px; height: 18px; flex-shrink: 0; }
.empty-state p { max-width: 42ch; margin: 0 auto 18px; font-size: 14px; }

.toast {
  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
  /* Deliberately not var(--ink) — that flips to a LIGHT color in dark
     themes, which would make this white text disappear. A toast reads
     fine as a fixed dark chip regardless of the overall theme. */
  background: #262B28; color: #fff; padding: 10px 18px; border-radius: var(--radius);
  font-size: 13.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.18); z-index: 40;
}

.account-card { display: flex; justify-content: space-between; align-items: center; padding: 14px 4px; border-bottom: 1px solid var(--border); }
.account-card:last-child { border-bottom: none; }
.account-card > .account-name-block { flex: 1 1 auto; min-width: 0; }
.account-card .name { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.account-card .meta { font-size: 12.5px; color: var(--ink-muted); margin-top: 2px; }
.account-card .figures { text-align: right; margin-right: 18px; min-width: 150px; flex-shrink: 0; }
.account-card .figures .net { font-family: 'Fraunces', serif; font-size: 17px; }

.account-card-wrap { border-bottom: 1px solid var(--border); }
.account-card-wrap:last-child { border-bottom: none; }
.account-card-wrap .account-card { border-bottom: none; }
.account-settings-panel {
  padding: 4px 4px 18px;
  border-top: 1px dashed var(--border);
  margin-top: -2px;
}
.account-settings-panel .form-grid { margin-top: 12px; }

.step-track { display: flex; gap: 8px; margin-bottom: 20px; font-size: 12.5px; color: var(--ink-muted); }
.step-track .step.current { color: var(--accent); font-weight: 600; }

.loading-screen {
  display: flex; align-items: center; justify-content: center; min-height: 100vh; color: var(--ink-muted); font-size: 14px;
}

/* Center the background ring on the content area, to the right of the
   216px sidebar. On phones the sidebar is hidden, so it centers on the
   screen (see the mobile rules below). */
.coinrose-bg-ring.beside-sidebar { left: calc(216px + (100vw - 216px) / 2); }

/* Tutorial: a dialog card near the bottom of the screen with a light
   dimming layer, so the page it's describing stays visible behind it. */
.tutorial-scrim {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(0, 0, 0, 0.28);
}
.tutorial-card {
  position: fixed;
  bottom: 24px;
  left: calc(216px + (100vw - 216px) / 2);
  transform: translateX(-50%);
  width: min(480px, calc(100vw - 32px));
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px 20px 16px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
  font-family: 'Work Sans', -apple-system, sans-serif;
  box-sizing: border-box;
}
.tutorial-top { display: flex; justify-content: space-between; align-items: baseline; }
.tutorial-count { font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-muted); }
.tutorial-card .tutorial-skip {
  background: none; border: none; padding: 0; font-family: inherit; font-size: 12.5px;
  font-weight: 600; color: var(--ink-muted); cursor: pointer; text-decoration: underline;
}
.tutorial-progress { height: 4px; border-radius: 999px; background: var(--subtle-bg); overflow: hidden; margin: 10px 0 14px; }
.tutorial-progress-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.2s ease; }
.tutorial-card .tutorial-title {
  font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 20px;
  letter-spacing: -0.01em; color: var(--heading); margin: 0 0 8px;
}
.tutorial-body { font-size: 14px; line-height: 1.6; color: var(--ink-muted); margin: 0 0 16px; }
.tutorial-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tutorial-card .tutorial-btn {
  font-family: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 14px;
  border-radius: var(--radius); cursor: pointer;
}
.tutorial-card .tutorial-btn-primary { background: var(--accent-button); color: var(--on-accent); border: 1px solid var(--accent-button); }
.tutorial-card .tutorial-btn-primary:hover { background: var(--accent-button-hover); }
.tutorial-card .tutorial-btn-secondary { background: var(--panel); color: var(--ink); border: 1px solid var(--border); }

.mobile-topbar { display: none; }
.sidebar-backdrop { display: none; }
.mobile-expand-toggle { display: none; }
/* The one-line transaction summary row is only for phones; desktop shows
   just the full row. */
.tx-table tr.tx-row-compact { display: none; }

@media (max-width: 760px) {
  .app-shell { grid-template-columns: 1fr; }

  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .mobile-topbar h2 { margin: 0; font-size: 16px; font-family: 'Fraunces', serif; color: var(--heading); flex: 1; }
  .mobile-topbar-logo { width: 28px; height: 28px; object-fit: contain; flex-shrink: 0; }
  .hamburger-btn {
    background: none; border: 1px solid var(--border); border-radius: var(--radius);
    padding: 7px 9px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; width: 32px;
  }
  .hamburger-btn span { display: block; height: 2px; background: var(--ink); border-radius: 2px; }

  /* The sidebar becomes an off-canvas drawer — sliding over the content
     instead of squeezing into a horizontal strip, so it can show the
     same full vertical nav (sections, dividers, all of it) as desktop
     rather than needing its own cut-down mobile-only layout. */
  .sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: 270px;
    max-width: 82vw;
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    z-index: 210;
    overflow-y: auto;
    box-shadow: 4px 0 24px rgba(0,0,0,0.25);
  }
  .sidebar.mobile-open { transform: translateX(0); }

  .sidebar-backdrop.visible {
    display: block;
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 200;
  }

  .main { padding: 18px 14px 50px; }
  .form-grid { grid-template-columns: 1fr; }

  /* Toggle groups (period selector, chart type, etc.) — let buttons wrap
     onto multiple rows instead of forcing a row wider than the screen. */
  .toggle-group { display: flex; flex-wrap: wrap; width: 100%; }
  .toggle-group .toggle-btn { flex: 1 1 auto; }

  /* Overview's two-column layout collapses to one. */
  .overview-grid { grid-template-columns: 1fr !important; }

  /* The pivot-style tables (Reports' category table, Budget's history
     tables) pin their first column so it stays visible while the amount
     columns scroll sideways. On phones that pinned name column gets a
     fixed width of about a third of the screen: as a floor, so the
     amounts scroll instead of squeezing it, and as a ceiling, so a long
     name can't take over the screen. Names wrap only between words
     (overflow-wrap, unlike word-break, never splits a word that fits);
     a single word too long for the column is the only thing that breaks. */
  .pivot-table th, .pivot-table td { padding: 7px 10px; font-size: 12.5px; }
  .pivot-table thead th { font-size: 10.5px; }
  .pivot-table th:first-child, .pivot-table td:first-child {
    width: 34vw;
    min-width: 34vw;
    max-width: 34vw;
    white-space: normal;
    overflow-wrap: break-word;
    line-height: 1.3;
  }

  /* Budget progress cards use the full width on phones instead of
     stopping at their desktop maximum and leaving an empty strip. */
  .budget-card { max-width: none; flex-basis: 100%; }

  .coinrose-bg-ring.beside-sidebar { left: 50%; }
  .tutorial-card { left: 50%; bottom: 16px; }

  /* Account and category rows: stack instead of squeezing into one line */
  .account-card { flex-direction: column; align-items: flex-start; gap: 10px; }
  .account-card .figures { text-align: left; margin-right: 0; }
  .account-card .row-actions { flex-wrap: wrap; }

  /* Category cards collapse to just a name and count by default — the
     exclude/income checkboxes and the merge/delete actions only take
     space once the chevron is tapped. */
  .category-card-info { width: 100%; }
  .category-card .category-extra { display: none; }
  .category-card .category-extra.mobile-expanded { display: block; }
  .category-card .category-actions { display: none; }
  .category-card .category-actions.mobile-expanded { display: flex; margin-top: 10px; }

  /* Transactions table -> stacked cards. Each <td> becomes its own line,
     labeled via the data-label attribute set in TransactionRow, instead
     of scrolling a wide table sideways on a narrow screen. */
  .tx-table thead { display: none; }
  .tx-table, .tx-table tbody, .tx-table tr, .tx-table td { display: block; width: 100%; }
  .tx-table tr {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .tx-table td { border-bottom: none; padding: 5px 0; }
  .tx-table td[data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-muted);
    margin-bottom: 2px;
  }
  .tx-table td.no-label-cell:empty { display: none; }
  .tx-table td.desc-cell { max-width: none; white-space: normal; }
  .tx-table td input[type="text"], .tx-table td input[type="date"] { width: 100% !important; box-sizing: border-box; }
  .tx-table select { max-width: none; width: 100%; box-sizing: border-box; }
  .dup-detail-row td { padding: 10px 12px !important; }

  /* Collapsed-by-default transaction rows: a compact one-line summary is
     always visible; the existing, fully-detailed row (unchanged from
     desktop — same editing, same category picker) is hidden until the
     chevron is tapped, so nothing about how a transaction is edited has
     to be built or maintained twice. */
  .tx-table tr.tx-row-compact { display: block; padding: 10px 12px; cursor: pointer; }
  .tx-table tr.tx-row-full { display: none; }
  .tx-table tr.tx-row-full.mobile-expanded { display: block; margin-top: -10px; }
  .tx-table tr.tx-row-compact td { padding: 0; border-bottom: none; }
  .tx-compact-line { display: flex; align-items: center; gap: 8px; }
  .tx-compact-date { font-size: 11.5px; color: var(--ink-muted); flex-shrink: 0; white-space: nowrap; }
  .tx-compact-desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; }
  .tx-compact-amount { flex-shrink: 0; font-weight: 600; font-size: 13.5px; }
  .tx-compact-subline { margin-top: 3px; font-size: 11.5px; color: var(--ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-compact-suggested { color: var(--accent); font-style: italic; }
  .mobile-expand-toggle {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--panel);
    color: var(--ink-muted);
    font-size: 10px;
    padding: 0;
    cursor: pointer;
  }
}
`;
