import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useModelSelector, useModelStoreContext } from '@/store'
import { AppShell } from '@/ui/shell/AppShell'
import { InventoryScreen } from '@/ui/inventory/InventoryScreen'
import { ElementScreen } from '@/ui/factsheet/ElementScreen'
import { ModelScreen } from '@/ui/factsheet/ModelScreen'
import { GraphScreen } from '@/ui/graph/GraphScreen'
import { ViewScreen } from '@/ui/views/ViewScreen'
import { RolloutScreen } from '@/ui/rollout/RolloutScreen'
import { RolloutsScreen } from '@/ui/rollout/RolloutsScreen'
import { GuideScreen } from '@/ui/guide/GuideScreen'
import { ValidatorScreen } from '@/ui/validator/ValidatorScreen'
import { ValidatorProvider } from '@/ui/validator/ValidatorProvider'
import { PaletteProvider } from '@/ui/palette/PaletteProvider'
import { FileWorkspaceProvider } from '@/ui/files/FileWorkspaceProvider'
import { GlobalShortcutsProvider } from '@/ui/shell/GlobalShortcutsProvider'
import { FirstRun } from '@/ui/files/FirstRun'
import { SharedFolderScreen } from '@/ui/files/SharedFolderScreen'
import { ImportDialog } from '@/ui/files/ImportDialog'
import { TakeoverScreen } from '@/ui/files/TakeoverScreen'
import { SaveNotice } from '@/ui/files/SaveNotice'
import { DivergedNotice, SharedSaveDialog } from '@/ui/files/SharedModelUi'

/**
 * `/element/:id` re-renders without remounting, so every piece of per-element
 * state the fact sheet holds — the `editing` flag, the uncontrolled inputs'
 * `defaultValue` — silently carried the previous element onto the next one, and
 * committed it on blur. Keying the route on the id makes that class of bug
 * impossible rather than something each new piece of state has to remember.
 */
function KeyedElementScreen() {
  const { id = '' } = useParams()
  return <ElementScreen key={id} />
}

/** Same reason as above: viewport and selection are per view. */
function KeyedViewScreen() {
  const { id = '' } = useParams()
  return <ViewScreen key={id} />
}

/**
 * Same reason again (#211): a rollout's filters, selection, picked-up card and
 * open dialog are all per rollout, so `/rollout/a` → `/rollout/b` remounts.
 */
function KeyedRolloutScreen() {
  const { id = '' } = useParams()
  return <RolloutScreen key={id} />
}

/**
 * Dev-only screens, absent from the production bundle: `import.meta.env.DEV` is
 * a build-time constant, so the lazy import is dropped with the dead branch.
 */
const NotationGallery = import.meta.env.DEV
  ? lazy(() => import('@/ui/notation/NotationGallery'))
  : null

export function App() {
  return (
    <GlobalShortcutsProvider>
      <FileWorkspaceProvider>
        <ValidatorProvider>
          <PaletteProvider>
            <AppRoutes />
            <ImportDialog />
            <SaveNotice />
            <SharedSaveDialog />
            <DivergedNotice />
          </PaletteProvider>
        </ValidatorProvider>
      </FileWorkspaceProvider>
    </GlobalShortcutsProvider>
  )
}

/**
 * Three states before the app proper: a tab that lost the writer lock, a browser
 * with nothing in it yet, and everything else.
 */
function AppRoutes() {
  const { tabRole, ready } = useModelStoreContext()
  const elementCount = useModelSelector((store) => store.elementCount)
  const [startedEmpty, setStartedEmpty] = useState(false)
  const { pathname } = useLocation()

  // The notation gallery needs no model, so it skips first run and the shell.
  if (NotationGallery && pathname === '/dev/notation') {
    return (
      <Suspense fallback={null}>
        <NotationGallery />
      </Suspense>
    )
  }
  if (tabRole === 'reader') return <TakeoverScreen />
  // The guide and the shared folder need no model, and first run links to
  // both, so they skip first run.
  const noModelNeeded = pathname === '/guide' || pathname === '/folder'
  if (ready && elementCount === 0 && !startedEmpty && !noModelNeeded) {
    return <FirstRun onStartEmpty={() => setStartedEmpty(true)} />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/inventory" replace />} />
        <Route path="/inventory" element={<InventoryScreen />} />
        <Route path="/element/:id" element={<KeyedElementScreen />} />
        <Route path="/model" element={<ModelScreen />} />
        <Route path="/graph" element={<GraphScreen />} />
        <Route path="/view/:id" element={<KeyedViewScreen />} />
        <Route path="/rollouts" element={<RolloutsScreen />} />
        <Route path="/rollout/:id" element={<KeyedRolloutScreen />} />
        <Route path="/validate" element={<ValidatorScreen />} />
        <Route path="/guide" element={<GuideScreen />} />
        <Route path="/folder" element={<SharedFolderScreen />} />
        <Route path="*" element={<Navigate to="/inventory" replace />} />
      </Route>
    </Routes>
  )
}
