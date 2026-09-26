import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TutorialDialog } from "./components/TutorialDialog.jsx";
import { VIEW_TITLES } from "./constants.js";
import { DecoRing, LoadingIndicator, ThemedLogo } from "./householdGate.jsx";
import { computeLedgerChanges, fetchLedgerVersion, hasChanges, saveLedgerChanges } from "./ledgerStore.js";
import { computeDuplicates } from "./lib/analysis.js";
import { mapRow } from "./lib/importing.js";
import { loadData } from "./lib/ledgerData.js";
import { TUTORIAL_EVENT, TUTORIAL_STEPS, markTutorialSeen, tutorialAlreadySeen } from "./lib/tutorial.js";
import { formatMoney, uid } from "./lib/utils.js";
import { STYLES } from "./styles.js";
import { AccountsView } from "./views/AccountsView.jsx";
import { BackupView } from "./views/BackupView.jsx";
import { BudgetGroupsView } from "./views/BudgetGroupsView.jsx";
import { BudgetView } from "./views/BudgetView.jsx";
import { CategoriesView } from "./views/CategoriesView.jsx";
import { OverviewView } from "./views/OverviewView.jsx";
import { PlanningView } from "./views/PlanningView.jsx";
import { ReportsView } from "./views/ReportsView.jsx";
import { PostUploadCategorizeView, TransactionsView } from "./views/TransactionsView.jsx";
import { UploadView } from "./views/UploadView.jsx";

