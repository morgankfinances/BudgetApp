
/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Tutorial                                                             */
/*                                                                      */
/* A guided tour: a dialog card that walks through the app one page at  */
/* a time, switching to each page as it goes so the real page shows     */
/* behind the card. Starts automatically the first time someone uses    */
/* the app on this browser, and can be replayed from Settings.          */
/* ------------------------------------------------------------------ */

export const TUTORIAL_SEEN_KEY = "coinrose-tutorial-seen-v1";


// Settings (householdGate.jsx) sends this signal to replay the tour. A
// signal instead of an import keeps the two files from importing each
// other in a loop.
export const TUTORIAL_EVENT = "coinrose:start-tutorial";


export function tutorialAlreadySeen() {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === "true";
  } catch (e) {
    return true; // storage unavailable: don't pop it up every visit
  }
}


export function markTutorialSeen() {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
  } catch (e) {
    /* ignore */
  }
}


// Each step: the page to show behind the card, a title, and the text.
export const TUTORIAL_STEPS = [
  {
    view: "overview",
    title: "Welcome to Coinrose",
    body: "Coinrose brings your household's accounts together in one place, so you can see where your money goes and plan where it should go. This quick tour shows you around. You can skip it anytime and replay it later from Settings.",
  },
  {
    view: "overview",
    title: "Your Overview",
    body: "This is your home page. It shows this period's money in and out, your top spending, bills coming up in the next two weeks, and anything that needs attention, like a budget running over or transactions waiting for a category. The arrows step back to earlier periods.",
  },
  {
    view: "overview",
    title: "Getting around",
    body: "Every page lives in the sidebar on the left, grouped into Ledger, Budgeting, and Data. On a computer, the arrow at its top corner hides it for more room. On a phone, tap the ☰ button at the top of the screen to open it.",
  },
  {
    view: "upload",
    title: "Start by uploading a statement",
    body: "Download your transactions from your bank or card's website (as CSV, Excel, or, best of all, OFX or QFX) and upload them here. Choose the file, then confirm which account it's from. Anything already in Coinrose is skipped automatically, so overlapping statements are fine.",
  },
  {
    view: "accounts",
    title: "Your accounts",
    body: "Each bank account or card is listed here. To track a balance, enter a starting balance as of a date, and Coinrose adds and subtracts everything you upload after it. It's an estimate from your uploads, since Coinrose never connects to your bank.",
  },
  {
    view: "transactions",
    title: "Categorize your transactions",
    body: "Everything you upload lands here, a month at a time (searching looks across all months). Pick a category for each transaction; Coinrose learns from your choices and fills in categories it recognizes, marked Suggested until you confirm. Split divides a purchase among categories, and 💬 leaves a comment for your household.",
  },
  {
    view: "transactions",
    title: "Transfers between your accounts",
    body: "Moving money between your own accounts, like paying the credit card, isn't spending or income. When Coinrose spots a likely transfer, it asks you to confirm it here, so it isn't counted twice.",
  },
  {
    view: "categories",
    title: "Shape your categories",
    body: "Add, rename, or merge categories to match how you actually spend. Mark paychecks and other income as income, and exclude anything that shouldn't count as spending.",
  },
  {
    view: "reports",
    title: "See where your money goes",
    body: "Reports charts your spending by category over time. Choose weekly, monthly, or custom periods to match how you're paid, switch between bar and donut charts, and hide big, steady categories like rent to see everything else more clearly.",
  },
  {
    view: "insights",
    title: "Insights",
    body: "Insights spots patterns for you: recurring bills, subscriptions, and paychecks, with when each is next expected, plus quick observations like how this month compares with last. It only reads your transactions; nothing there changes them.",
  },
  {
    view: "planning",
    title: "Plan your budget",
    body: "Enter the income you expect, then give categories a budget. A Spend budget is a limit that resets each period. An Accumulate budget saves toward a goal over time.",
  },
  {
    view: "budgetGroups",
    title: "Group related categories",
    body: "Budget Groups let several categories share one budget, like Groceries and Dining Out under a single Food limit.",
  },
  {
    view: "budget",
    title: "Track your progress",
    body: "Budget shows how each budget is doing this period, with progress bars, a performance chart, and a history of past periods.",
  },
  {
    view: "backup",
    title: "Keep a backup",
    body: "Now and then, download a complete backup here: one file with everything, including splits, comments, and balances. If you ever need it, the same page restores from it.",
  },
  {
    view: "overview",
    title: "You're all set",
    body: "Settings, in the bottom-right corner, is where you invite household members, choose a theme, set a password, turn on two-step sign-in, choose how imports handle duplicates and suggestions, and replay this tour.",
  },
];
