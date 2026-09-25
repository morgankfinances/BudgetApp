
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
    body: "This is your home page. Once you've added transactions, it shows this period's money in and out, your top spending categories, and anything that needs attention, like a budget running over or transactions waiting to be categorized.",
  },
  {
    view: "overview",
    title: "Getting around",
    body: "Every page lives in the sidebar on the left, grouped into Ledger, Budgeting, and Data. On a phone, tap the ☰ button at the top of the screen to open it.",
  },
  {
    view: "upload",
    title: "Start by uploading a statement",
    body: "Download a CSV file of your transactions from your bank or credit card's website, then upload it here. Coinrose guesses which columns hold the date, description, and amounts, and you confirm. Each bank account or card becomes its own account in Coinrose.",
  },
  {
    view: "transactions",
    title: "Categorize your transactions",
    body: "Everything you upload lands here. Choose a category for each transaction from its dropdown. As you go, Coinrose learns from your choices and suggests categories for similar transactions, marked as suggested until you confirm them. Filters at the top find uncategorized transactions, a date range, or a recent upload.",
  },
  {
    view: "categories",
    title: "Shape your categories",
    body: "Add, rename, or merge categories to match how you actually spend. Mark paychecks and other income as income, and exclude transfers between your own accounts so they don't count as spending.",
  },
  {
    view: "reports",
    title: "See where your money goes",
    body: "Reports charts your spending by category over time. Choose weekly, monthly, or custom periods to match how you're paid, switch between bar and donut charts, and hide big, steady categories like rent to see everything else more clearly.",
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
    body: "Now and then, download a copy of your transactions and budget setup here. The same page can restore from those files if you ever need to.",
  },
  {
    view: "overview",
    title: "You're all set",
    body: "Settings, in the bottom-right corner, is where you invite household members, choose a light or dark theme, set a password, and replay this tour.",
  },
];
