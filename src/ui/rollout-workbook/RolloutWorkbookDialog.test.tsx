import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { rolloutPlanOf, type Workspace } from '@/model'
import { toCanonicalJson } from '@/io'
import { exportRolloutWorkbook } from '@/io/rollout-workbook'
import { readXlsx } from '@/io/xlsx-read'
import { writeXlsx } from '@/io/xlsx-write'
import { EMPTY, textCell, numberCell, type Cell, type Workbook } from '@/io/xlsx'
import { useLayoutEffect } from 'react'
import { ModelStore, useModelStoreContext, type TabRole } from '@/store'
import { pressOutside } from '@/test/dialogs'
import { stubDownloads } from '@/test/downloads'
import { smallWorkspace } from '@/test/fixtures'
import { renderApp, renderScreenAs } from '@/test/render'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import type * as StoreRolloutWorkbook from '@/store/rollout-workbook'
import { useRolloutWorkbook } from './use-rollout-workbook'

/**
 * The rollout workbook's palette entries and dialog (#210). The screen here is
 * the hook `PaletteProvider` calls, its actions as buttons, so the role is in
 * the test's hands (`renderScreenAs`); one test goes through the real palette.
 */

/** What the store's apply returns, when a test forces it; otherwise the real one runs. */
const forced = vi.hoisted(() => ({ outcome: undefined as string | undefined }))
vi.mock('@/store/rollout-workbook', async (importOriginal) => {
  const actual = await importOriginal<typeof StoreRolloutWorkbook>()
  return {
    ...actual,
    applyRolloutImport: (...args: Parameters<typeof actual.applyRolloutImport>) =>
      forced.outcome ?? actual.applyRolloutImport(...args),
  }
})

function Harness() {
  const { actions, dialog } = useRolloutWorkbook()
  return (
    <>
      {actions.map((action) => (
        <button key={action.id} type="button" onClick={action.run}>
          {action.label}
        </button>
      ))}
      {dialog}
    </>
  )
}

const SITES = 8

/** The fixture with no actual dates or notes, so its export has nothing to report. */
function plainRollout(): Workspace {
  const model = rolloutWorkspace(SITES)
  for (const site of rolloutPlanOf(model.elements.find((e) => e.id === ROLLOUT_ID))!.sites) {
    delete site.actuals
    delete site.notes
  }
  return model
}

function open(role: TabRole, model: Workspace = plainRollout()) {
  const store = new ModelStore(model)
  const view = renderScreenAs(role, store, { route: '/', path: '/', screen: <Harness /> })
  return { store, view, user: userEvent.setup() }
}

const dialogNamed = (name: string) => screen.getByRole('dialog', { name })
const importDialog = () => dialogNamed('Import rollout workbook')
const exportDialog = () => dialogNamed('Export rollout workbook')

/** Set a cell of an exported workbook, found by the row's id and the column's key. */
function edit(workbook: Workbook, sheet: string, id: string, key: string, cell: Cell): void {
  const rows = workbook.sheets.find((s) => s.name === sheet)!.rows
  const column = rows[0]!.findIndex((c) => c.kind === 'string' && c.value === key)
  const row = rows.find((r) => r[0]?.kind === 'string' && r[0].value === id)!
  while (row.length <= column) row.push(EMPTY)
  row[column] = cell
}

function workbookFile(workbook: Workbook, name = 'rollout.xlsx'): File {
  return new File([writeXlsx(workbook)], name)
}

function exported(model: Workspace = plainRollout()): Workbook {
  return exportRolloutWorkbook(model, ROLLOUT_ID)!.workbook
}

/** Open the import dialog and choose `file`; resolves once the preview is up. */
async function preview(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.click(screen.getByRole('button', { name: 'Import rollout workbook…' }))
  await user.upload(within(importDialog()).getByLabelText('Choose a workbook to import'), file)
  await screen.findByText(/to change|Nothing could be read/)
}