function App({ householdName } = {}) {
  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [budgetGroups, setBudgetGroups] = useState([]);
  const [plannedIncome, setPlannedIncome] = useState(null);
  const [incomeWarningDismissed, setIncomeWarningDismissed] = useState(false);
  const [hiddenBudgetMonths, setHiddenBudgetMonths] = useState([]);
  const [excludeUnassignedFromBudget, setExcludeUnassignedFromBudget] = useState(false);
  const [view, setView] = useState("overview");
  const [saveError, setSaveError] = useState(null);
  const [toast, setToast] = useState(null);
  const [uploadKey, setUploadKey] = useState(0);
  const [uploadPrefill, setUploadPrefill] = useState(null);
  const [remoteChangeAvailable, setRemoteChangeAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeUploadBatch, setActiveUploadBatch] = useState(null); // { batchId, accountName }
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(null); // null = tour not showing
  const baseSnapshotRef = useRef(null);
  const savingRef = useRef(false);
  const versionRef = useRef(null); // the household's change counter as of our last load or save
  const [loadError, setLoadError] = useState(false);

  // Tutorial: start automatically the first time the app is used on this
  // browser, once the data has loaded.
  useEffect(() => {
    if (loaded && !tutorialAlreadySeen()) setTutorialStep(0);
  }, [loaded]);

  // Tutorial: replay when Settings asks for it.
  useEffect(() => {
    function start() {
      setTutorialStep(0);
    }
    window.addEventListener(TUTORIAL_EVENT, start);
    return () => window.removeEventListener(TUTORIAL_EVENT, start);
  }, []);

  // Tutorial: show each step's page behind the card.
  useEffect(() => {
    if (tutorialStep === null) return;
    setView(TUTORIAL_STEPS[tutorialStep].view);
    setMobileMenuOpen(false);
    window.scrollTo(0, 0);
  }, [tutorialStep]);

  const endTutorial = useCallback(() => {
    markTutorialSeen();
    setTutorialStep(null);
  }, []);

  // Keep the browser tab title in sync with whichever page is showing —
  // the same VIEW_TITLES map the mobile top bar already uses, so there's
  // one source of truth for a view's display name rather than two.
  useEffect(() => {
    document.title = VIEW_TITLES[view] ? `${VIEW_TITLES[view]} | Coinrose` : "Coinrose";
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    loadData()
      .then(({ snapshot, savedBase, version }) => {
        if (cancelled) return;
        applySnapshotToState(snapshot);
        baseSnapshotRef.current = savedBase;
        versionRef.current = version;
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Poll for changes made elsewhere so an open tab finds out before the
  // person starts editing, not only when their own save collides.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const checkForRemoteChanges = async () => {
      // Skip while one of our own saves is in flight: it has already moved
      // the change counter, but versionRef only catches up when the save
      // returns, so checking now would mistake our own save for someone
      // else's.
      if (savingRef.current) return;
      try {
        // One number: the household's change counter. If it moved and we
        // didn't move it, someone else saved.
        const version = await fetchLedgerVersion();
        if (cancelled) return;
        if (version !== null && versionRef.current !== null && version !== versionRef.current) {
          setRemoteChangeAvailable(true);
        }
      } catch (e) {
        /* transient network issue — just try again next interval */
      }
    };
    const interval = setInterval(checkForRemoteChanges, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loaded]);

  function applySnapshotToState(snap) {
    setAccounts(snap.accounts);
    setTransactions(snap.transactions);
    setCategories(snap.categories);
    setBudgetGroups(snap.budgetGroups);
    setPlannedIncome(snap.plannedIncome);
    setIncomeWarningDismissed(snap.incomeWarningDismissed);
    setHiddenBudgetMonths(snap.hiddenBudgetMonths);
    setExcludeUnassignedFromBudget(snap.excludeUnassignedFromBudget);
  }

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    savingRef.current = true;
    try {
      const { snapshot, savedBase, version } = await loadData();
      applySnapshotToState(snapshot);
      baseSnapshotRef.current = savedBase;
      versionRef.current = version;
      setRemoteChangeAvailable(false);
      setToast("Synced with the latest data.");
    } catch (e) {
      setToast("Couldn't sync right now — try again in a moment.");
    } finally {
      savingRef.current = false;
    }
    setSyncing(false);
  }, []);

  const persist = useCallback(
    async (
      nextAccounts,
      nextTransactions,
      nextCategories,
      nextBudgetGroups,
      nextPlannedIncome,
      nextIncomeWarningDismissed,
      nextHiddenBudgetMonths,
      nextExcludeUnassignedFromBudget
    ) => {
      const localBlob = {
        accounts: nextAccounts,
        transactions: nextTransactions,
        categories: nextCategories,
        budgetGroups: nextBudgetGroups,
        plannedIncome: nextPlannedIncome,
        incomeWarningDismissed: nextIncomeWarningDismissed,
        hiddenBudgetMonths: nextHiddenBudgetMonths,
        excludeUnassignedFromBudget: nextExcludeUnassignedFromBudget,
      };

      // Show the edit immediately.
      applySnapshotToState(localBlob);
      savingRef.current = true;

      // Only rows that actually changed are sent, so a save can't overwrite
      // anything someone else changed elsewhere, even if this screen is a
      // little out of date.
      const base = baseSnapshotRef.current;
      try {
        const changes = computeLedgerChanges(base, localBlob);
        if (!hasChanges(changes)) {
          setSaveError(null);
          return;
        }
        const previousVersion = versionRef.current;
        const newVersion = await saveLedgerChanges(changes);
        baseSnapshotRef.current = { ...localBlob, settingsSaved: true };
        versionRef.current = newVersion;
        // Our save moves the counter by exactly one. A bigger jump means
        // someone else saved in between: offer to bring their changes in.
        if (previousVersion !== null && newVersion !== previousVersion + 1) {
          setRemoteChangeAvailable(true);
        }
        setSaveError(null);
      } catch (e) {
        // Nothing is lost: what was last saved hasn't moved, so this change
        // is sent again with the next one.
        setSaveError("Your last change couldn't be saved. Check your connection; it will be retried with your next change.");
      } finally {
        savingRef.current = false;
      }
    },
    []
  );

  const duplicateInfo = useMemo(() => computeDuplicates(transactions), [transactions]);

  const goToUpload = useCallback((accountId) => {
    setUploadPrefill(accountId ? { mode: "append", accountId } : null);
    setUploadKey((k) => k + 1);
    setView("upload");
  }, []);

  const handleImport = useCallback(
    (accountMeta, valid) => {
      let nextAccounts;
      if (accountMeta.isNew) {
        nextAccounts = [
          ...accounts,
          {
            id: accountMeta.id,
            name: accountMeta.name,
            dateCol: accountMeta.dateCol,
            descriptionCol: accountMeta.descriptionCol,
            outCol: accountMeta.outCol,
            inCol: accountMeta.inCol,
            invertSign: accountMeta.invertSign,
            createdAt: new Date().toISOString(),
          },
        ];
      } else {
        nextAccounts = accounts.map((a) =>
          a.id === accountMeta.id
            ? {
                ...a,
                dateCol: accountMeta.dateCol,
                descriptionCol: accountMeta.descriptionCol,
                outCol: accountMeta.outCol,
                inCol: accountMeta.inCol,
                invertSign: accountMeta.invertSign,
              }
            : a
        );
      }
      const nextTransactions = [...transactions, ...valid];
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      const batchId = valid.length > 0 ? valid[0].uploadBatchId : null;
      if (batchId) {
        setActiveUploadBatch({ batchId, accountName: accountMeta.name });
        setView("categorize");
      } else {
        setView("transactions");
      }
      setToast(`Imported ${valid.length} transaction${valid.length === 1 ? "" : "s"} into ${accountMeta.name}.`);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteAccount = useCallback(
    (accountId) => {
      const nextAccounts = accounts.filter((a) => a.id !== accountId);
      const nextTransactions = transactions.filter((t) => t.accountId !== accountId);
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRenameAccount = useCallback(
    (accountId, newName) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const nextAccounts = accounts.map((a) => (a.id === accountId ? { ...a, name: trimmed } : a));
      const nextTransactions = transactions.map((t) =>
        t.accountId === accountId ? { ...t, accountName: trimmed } : t
      );
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleUpdateAccountSettings = useCallback(
    (accountId, mapping) => {
      const nextAccounts = accounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              dateCol: mapping.dateCol,
              descriptionCol: mapping.descriptionCol,
              outCol: mapping.outCol,
              inCol: mapping.inCol,
              invertSign: mapping.invertSign,
            }
          : a
      );
      let skipped = 0;
      const nextTransactions = transactions.map((t) => {
        if (t.accountId !== accountId) return t;
        const mapped = mapRow(t.raw || {}, mapping);
        if (mapped.reasons.length > 0) {
          skipped += 1;
          return t;
        }
        return { ...t, date: mapped.date, description: mapped.description, amountOut: mapped.amountOut, amountIn: mapped.amountIn };
      });
      persist(nextAccounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      setToast(
        skipped > 0
          ? `Updated account settings. ${skipped} transaction${skipped === 1 ? "" : "s"} couldn't be remapped and were left as-is.`
          : "Updated account settings and reapplied them to existing transactions."
      );
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRestoreFromBackup = useCallback(
    (newAccounts, newCategories, newTransactions) => {
      persist(newAccounts, newTransactions, newCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      setView("transactions");
      setToast(
        `Restored ${newTransactions.length} transaction${newTransactions.length === 1 ? "" : "s"} from backup.`
      );
    },
    [budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRestoreBudget = useCallback(
    (newCategories, newBudgetGroups, restoredPlannedIncome) => {
      persist(
        accounts,
        transactions,
        newCategories,
        newBudgetGroups,
        restoredPlannedIncome != null ? restoredPlannedIncome : plannedIncome,
        incomeWarningDismissed,
        hiddenBudgetMonths,
        excludeUnassignedFromBudget
      );
      setToast("Applied budget setup from file.");
    },
    [accounts, transactions, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleUpdateTransaction = useCallback(
    (id, updates) => {
      const nextTransactions = transactions.map((t) => (t.id === id ? { ...t, ...updates } : t));
      persist(accounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteTransaction = useCallback(
    (id) => {
      const nextTransactions = transactions.filter((t) => t.id !== id);
      persist(accounts, nextTransactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleAddCategory = useCallback(
    (name) => {
      const nextCategories = [
        ...categories,
        {
          id: uid(),
          name,
          excluded: false,
          isIncome: false,
          budgetAmount: null,
          budgetPeriod: "monthly",
          budgetType: "spend",
          accumulateTarget: null,
          accumulateActuals: {},
          fundAdjustments: [],
          createdAt: new Date().toISOString(),
        },
      ];
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRenameCategory = useCallback(
    (categoryId, newName) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, name: newName } : c));
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleCategoryExcluded = useCallback(
    (categoryId, excluded) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, excluded } : c));
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleCategoryIsIncome = useCallback(
    (categoryId, isIncome) => {
      const nextCategories = categories.map((c) => (c.id === categoryId ? { ...c, isIncome } : c));
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetCategoryBudget = useCallback(
    (categoryId, budgetAmount, budgetPeriod, budgetType, accumulateTarget, startDate) => {
      const nextCategories = categories.map((c) =>
        c.id === categoryId
          ? {
              ...c,
              budgetAmount,
              budgetPeriod: budgetPeriod || "monthly",
              budgetType: budgetType === "accumulate" ? "accumulate" : "spend",
              accumulateTarget: accumulateTarget != null ? accumulateTarget : null,
              createdAt: startDate ? new Date(startDate + "T00:00:00.000Z").toISOString() : c.createdAt || new Date().toISOString(),
            }
          : c
      );
      persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleMergeCategory = useCallback(
    (sourceCategoryId, targetCategoryId) => {
      if (!sourceCategoryId || !targetCategoryId || sourceCategoryId === targetCategoryId) return;
      const source = categories.find((c) => c.id === sourceCategoryId);
      const target = categories.find((c) => c.id === targetCategoryId);
      const nextCategories = categories.filter((c) => c.id !== sourceCategoryId);
      const nextTransactions = transactions.map((t) =>
        t.categoryId === sourceCategoryId ? { ...t, categoryId: targetCategoryId } : t
      );
      // In budget groups, the merged category is replaced by the one it
      // merged into, so the group keeps covering that spending.
      const nextBudgetGroups = budgetGroups.map((g) => {
        const ids = g.categoryIds || [];
        if (!ids.includes(sourceCategoryId)) return g;
        const replaced = ids.map((id) => (id === sourceCategoryId ? targetCategoryId : id));
        return { ...g, categoryIds: replaced.filter((id, i) => replaced.indexOf(id) === i) };
      });
      persist(accounts, nextTransactions, nextCategories, nextBudgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      setToast(`Merged "${source?.name || "category"}" into "${target?.name || "category"}".`);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleAddBudgetGroup = useCallback(
    (name) => {
      const nextGroups = [
        ...budgetGroups,
        {
          id: uid(),
          name,
          budgetAmount: null,
          budgetPeriod: "monthly",
          budgetType: "spend",
          accumulateTarget: null,
          accumulateActuals: {},
          fundAdjustments: [],
          categoryIds: [],
          createdAt: new Date().toISOString(),
        },
      ];
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRenameBudgetGroup = useCallback(
    (groupId, newName) => {
      const nextGroups = budgetGroups.map((g) => (g.id === groupId ? { ...g, name: newName } : g));
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetBudgetGroupBudget = useCallback(
    (groupId, budgetAmount, budgetPeriod, budgetType, accumulateTarget, startDate) => {
      const nextGroups = budgetGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              budgetAmount,
              budgetPeriod: budgetPeriod || "monthly",
              budgetType: budgetType === "accumulate" ? "accumulate" : "spend",
              accumulateTarget: accumulateTarget != null ? accumulateTarget : null,
              createdAt: startDate ? new Date(startDate + "T00:00:00.000Z").toISOString() : g.createdAt || new Date().toISOString(),
            }
          : g
      );
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetAccumulateActual = useCallback(
    (prefixedId, periodKey, amount) => {
      const isGroup = prefixedId.startsWith("group:");
      const rawId = prefixedId.slice(prefixedId.indexOf(":") + 1);
      if (isGroup) {
        const nextGroups = budgetGroups.map((g) =>
          g.id === rawId ? { ...g, accumulateActuals: { ...(g.accumulateActuals || {}), [periodKey]: amount } } : g
        );
        persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      } else {
        const nextCategories = categories.map((c) =>
          c.id === rawId ? { ...c, accumulateActuals: { ...(c.accumulateActuals || {}), [periodKey]: amount } } : c
        );
        persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      }
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleAdjustFundBalance = useCallback(
    (prefixedId, delta) => {
      const isGroup = prefixedId.startsWith("group:");
      const rawId = prefixedId.slice(prefixedId.indexOf(":") + 1);
      const entry = { date: new Date().toISOString(), amount: delta };
      if (isGroup) {
        const nextGroups = budgetGroups.map((g) =>
          g.id === rawId ? { ...g, fundAdjustments: [...(g.fundAdjustments || []), entry] } : g
        );
        persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      } else {
        const nextCategories = categories.map((c) =>
          c.id === rawId ? { ...c, fundAdjustments: [...(c.fundAdjustments || []), entry] } : c
        );
        persist(accounts, transactions, nextCategories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
      }
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleSetPlannedIncome = useCallback(
    (amount) => {
      // A newly-set plan deserves a fresh evaluation rather than staying
      // silenced against the old one.
      persist(accounts, transactions, categories, budgetGroups, amount, false, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDismissIncomeWarning = useCallback(
    (dismissed) => {
      persist(accounts, transactions, categories, budgetGroups, plannedIncome, dismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleHiddenBudgetMonth = useCallback(
    (monthKey) => {
      const nextHidden = hiddenBudgetMonths.includes(monthKey)
        ? hiddenBudgetMonths.filter((k) => k !== monthKey)
        : [...hiddenBudgetMonths, monthKey];
      persist(accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, nextHidden, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleToggleExcludeUnassigned = useCallback(
    (exclude) => {
      persist(accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, exclude);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, persist]
  );

  const handleAddCategoryToGroup = useCallback(
    (groupId, categoryId) => {
      // A category belongs to at most one group — pull it out of any other
      // group it's currently in before adding it to this one.
      const nextGroups = budgetGroups.map((g) => {
        if (g.id === groupId) {
          const ids = g.categoryIds || [];
          return ids.includes(categoryId) ? g : { ...g, categoryIds: [...ids, categoryId] };
        }
        const ids = g.categoryIds || [];
        return ids.includes(categoryId) ? { ...g, categoryIds: ids.filter((id) => id !== categoryId) } : g;
      });
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleRemoveCategoryFromGroup = useCallback(
    (groupId, categoryId) => {
      const nextGroups = budgetGroups.map((g) =>
        g.id === groupId ? { ...g, categoryIds: (g.categoryIds || []).filter((id) => id !== categoryId) } : g
      );
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteBudgetGroup = useCallback(
    (groupId) => {
      const nextGroups = budgetGroups.filter((g) => g.id !== groupId);
      persist(accounts, transactions, categories, nextGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  const handleDeleteCategory = useCallback(
    (categoryId) => {
      const nextCategories = categories.filter((c) => c.id !== categoryId);
      const nextTransactions = transactions.map((t) =>
        t.categoryId === categoryId ? { ...t, categoryId: null } : t
      );
      // Remove it from any budget group too, in the same save, so Data
      // History can put it back in its groups if the delete is undone.
      const nextBudgetGroups = budgetGroups.map((g) =>
        (g.categoryIds || []).includes(categoryId)
          ? { ...g, categoryIds: g.categoryIds.filter((id) => id !== categoryId) }
          : g
      );
      persist(accounts, nextTransactions, nextCategories, nextBudgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget);
    },
    [accounts, transactions, categories, budgetGroups, plannedIncome, incomeWarningDismissed, hiddenBudgetMonths, excludeUnassignedFromBudget, persist]
  );

  if (loadError) {
    return (
      <div className="ledger-root">
        <style>{STYLES}</style>
        <div className="loading-screen">
          <div style={{ textAlign: "center" }}>
            <p style={{ marginBottom: 14 }}>Couldn't load your ledger. Check your connection and try again.</p>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="ledger-root">
        <style>{STYLES}</style>
        <div className="loading-screen">
          <LoadingIndicator label="Loading your ledger…" />
        </div>
      </div>
    );
  }

  const totalNet = transactions.reduce((s, t) => s + (t.amountIn || 0) - (t.amountOut || 0), 0);

  return (
    <div className="ledger-root">
      <style>{STYLES}</style>
      <DecoRing className="coinrose-bg-ring beside-sidebar" />
      <div className="mobile-topbar">
        <button
          className="hamburger-btn"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label="Open menu"
        >
          <span />
          <span />
          <span />
        </button>
        <h2>{VIEW_TITLES[view] || "Ledger"}</h2>
        <ThemedLogo className="mobile-topbar-logo" />
      </div>
      <div className={"sidebar-backdrop" + (mobileMenuOpen ? " visible" : "")} onClick={() => setMobileMenuOpen(false)} />
      <div className="app-shell">
        <div className={"sidebar" + (mobileMenuOpen ? " mobile-open" : "")}>
          <div className="sidebar-brand">
            <ThemedLogo className="sidebar-brand-logo" />
            {householdName ? `${householdName} Ledger` : "Ledger"}
          </div>
          <div className="sidebar-nav" onClick={() => setMobileMenuOpen(false)}>
            <div className="sidebar-nav-label">Ledger</div>
            <button
              className={"nav-btn" + (view === "overview" ? " active" : "")}
              onClick={() => setView("overview")}
            >
              Overview
            </button>
            <button
              className={"nav-btn" + (view === "transactions" ? " active" : "")}
              onClick={() => setView("transactions")}
            >
              Transactions
            </button>
            <button
              className={"nav-btn" + (view === "reports" ? " active" : "")}
              onClick={() => setView("reports")}
            >
              Reports
            </button>
            <button
              className={"nav-btn" + (view === "accounts" ? " active" : "")}
              onClick={() => setView("accounts")}
            >
              Accounts
            </button>
            <button
              className={"nav-btn" + (view === "categories" ? " active" : "")}
              onClick={() => setView("categories")}
            >
              Categories
            </button>
            <button
              className={"nav-btn" + (view === "upload" ? " active" : "")}
              onClick={() => goToUpload(null)}
            >
              Upload
            </button>

            <div className="sidebar-section-divider" />
            <div className="sidebar-nav-label">Budgeting</div>
            <button
              className={"nav-btn" + (view === "planning" ? " active" : "")}
              onClick={() => setView("planning")}
            >
              Planning
            </button>
            <button
              className={"nav-btn" + (view === "budgetGroups" ? " active" : "")}
              onClick={() => setView("budgetGroups")}
            >
              Budget Groups
            </button>
            <button
              className={"nav-btn" + (view === "budget" ? " active" : "")}
              onClick={() => setView("budget")}
            >
              Budget
            </button>

            <div className="sidebar-section-divider" />
            <div className="sidebar-nav-label">Data</div>
            <button
              className={"nav-btn" + (view === "backup" ? " active" : "")}
              onClick={() => setView("backup")}
            >
              Backup
            </button>
          </div>
          <div className="sidebar-stats">
            <div className="stat-row">
              <span>Accounts</span>
              <span>{accounts.length}</span>
            </div>
            <div className="stat-row">
              <span>Transactions</span>
              <span>{transactions.length}</span>
            </div>
            <div className="stat-row stat-net">
              <span>Net</span>
              <span>{formatMoney(totalNet)}</span>
            </div>
          </div>
        </div>

        <div className="main">
          {saveError && <div className="error-banner">{saveError}</div>}
          {remoteChangeAvailable && (
            <div className="sync-banner">
              <span>This household's data was updated elsewhere. Sync before making changes to avoid overlap.</span>
              <button className="btn btn-primary btn-sm" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          )}

          {view === "overview" && (
            <OverviewView
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              onNavigate={(v) => setView(v)}
            />
          )}

          {view === "upload" && (
            <UploadView key={uploadKey} accounts={accounts} prefill={uploadPrefill} onImport={handleImport} />
          )}
          {view === "categorize" && activeUploadBatch && (
            <PostUploadCategorizeView
              transactions={transactions}
              batchId={activeUploadBatch.batchId}
              accountName={activeUploadBatch.accountName}
              categories={categories}
              duplicateInfo={duplicateInfo}
              onUpdate={handleUpdateTransaction}
              onDelete={handleDeleteTransaction}
              onSkip={() => setView("transactions")}
            />
          )}
          {view === "transactions" && (
            <TransactionsView
              transactions={transactions}
              accounts={accounts}
              categories={categories}
              duplicateInfo={duplicateInfo}
              onUpdate={handleUpdateTransaction}
              onDelete={handleDeleteTransaction}
              onGoUpload={goToUpload}
            />
          )}
          {view === "reports" && (
            <ReportsView
              transactions={transactions}
              accounts={accounts}
              categories={categories}
              onGoCategories={() => setView("categories")}
            />
          )}
          {view === "planning" && (
            <PlanningView
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              plannedIncome={plannedIncome}
              incomeWarningDismissed={incomeWarningDismissed}
              excludeUnassignedFromBudget={excludeUnassignedFromBudget}
              onSetPlannedIncome={handleSetPlannedIncome}
              onDismissIncomeWarning={handleDismissIncomeWarning}
              onSetCategoryBudget={handleSetCategoryBudget}
              onToggleExcludeUnassigned={handleToggleExcludeUnassigned}
            />
          )}
          {view === "budget" && (
            <BudgetView
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              hiddenBudgetMonths={hiddenBudgetMonths}
              excludeUnassignedFromBudget={excludeUnassignedFromBudget}
              onSetActual={handleSetAccumulateActual}
              onAdjustFund={handleAdjustFundBalance}
              onToggleHiddenMonth={handleToggleHiddenBudgetMonth}
              onGoCategories={() => setView("categories")}
            />
          )}
          {view === "budgetGroups" && (
            <BudgetGroupsView
              budgetGroups={budgetGroups}
              categories={categories}
              transactions={transactions}
              onAdd={handleAddBudgetGroup}
              onRename={handleRenameBudgetGroup}
              onDelete={handleDeleteBudgetGroup}
              onSetBudget={handleSetBudgetGroupBudget}
              onAddCategory={handleAddCategoryToGroup}
              onRemoveCategory={handleRemoveCategoryFromGroup}
            />
          )}
          {view === "accounts" && (
            <AccountsView
              accounts={accounts}
              transactions={transactions}
              onDelete={handleDeleteAccount}
              onRename={handleRenameAccount}
              onUpdateSettings={handleUpdateAccountSettings}
              onAddTransactions={goToUpload}
              onGoUpload={goToUpload}
            />
          )}
          {view === "categories" && (
            <CategoriesView
              categories={categories}
              transactions={transactions}
              onAdd={handleAddCategory}
              onRename={handleRenameCategory}
              onDelete={handleDeleteCategory}
              onToggleExcluded={handleToggleCategoryExcluded}
              onToggleIsIncome={handleToggleCategoryIsIncome}
              onMerge={handleMergeCategory}
            />
          )}
          {view === "backup" && (
            <BackupView
              accounts={accounts}
              transactions={transactions}
              categories={categories}
              budgetGroups={budgetGroups}
              plannedIncome={plannedIncome}
              onRestore={handleRestoreFromBackup}
              onRestoreBudget={handleRestoreBudget}
            />
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {tutorialStep !== null && (
        <TutorialDialog
          step={tutorialStep}
          onBack={() => setTutorialStep((n) => Math.max(0, n - 1))}
          onNext={() => setTutorialStep((n) => Math.min(TUTORIAL_STEPS.length - 1, n + 1))}
          onSkip={() => {
            endTutorial();
            setView("overview");
          }}
          onFinish={endTutorial}
          onUpload={() => {
            endTutorial();
            setView("upload");
          }}
          showUpload={accounts.length === 0}
        />
      )}
    </div>
  );
}

export default App;
