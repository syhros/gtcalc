import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'
import { Telemetry } from './components/ConsentBanner'
import { AuthAction } from './lazy'

// No <StrictMode>: in development it renders everything twice, which made dragging a big
// canvas noticeably laggy under `npm run dev`. Production builds are unaffected either way.
// Links in account emails (password reset, email confirm) land on their own small page.
const authPage = location.pathname === '/auth/action'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {authPage ? <AuthAction /> : <App />}
    <Telemetry />
  </ErrorBoundary>
)
