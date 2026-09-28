# Coinrose

A household budgeting app for real financial life: irregular pay schedules, shared accounts, savings goals, and the occasional messy bank export.

**Live app:** https://coinrose.io

---

## What is Coinrose?

Coinrose brings a household's accounts together in one place. Upload statements from your bank and card websites, categorize what matters, set budgets that match how you're actually paid, and share it all with the people you live with.

Coinrose never connects to your bank and never asks for bank logins. You upload statement files yourself, and only the columns you choose (date, description, amounts) are kept.

## Features

### Ledger and transactions
- Upload CSV or Excel statements from any bank or card. A column-mapping step guesses the file's layout, and handles separate money-in and money-out columns or a single signed amount, with optional sign inversion.
- Only the mapped columns are stored; everything else in the bank's file (account numbers, memos, balances) is discarded before saving.
- Duplicate detection by date, amount, and direction, with a way to dismiss false alarms.
- Categories filled in automatically on import, learned from how you've categorized similar transactions before. They count right away and are marked Suggested until someone confirms or changes them; a household setting turns this off. Coinrose learns only from confirmed categories.
- An explicit account choice when uploading: files are matched to an account only when the match is unambiguous (by file name or columns), with a warning if the file's columns don't fit the chosen account.
- Filters by account, category, date range, uncategorized status, or a recent upload, plus search.
- A dedicated screen for categorizing exactly what you just imported.

### Categories
- Add, rename, merge, and delete categories; names must be unique (ignoring capitalization).
- Mark categories as income, or exclude them (for example, transfers between your own accounts).

### Budgeting
- **Spend** budgets: a limit that resets each period.
- **Accumulate** budgets: save toward a goal over time, with a running fund balance and manual adjustments.
- **Budget Groups**: several categories sharing one budget.
- Planned income versus what's assigned, with visibility into spending no budget covers.

### Reports
- Weekly, monthly, every-X-days, or twice-a-month periods, to match how you're paid.
- Bar or donut charts, a full category-by-period table, and one-click hiding of big steady categories.

### Overview
- This period's money in and out, what needs attention, and top spending, with links into the details.

### Households
- Sign in with an emailed link or a password.
- Create a household, or join one with an invite code. **Owners** approve join requests (choosing whether the new person is an owner or a member), change roles, remove people, and rename the household. Every household keeps at least one owner.
- Someone who leaves or is removed keeps a copy of the household's data up to that point, unless an owner removes them without one.
- **Data History:** save points from the last 7 days; restoring one undoes everything after it, and the restore can itself be undone.
- Full account deletion from Settings.

### Backup and restore
- Export the ledger or the budget setup as CSV files; restore either one. Exported cells that could run as spreadsheet formulas are neutralized, and restored exactly.

### Appearance and accessibility
- Three themes (Slate, Natural, and Midnight), a hideable sidebar on desktop, and a phone layout with a menu drawer.
- Audited against WCAG 2.2 AA with axe-core across every page and theme, with keyboard navigation checked by hand.
- A guided tour for first-time users, replayable from Settings.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite |
| Database and sign-in | Supabase (Postgres, Auth, Row-Level Security) |
| Charts | Recharts |
| File parsing | PapaParse (CSV), SheetJS (Excel) |
| Email | Resend (sign-in and password emails, through Supabase) |
| Bot protection | Cloudflare Turnstile |
| Crash reporting | Sentry |
| Hosting | Vercel |
| Fonts | Archivo and IBM Plex Sans, self-hosted (SIL Open Font License) |
| Tests | Vitest, React Testing Library |

## Project structure

```
src/
  main.jsx              Entry point: crash screen > sign-in > disclosure notice > household > app
  App.jsx               The app shell: loading, saving, syncing, navigation, the tour
  authGate.jsx          Sign-in, password reset, and Turnstile
  disclosureGate.jsx    The one-time "Before you get started" notice
  householdGate.jsx     Household setup, Settings, roles, themes, Data History, account deletion
  ledgerStore.js        Reads and writes the database tables; works out what changed
  monitoring.jsx        Sentry setup and the crash screen
  styles.js             The app's stylesheet
  constants.js          Page titles and chart colors
  views/                One file per page (Overview, Transactions, Reports, Budget, ...)
  components/           Shared pieces (the tutorial dialog, empty states, ...)
  lib/                  Logic with no user interface: budgets, periods, importing,
                        backups, duplicate detection, crash-report privacy, ...
  __tests__/            Screen and app tests (logic tests live in lib/__tests__/)
public/
  fonts/                Self-hosted fonts and their licenses
  privacy.html          Privacy Policy
  terms.html            Terms of Use
vercel.json             Security headers (including the Content Security Policy)
vitest.config.js        Test setup and coverage minimums
```

