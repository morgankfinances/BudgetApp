// src/components/HomePage.jsx
// What visitors who aren't signed in see at coinrose.io. "Sign in" and
// "Get started" open the sign-in form (see authGate.jsx). It uses the
// theme colors and fonts, and loads none of the app's own code.

import React from "react";
import { ThemedLogo } from "../householdGate.jsx";

const CONTACT_EMAIL = "morgankfinances@gmail.com";

const STEPS = [
  {
    title: "Upload a statement",
    body: "Download a CSV or Excel file from your bank or card's website and upload it. Coinrose recognizes the columns; you confirm.",
  },
  {
    title: "Sort your spending",
    body: "Choose a category for each transaction. Coinrose learns from your choices and suggests categories for the next ones.",
  },
  {
    title: "Budget and plan",
    body: "Set limits that reset each week or month, save toward goals, and see at a glance how you're tracking.",
  },
];

const FEATURES = [
  {
    title: "Reports on your schedule",
    body: "See spending weekly, monthly, every few days, or twice a month, lined up with when you actually get paid.",
  },
  {
    title: "Savings goals",
    body: "Set money aside each month toward something bigger, with a running balance of what you've built up.",
  },
  {
    title: "Made for households",
    body: "Invite the people you live with. Owners approve who joins, and anyone who leaves keeps a copy of the records.",
  },
  {
    title: "Categorizing that learns",
    body: "Suggestions based on how you've sorted similar purchases before, and a heads-up when something looks like a duplicate.",
  },
  {
    title: "Undo recent changes",
    body: "Changed something by mistake? Roll back to any point in the last 7 days.",
  },
  {
    title: "Yours to keep or delete",
    body: "Download everything as spreadsheet files whenever you like, or delete your account and its data for good.",
  },
];

const SCREENS = [
  {
    src: "/home/transactions.webp",
    width: 1600,
    height: 1000,
    alt: "The Transactions page: a list of purchases with dates, accounts, amounts, and suggested categories.",
    title: "Every account in one list",
    caption: "Transactions from all your accounts together, with filters, search, and category suggestions ready to confirm.",
  },
  {
    src: "/home/reports.webp",
    width: 1600,
    height: 1000,
    alt: "The Reports page: a bar chart of money in and out by category for each month.",
    title: "Where the money goes",
    caption: "Spending by category over time, with a full table underneath. Hide big, steady bills like rent to see everything else clearly.",
  },
  {
    src: "/home/budget.webp",
    width: 1600,
    height: 875,
    alt: "The Budget page: progress bars showing how much of each budget has been spent this month.",
    title: "Budgets at a glance",
    caption: "Progress on every budget this period, plus a history of how each one has gone.",
  },
];

