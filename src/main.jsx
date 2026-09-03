import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './storageAdapter.js'
import AuthGate from './authGate.jsx'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <AuthGate>
    <App />
  </AuthGate>
)
