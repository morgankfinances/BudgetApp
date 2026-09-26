import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from "./monitoring.jsx";
import './index.css'
import './storageAdapter.js'
import AuthGate from './authGate.jsx'
import DisclosureGate from './disclosureGate.jsx'
import HouseholdGate from './householdGate.jsx'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthGate>
        <DisclosureGate>
          <HouseholdGate>
            <App />
          </HouseholdGate>
        </DisclosureGate>
      </AuthGate>
    </AppErrorBoundary>
  </StrictMode>,
)
