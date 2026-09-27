import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from "./monitoring.jsx";
import './index.css'
import './storageAdapter.js'
import AuthGate from './authGate.jsx'
import DisclosureGate from './disclosureGate.jsx'
import HouseholdGate, { LoadingIndicator } from './householdGate.jsx'

// The app itself (every page, the charts) is only needed after sign-in, so
// it's downloaded separately: the sign-in page loads without it.
const loadApp = () => import('./App.jsx')
const App = lazy(loadApp)

// Someone who's already signed in will need it right away, so start the
// download now, alongside the sign-in and household checks.
try {
  if (Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))) loadApp()
} catch (e) {
  /* storage unavailable: it just loads after sign-in instead */
}

// HouseholdGate hands the household's name to what it wraps, so this passes
// it (and anything else) through to the app once it has loaded.
function LazyApp(props) {
  return (
    <Suspense fallback={<AppLoading />}>
      <App {...props} />
    </Suspense>
  )
}

function AppLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <LoadingIndicator label="Loading your ledger…" />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate>
        <DisclosureGate>
          <HouseholdGate>
            <LazyApp />
          </HouseholdGate>
        </DisclosureGate>
      </AuthGate>
    </AppErrorBoundary>
  </StrictMode>,
)
