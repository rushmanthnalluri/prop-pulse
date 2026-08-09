/** Router: Overview / Valuation / Market / Model Insights / Model Health /
 *  the guided ML Workbench (/workflow/*) inside the sidebar shell. Market (leaflet) and Model Insights (recharts)
 *  are lazy-loaded so the landing bundle stays small; every route is wrapped
 *  in a per-route ErrorBoundary so a failed chunk or a render-time contract
 *  drift never white-screens the app — including Layout itself and the
 *  catch-all (AUDIT §3.2 / §5.6). The ToastProvider sits inside the router,
 *  above Layout, so every page can useToast() (SPEC §7.3). */
import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import { PageSkeleton } from './components/StateView'
import OverviewPage from './pages/Overview'
import ValuationPage from './pages/Valuation'
import NotFoundPage from './pages/NotFound'

const MarketPage = lazy(() => import('./pages/Market'))
const ModelInsightsPage = lazy(() => import('./pages/ModelInsights'))
const HealthPage = lazy(() => import('./pages/Health'))
// Guided ML workbench (WORKFLOW §6.1): one lazy route group; the shell owns
// the stepper and lazily loads each stage page itself.
const WorkflowShell = lazy(() => import('./pages/workflow/WorkflowShell'))

const guarded = (element, key) => (
  <ErrorBoundary key={key}>
    <Suspense fallback={<PageSkeleton />}>{element}</Suspense>
  </ErrorBoundary>
)

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <ErrorBoundary>
        <ToastProvider>
          <Layout />
        </ToastProvider>
      </ErrorBoundary>
    ),
    children: [
      { index: true, element: <ErrorBoundary><OverviewPage /></ErrorBoundary> },
      { path: 'valuation', element: <ErrorBoundary><ValuationPage /></ErrorBoundary> },
      { path: 'market', element: guarded(<MarketPage />, 'market') },
      { path: 'model', element: guarded(<ModelInsightsPage />, 'model') },
      { path: 'health', element: guarded(<HealthPage />, 'health') },
      { path: 'workflow/*', element: guarded(<WorkflowShell />, 'workflow') },
      { path: '*', element: <ErrorBoundary><NotFoundPage /></ErrorBoundary> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
