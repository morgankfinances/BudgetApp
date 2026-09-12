# LDGR — The Transaction Classification and Budget App

A household budgeting app built for real financial life: irregular pay schedules, shared accounts, savings goals, and the occasional messy bank CSV.

**Live app:** https://budget-app-silk-nine.vercel.app/

---

## What is LDGR?

LDGR ("ledger") is a household finance tracker that goes beyond a spreadsheet import. Upload your bank and credit card statements, categorize what matters, set real budgets — including savings goals that build over time — and share it all with a partner or household member without giving up control over who sees what.

It's built to match how people actually get paid and billed — weekly, biweekly, twice a month, or a custom cycle — not just "the 1st of the month."

## Features

### Ledger & Transactions
- Upload CSV/XLSX statements from any bank or credit card, with a column-mapping wizard that guesses your file's layout (and handles either separate debit/credit columns or a single signed-amount column, sign-inverted or not)
- Automatic duplicate detection
- Filter by account, category, date range, uncategorized status, or a specific recent upload
- A dedicated post-upload screen for categorizing exactly what you just imported, with a "skip for now" option that leaves everything else untouched

### Categories
- Add, rename, merge, and exclude categories (handy for internal transfers between your own accounts)
- Flag a category as income so it's never mistaken for spending

### Budgeting
- **Spend** budgets — a limit that resets every period; going over is your warning sign
- **Accumulate** budgets — save toward a target over time, with a backdatable "track since" date and a running fund balance
- **Budget Groups** — roll several related categories into one shared budget
- Planned income vs. actual income tracking, with visibility into spending that isn't budgeted anywhere yet

### Reports
- Choose your own reporting period — weekly, monthly, every X days, or twice a month
- A stacked bar chart across periods, or a donut chart for a single period's breakdown
- Hide large, steady categories (a paycheck, rent) from the charts with one click, without affecting anything else in the app — Budget and Planning still track them normally
- A full category-by-category data table underneath

### Overview
- One dashboard: this period's totals, budgets that need attention, top spending categories, and quick links into Reports and Budget for more detail

### Household Sharing
- Passwordless sign-in via emailed magic links
- Create a household or join one with an invite code — new members need approval before they see any data
- Shared read/write access to one household's data across every member
- Point-in-time Data History (last hour) you can restore from if something goes wrong
- Leave a household (keeps your own copy of the data) or permanently delete a household's data outright

### Backup & Restore
- Export the full ledger, or just your budget setup, as a CSV
- Restore from a ledger backup to rebuild accounts, categories, and transactions from scratch
- Reapply a budget backup to update or create budgets and groups by name, without deleting anything the file doesn't mention

### Appearance & Mobile
- Three themes — a warm default, a cooler light slate, and a dark midnight
- Fully responsive, with a mobile drawer/hamburger menu that mirrors the desktop navigation one-for-one

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Supabase (Postgres, Auth, Row-Level Security) |
| Charts | Recharts |
| File parsing | PapaParse (CSV), SheetJS/xlsx (Excel) |
| Email | Resend (magic-link delivery) |
| Hosting | Vercel |

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Resend](https://resend.com) account (or another SMTP provider) for magic-link emails

### 1. Clone and install

```bash
git clone https://github.com/morgankfinances/BudgetApp.git
cd BudgetApp
npm install
```

### 2. Set up Supabase

Run this project's SQL migrations, in order, in the Supabase SQL editor. Together they create:

- `app_storage` and `app_storage_history` — the household's data blob and its point-in-time archive, including the trigger that snapshots a row before every change and prunes anything older than an hour
- `households`, `household_members`, `household_join_requests`
- The household lifecycle functions: `create_household`, `request_join_household`, `approve_join_request`, `deny_join_request`, `remove_household_member`, `regenerate_invite_code`, `rename_household`, `leave_household`, `delete_my_household_data`
- Row-Level Security policies scoping every table to the current user's household

Invite codes expire after 7 days and are rate-limited against repeated guessing.

### 3. Configure magic-link email

In Supabase's Auth settings, point the SMTP configuration at Resend (or your provider of choice), and set the Site URL and Redirect URLs to match your deployed domain.

### 4. Environment variables

Create a `.env.local` file in the project root:

```
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
```

### 5. Run it

```bash
npm run dev
```

## Deployment

The app deploys cleanly to Vercel:

1. Import the repo into Vercel
2. Add the same environment variables from step 4 in the Vercel project settings
3. In Supabase's Auth settings, add your Vercel domain to the redirect URL allow-list (e.g. `https://your-app.vercel.app/**`)

## Project Structure

```
src/
  main.jsx             # Entry point — wires AuthGate around HouseholdGate around App
  App.jsx              # Main application: ledger, transactions, budgets, reports, overview
  AuthGate.jsx         # Passwordless sign-in
  HouseholdGate.jsx    # Household creation/joining, member management, settings, theme picker
  storageAdapter.js    # Household-scoped Supabase storage layer (the app's window.storage)
  supabaseClient.js    # Supabase client setup
```

## A Note on the Data Model

LDGR stores each household's entire dataset as a single JSON blob rather than a fully normalized set of transaction tables. That keeps sync and conflict handling simple: when two household members edit at the same time, a three-way merge reconciles the changes against the last-known-good version before saving, rather than requiring row-level locking. It's a good fit for personal or household-scale data; it isn't designed to scale to a large multi-tenant dataset.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) — anyone may use, modify, and share this code for noncommercial purposes. Commercial use requires permission from the copyright holder.

## Contact

Morgan — morgankfinances@gmail.com