const count = (key: string) =>
  within(importDialog()).getByRole('table').querySelector(`[data-count="${key}"]`)!.textContent

describe('the palette offers the workbook (#210)', () => {
  it('through the real palette: both entries, and the import opens its dialog', async () => {
    renderApp(plainRollout())
    const user = userEvent.setup()
    await user.keyboard('{Meta>}k{/Meta}')
    await user.keyboard('rollout workbook')
    const palette = screen.getByRole('dialog', { name: 'Command palette' })
    expect(within(palette).getByText('Export rollout workbook…')).toBeInTheDocument()
    await user.click(within(palette).getByText('Import rollout workbook…'))
    expect(importDialog()).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
  })

  it('offers a reader the export only', () => {
    open('reader')
    expect(screen.getByRole('button', { name: 'Export rollout workbook…' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Import rollout workbook…' }),
    ).not.toBeInTheDocument()
  })

  it('says when the model has no rollout', async () => {
    const { user } = open('writer', smallWorkspace())
    await user.click(screen.getByRole('button', { name: 'Export rollout workbook…' }))
    expect(exportDialog()).toHaveTextContent('This model has no rollout yet.')
    await user.click(within(exportDialog()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('exporting', () => {
  it('downloads the workbook through the download path, closes, and gives focus back', async () => {
    const downloads = stubDownloads()
    const { user } = open('writer')
    const opener = screen.getByRole('button', { name: 'Export rollout workbook…' })
    await user.click(opener)
    await user.click(within(exportDialog()).getByRole('button', { name: 'Export workbook' }))

    expect(downloads.click).toHaveBeenCalledTimes(1)
    const blob = downloads.createObjectURL.mock.calls[0]![0] as Blob
    const read = await readXlsx(new Uint8Array(await blob.arrayBuffer()))
    expect(read.workbook!.sheets.map((sheet) => sheet.name)).toEqual([
      'Sites',
      'Waves',
      'SitePlan',
      'Milestones',
      'Template',
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('stays open to say what the workbook cannot carry', async () => {
    const downloads = stubDownloads()
    const { user } = open('writer', rolloutWorkspace(SITES))
    await user.click(screen.getByRole('button', { name: 'Export rollout workbook…' }))
    await user.click(within(exportDialog()).getByRole('button', { name: 'Export workbook' }))
    expect(downloads.click).toHaveBeenCalledTimes(1)
    expect(exportDialog()).toHaveTextContent(
      'Downloaded local-data-to-the-central-lake-workbook.xlsx',
    )
    expect(exportDialog()).toHaveTextContent('2 sites have actual dates or notes')
    await user.click(within(exportDialog()).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('downloads nothing and says why when Excel could not hold the workbook', async () => {
    const downloads = stubDownloads()
    const model = plainRollout()
    model.elements.find((e) => e.id === siteId(1))!.name = 'x'.repeat(40_000)
    const { user } = open('writer', model)
    await user.click(screen.getByRole('button', { name: 'Export rollout workbook…' }))
    await user.click(within(exportDialog()).getByRole('button', { name: 'Export workbook' }))
    expect(exportDialog()).toHaveTextContent('Nothing was downloaded.')
    expect(exportDialog()).toHaveTextContent('more than Excel’s 32767')
    expect(downloads.click).not.toHaveBeenCalled()
  })

  it('exports the rollout chosen, when the model has two', async () => {
    const downloads = stubDownloads()
    const model = plainRollout()
    model.elements.push({
      id: 'wp-network',
      type: 'WorkPackage',
      name: 'A network refresh',
      properties: {},
      plan: {
        kind: 'rollout',
        templateVersion: 1,
        milestones: [],
        template: [],
        archetypes: [],
        sites: [],
      },
    })
    const { user } = open('writer', model)
    await user.click(screen.getByRole('button', { name: 'Export rollout workbook…' }))
    const select = within(exportDialog()).getByRole('combobox', { name: 'Rollout' })
    // By name: the network refresh sorts first.
    expect(select).toHaveValue('wp-network')
    await user.selectOptions(select, ROLLOUT_ID)
    await user.click(within(exportDialog()).getByRole('button', { name: 'Export workbook' }))
    expect(downloads.click).toHaveBeenCalledTimes(1)
    const anchor = downloads.click.mock.contexts[0] as HTMLAnchorElement
    expect(anchor.download).toBe('local-data-to-the-central-lake-workbook.xlsx')
  })
})

describe('importing', () => {
  it('previews the counts, applies them as one step, closes, and gives focus back', async () => {
    const { user, store } = open('writer')
    const before = toCanonicalJson(store.snapshot())
    const workbook = exported()
    edit(workbook, 'Sites', siteId(5), 'name', textCell('Site 005, Linz'))
    edit(workbook, 'Waves', waveId(2), 'capacity', numberCell(30))
    edit(workbook, 'SitePlan', siteId(8), 'milestone.freezeStart', textCell('2027-Q3'))
    const opener = screen.getByRole('button', { name: 'Import rollout workbook…' })
    await preview(user, workbookFile(workbook))

    expect(importDialog()).toHaveTextContent('3 rows to change')
    expect([count('sites.updated'), count('waves.updated'), count('sitePlans.updated')]).toEqual([
      '1',
      '1',
      '1',
    ])
    expect(count('sites.unchanged')).toBe(String(SITES - 1))
    expect(count('sites.created')).toBe('0')
    expect(within(importDialog()).getByText('rollout.xlsx')).toBeInTheDocument()
    // Nothing has changed yet.
    expect(toCanonicalJson(store.snapshot())).toBe(before)

    await user.click(within(importDialog()).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(store.element(siteId(5))!.name).toBe('Site 005, Linz')
    expect(store.history).toHaveLength(1)
    act(() => void store.undo())
    expect(toCanonicalJson(store.snapshot())).toBe(before)
  })

  it('lists what it cannot apply, naming sheet, row and column', async () => {
    const { user, store } = open('writer')
    const workbook = exported()
    edit(workbook, 'SitePlan', siteId(4), 'wave', textCell('wp-wave-99'))
    edit(workbook, 'SitePlan', siteId(4), 'rag', textCell('red'))
    await preview(user, workbookFile(workbook))
    expect(importDialog()).toHaveTextContent(
      'Sheet “SitePlan”, row 6, column wave (C6): "wp-wave-99" is not a wave of this rollout',
    )
    expect(importDialog()).toHaveTextContent('1 error')
    await user.click(within(importDialog()).getByRole('button', { name: 'Apply' }))
    const site = rolloutPlanOf(store.element(ROLLOUT_ID))!.sites.find(
      (s) => s.location === siteId(4),
    )!
    // The wave it had; the RAG the same row also changed is applied.
    expect(site).toMatchObject({ rag: 'red', wave: waveId(1) })
  })

  it('cancels with nothing changed, and gives focus back', async () => {
    const { user, store } = open('writer')
    const workbook = exported()
    edit(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    const opener = screen.getByRole('button', { name: 'Import rollout workbook…' })
    await preview(user, workbookFile(workbook))
    await user.click(within(importDialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(store.history).toHaveLength(0)
  })

  it('closes on Escape and on a press outside, with nothing changed', async () => {
    const { user, store } = open('writer')
    const opener = screen.getByRole('button', { name: 'Import rollout workbook…' })
    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(opener)
    await pressOutside(user, importDialog())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(store.history).toHaveLength(0)
  })

  it('a workbook that changes nothing applies as nothing and closes', async () => {
    const { user, store } = open('writer')
    await preview(user, workbookFile(exported()))
    expect(importDialog()).toHaveTextContent('0 rows to change')
    await user.click(within(importDialog()).getByRole('button', { name: 'Apply' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store.history).toHaveLength(0)
  })

  it('a file that is not a workbook is reported, with nothing to apply', async () => {
    const { user } = open('writer')
    // Named .xlsx, as a CSV renamed by hand is: the picker offers only .xlsx.
    await preview(user, new File(['id,name\n1,Vienna\n'], 'sites.xlsx'))
    expect(importDialog()).toHaveTextContent('Nothing could be read from that file.')
    expect(importDialog()).toHaveTextContent('not a readable .xlsx archive')
    expect(within(importDialog()).queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('refuses a preview the model has moved past, and says so', async () => {
    const { user, store } = open('writer')
    const workbook = exported()
    edit(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    await preview(user, workbookFile(workbook))
    act(() => void store.updateElement(siteId(5), (e) => ({ ...e, name: 'Changed meanwhile' })))
    await user.click(within(importDialog()).getByRole('button', { name: 'Apply' }))
    expect(within(importDialog()).getByRole('alert')).toHaveTextContent(
      'The model changed after this preview',
    )
    expect(store.element(siteId(5))!.name).toBe('Changed meanwhile')
    expect(store.history).toHaveLength(1)
    expect(within(importDialog()).queryByRole('table')).toBeNull()
  })

  it('says so when the store refuses the plan as invalid', async () => {
    const { user } = open('writer')
    const workbook = exported()
    edit(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    await preview(user, workbookFile(workbook))
    forced.outcome = 'invalid'
    try {
      await user.click(within(importDialog()).getByRole('button', { name: 'Apply' }))
    } finally {
      forced.outcome = undefined
    }
    expect(within(importDialog()).getByRole('alert')).toHaveTextContent(
      'would store a plan the model does not accept',
    )
  })

  it('a preview is of one rollout: choosing another clears it', async () => {
    const model = plainRollout()
    model.elements.push({
      id: 'wp-network',
      type: 'WorkPackage',
      name: 'Network refresh',
      properties: {},
      plan: {
        kind: 'rollout',
        templateVersion: 1,
        milestones: [],
        template: [],
        archetypes: [],
        sites: [],
      },
    })
    const { user } = open('writer', model)
    await preview(user, workbookFile(exported(model)))
    expect(within(importDialog()).getByRole('table')).toBeInTheDocument()
    await user.selectOptions(
      within(importDialog()).getByRole('combobox', { name: 'Rollout' }),
      'wp-network',
    )
    expect(within(importDialog()).queryByRole('table')).toBeNull()
  })
})

describe('as a reader (CLAUDE.md)', () => {
  it('the import dialog ends when the tab becomes a reader, and does not come back', async () => {
    const { user, store, view } = open('writer')
    const workbook = exported()
    edit(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    await preview(user, workbookFile(workbook))
    expect(within(importDialog()).getByRole('button', { name: 'Apply' })).toBeInTheDocument()

    view.as('reader')
    expect(screen.getByRole('button', { name: 'Export rollout workbook…' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.as('writer')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Import rollout workbook…' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(store.element(siteId(5))!.name).toBe('Site 005')
  })

  it('the import dialog is off screen in the very commit that makes the tab a reader', async () => {
    // What a component sees as that commit lands, before any effect can close
    // the dialog: a refused save's dialog takes focus there (TakesFocusAsReader).
    const seen: (Element | null)[] = []
    function LooksAsReader() {
      const { role } = useModelStoreContext()
      useLayoutEffect(() => {
        if (role === 'reader') seen.push(document.querySelector('[role="dialog"]'))
      }, [role])
      return null
    }
    const store = new ModelStore(plainRollout())
    const view = renderScreenAs('writer', store, {
      route: '/',
      path: '/',
      screen: (
        <>
          <Harness />
          <LooksAsReader />
        </>
      ),
    })
    const user = userEvent.setup()
    await preview(user, workbookFile(exported()))
    view.as('reader')
    expect(seen).toEqual([null])
  })

  it('the export dialog, which only reads, stays open', async () => {
    const { user, view } = open('writer')
    await user.click(screen.getByRole('button', { name: 'Export rollout workbook…' }))
    view.as('reader')
    expect(exportDialog()).toBeInTheDocument()
  })
})