export default function HomePage({ onSignIn, onGetStarted }) {
  return (
    <div className="home-root">
      <style>{HOME_STYLES}</style>

      <header className="home-header">
        <div className="home-wrap home-header-row">
          <span className="home-brand">
            <ThemedLogo className="home-logo" />
            Coinrose
          </span>
          <nav aria-label="Account" className="home-header-actions">
            <button type="button" className="home-btn home-btn-quiet" onClick={onSignIn}>
              Sign in
            </button>
            <button type="button" className="home-btn home-btn-primary" onClick={onGetStarted}>
              Get started
            </button>
          </nav>
        </div>
      </header>

      <main>
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-wrap home-hero-grid">
            <div className="home-hero-text">
              <h1 id="home-title">Your money. Organized by you.</h1>
              <p className="home-lead">
                Coinrose turns the statements you download from your bank into a clear picture of where your money
                goes, with budgets that fit how you actually get paid. Share it with the people you live with.
              </p>
              <div className="home-ctas">
                <button type="button" className="home-btn home-btn-primary home-btn-large" onClick={onGetStarted}>
                  Get started free
                </button>
                <button type="button" className="home-btn home-btn-secondary home-btn-large" onClick={onSignIn}>
                  Sign in
                </button>
              </div>
              <p className="home-reassure">No bank logins · No ads · Delete anytime</p>
            </div>
            <figure className="home-hero-shot">
              <img
                src="/home/overview.webp"
                width="1600"
                height="700"
                alt="The Coinrose Overview: this month's money in and out, what needs attention, and top spending by category."
                fetchPriority="high"
              />
            </figure>
          </div>
        </section>

        <section className="home-section" aria-labelledby="how-title">
          <div className="home-wrap">
            <h2 id="how-title">How it works</h2>
            <ol className="home-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="home-step">
                  <span className="home-step-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="home-section home-section-alt" aria-labelledby="features-title">
          <div className="home-wrap">
            <h2 id="features-title">What it does</h2>
            <ul className="home-features">
              {FEATURES.map((f) => (
                <li key={f.title} className="home-feature">
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="home-section" aria-labelledby="screens-title">
          <div className="home-wrap">
            <h2 id="screens-title">A look inside</h2>
            <div className="home-screens">
              {SCREENS.map((s) => (
                <figure key={s.src} className="home-screen">
                  <img src={s.src} width={s.width} height={s.height} alt={s.alt} loading="lazy" />
                  <figcaption>
                    <h3>{s.title}</h3>
                    <p>{s.caption}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
            <p className="home-note">Screenshots show made-up sample data.</p>
          </div>
        </section>

        <section className="home-section home-section-alt" aria-labelledby="privacy-title">
          <div className="home-wrap home-privacy">
            <h2 id="privacy-title">Built to know as little as possible</h2>
            <ul className="home-checks">
              <li>Coinrose never connects to your bank and never asks for bank passwords. You upload statement files yourself.</li>
              <li>Only the date, description, and amount columns are kept. Account numbers, memos, and anything else in the file are discarded.</li>
              <li>No ads, no selling your data, and no tracking.</li>
              <li>Each household's data is kept separate by the database itself, not just hidden by the app.</li>
            </ul>
            <p>
              The details are in the{" "}
              <a href="/privacy.html" target="_blank" rel="noopener">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </section>

        <section className="home-section" aria-labelledby="about-title">
          <div className="home-wrap home-about">
            <h2 id="about-title">About Coinrose</h2>
            <p>
            Coinrose is a personal project by Morgan Keller. 
            It started as my household budget spreadsheet, with a separate sheet for every account. 
            It worked, but it was time-consuming to keep up and never pleasant to look at. 
            The budgeting apps I tried cost more than I wanted to pay, wanted to connect directly to my bank accounts, 
            or weren't clear about what they did with my data.

            Coinrose is what that spreadsheet wanted to be: one place for the whole household, 
            with budgets that fit how you're actually paid, and data that's never sold and never used for ads.
            </p>
            <p>
              It's free to use, it has no ads, and it isn't a bank or financial institution. Questions or ideas? Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
          </div>
        </section>

        <section className="home-final" aria-labelledby="final-title">
          <div className="home-wrap">
            <h2 id="final-title">See where it all goes.</h2>
            <div className="home-ctas home-ctas-center">
              <button type="button" className="home-btn home-btn-primary home-btn-large" onClick={onGetStarted}>
                Get started free
              </button>
              <button type="button" className="home-btn home-btn-secondary home-btn-large" onClick={onSignIn}>
                Sign in
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <div className="home-wrap home-footer-row">
          <span>© {new Date().getFullYear()} Morgan Keller</span>
          <nav aria-label="Legal and contact" className="home-footer-links">
            <a href="/privacy.html" target="_blank" rel="noopener">
              Privacy Policy
            </a>
            <a href="/terms.html" target="_blank" rel="noopener">
              Terms of Use
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const HOME_STYLES = `
@import url('/fonts/fonts.css');

.home-root {
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Coinrose Body', -apple-system, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.6;
}
.home-root *, .home-root *::before, .home-root *::after { box-sizing: border-box; }
.home-wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }
.home-root h1, .home-root h2, .home-root h3 {
  font-family: 'Coinrose Heading', -apple-system, 'Segoe UI', sans-serif;
  color: var(--heading);
  letter-spacing: -0.01em;
  line-height: 1.2;
  margin: 0;
}
.home-root a { color: var(--accent); font-weight: 600; }

/* Header */
.home-header { border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 10; }
.home-header-row { display: flex; align-items: center; justify-content: space-between; height: 64px; }
.home-brand { display: flex; align-items: center; gap: 10px; font-family: 'Coinrose Heading', sans-serif; font-weight: 600; font-size: 20px; color: var(--heading); }
.home-logo { width: 30px; height: 30px; }
.home-header-actions { display: flex; gap: 8px; }

/* Buttons */
.home-btn {
  font-family: inherit; font-size: 14px; font-weight: 600; line-height: 1;
  padding: 10px 16px; border-radius: 8px; cursor: pointer; border: 1px solid transparent;
}
.home-btn-large { font-size: 16px; padding: 14px 22px; }
.home-btn-primary { background: var(--accent-button); color: var(--on-accent); border-color: var(--accent-button); }
.home-btn-primary:hover { background: var(--accent-button-hover); border-color: var(--accent-button-hover); }
.home-btn-secondary { background: var(--panel); color: var(--ink); border-color: var(--border); }
.home-btn-secondary:hover { border-color: var(--ink-muted); }
.home-btn-quiet { background: none; color: var(--ink); }
.home-btn-quiet:hover { background: var(--subtle-bg); }
.home-btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }

/* Hero */
.home-hero { padding: 64px 0 56px; }
.home-hero-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: 56px; align-items: center; }
.home-hero h1 { font-size: clamp(30px, 3.3vw, 42px); font-weight: 600; margin-bottom: 18px; }
.home-root .home-lead { font-size: 18px; color: var(--ink-muted); margin: 0 0 28px; max-width: 34em; }
.home-ctas { display: flex; gap: 12px; flex-wrap: wrap; }
.home-ctas-center { justify-content: center; }
.home-root .home-reassure { margin: 18px 0 0; font-size: 14px; color: var(--ink-muted); font-weight: 600; }
.home-hero-shot, .home-screen { margin: 0; }
.home-hero-shot img, .home-screen img {
  display: block; width: 100%; height: auto;
  border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
  background: var(--panel);
}

/* Sections */
.home-section { padding: 64px 0; }
.home-section-alt { background: var(--panel); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.home-section h2 { font-size: clamp(26px, 3vw, 34px); font-weight: 600; margin-bottom: 28px; }
.home-root h3 { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
.home-root p { margin: 0 0 12px; }

.home-steps, .home-features, .home-checks { list-style: none; margin: 0; padding: 0; }
.home-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
.home-step p, .home-feature p { color: var(--ink-muted); margin: 0; }
.home-step-number {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 50%; margin-bottom: 12px;
  background: var(--accent-button); color: var(--on-accent);
  font-family: 'Coinrose Heading', sans-serif; font-weight: 600;
}
.home-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.home-feature { padding: 22px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); }

/* One screenshot per row, beside its description, alternating sides. */
.home-screens { display: grid; gap: 56px; }
.home-screen { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 4fr); gap: 40px; align-items: center; }
.home-screen:nth-child(even) img { order: 2; }
.home-screen figcaption p { color: var(--ink-muted); margin: 0; }
.home-root .home-note { margin: 28px 0 0; font-size: 13px; color: var(--ink-muted); }

.home-privacy > *, .home-about > * { max-width: 760px; }
.home-checks { margin-bottom: 18px; }
.home-checks li { position: relative; padding-left: 32px; margin-bottom: 14px; }
.home-checks li::before {
  content: ""; position: absolute; left: 4px; top: 7px; width: 14px; height: 8px;
  border-left: 3px solid var(--income); border-bottom: 3px solid var(--income); transform: rotate(-45deg);
}

.home-final { padding: 72px 0; text-align: center; }
.home-final h2 { font-size: clamp(26px, 3vw, 34px); font-weight: 600; margin-bottom: 24px; }

/* Footer */
.home-footer { border-top: 1px solid var(--border); padding: 28px 0; font-size: 14px; color: var(--ink-muted); }
.home-footer-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
.home-footer-links { display: flex; gap: 20px; flex-wrap: wrap; }

/* Smaller screens */
@media (max-width: 900px) {
  .home-hero-grid { grid-template-columns: minmax(0, 1fr); gap: 36px; }
  .home-features { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .home-screen { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .home-screen:nth-child(even) img { order: 0; }
}
@media (max-width: 640px) {
  .home-hero { padding: 40px 0; }
  .home-section { padding: 48px 0; }
  .home-steps, .home-features { grid-template-columns: minmax(0, 1fr); }
  .home-header-actions .home-btn { padding: 9px 12px; }
  .home-brand { font-size: 18px; }
}
`;