## How data is stored

Each household's data lives in ordinary database tables (`accounts`, `categories`, `budget_groups`, `budget_group_categories`, `transactions`, `household_settings`), scoped to the household by Row-Level Security.

- **Saving sends only what changed.** The app compares what it has with what was last saved and sends just the changed rows, through one database function that checks the caller belongs to the household. A save can't overwrite someone else's changes to other rows.
- **Syncing is cheap.** Every save bumps the household's change counter; the app checks that one number every 45 seconds and offers to sync when someone else has saved.
- **Data History** is built from save points: the first change to each row within a 5-minute window records how the row looked before, and save points are kept for 7 days.

## Security

- Row-Level Security on every table. Members can only read their own household's data, and every change goes through a database function that checks membership (and, where needed, ownership) first.
- A strict Content Security Policy and other security headers, set in `vercel.json`.
- Cloudflare Turnstile on sign-in, password-reset, and sign-in-link requests.
- Only mapped statement columns are stored. No bank credentials, ever.
- Crash reports are scrubbed before sending: no personal information, no clicks or console output, no query strings, and email addresses and long digit runs are redacted.

## Getting started

### Prerequisites
- Node.js 20 or newer
- A [Supabase](https://supabase.com) project
- A [Resend](https://resend.com) account (or another SMTP provider)
- Optional: a [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) widget and a [Sentry](https://sentry.io) project

### 1. Install

```bash
git clone https://github.com/morgankfinances/BudgetApp.git
cd BudgetApp        # then into the folder containing package.json, if different
npm install
```

### 2. Database

The database was built up through a series of SQL scripts (tables, security rules, and functions). To keep a complete, current copy in the repository, export it with the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db dump --linked --schema public -f supabase/schema.sql
```

To set up a new project, run `supabase/schema.sql` in the SQL editor of a fresh Supabase project.

### 3. Sign-in and email

In Supabase:
- **Authentication → URL Configuration:** set the Site URL to your domain, and add `https://your-domain/**` to the redirect URLs.
- **Authentication → Emails:** configure SMTP (for example, Resend), and paste in the Coinrose email templates.
- **Authentication → Sign In / Providers → Email:** turn on "Confirm email" and "Secure password change," and set the minimum password length to 12.
- **Attack Protection:** turn on CAPTCHA with Turnstile (the **secret** key goes here, and only here) and, on a paid plan, leaked-password protection.

### 4. Environment variables

Create `.env.local` in the project root:

```
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
VITE_TURNSTILE_SITE_KEY=your-turnstile-site-key     # optional
VITE_SENTRY_DSN=your-sentry-dsn                     # optional
```

All four are public by design: anything starting with `VITE_` is built into the JavaScript sent to browsers. Never put a secret key (Supabase service role, Turnstile secret, Resend API key) in a `VITE_` variable.

### 5. Run

```bash
npm run dev         # local development
npm test            # run the tests
npm run coverage    # tests plus a coverage report
npm run build       # production build
```

## Testing

About 250 tests cover the budget math, periods, importing, backups, the database layer, every screen, the app shell (saving, syncing, restores), sign-in, household roles, and Settings. `npm run coverage` enforces minimums of 80% for lines, statements, and branches, and 70% for functions; the run fails if coverage drops below them. The database functions were also tested separately against a local Postgres copy of the schema.

## Deployment

1. Import the repository into Vercel.
2. Add the environment variables from step 4 to the Vercel project (Production and Preview), then redeploy.
3. Keep `vercel.json` in the project root; it sets the security headers.
4. In Supabase, make sure your domain is in the redirect URL list.

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE): anyone may use, modify, and share this code for noncommercial purposes. Commercial use requires permission from the copyright holder.

Use of the Coinrose service at coinrose.io is covered separately by its [Terms of Use](https://coinrose.io/terms.html) and [Privacy Policy](https://coinrose.io/privacy.html).

## Contact

Morgan Keller · morgankfinances@gmail.com
