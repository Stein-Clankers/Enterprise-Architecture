import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyWorkspace } from '@/model'
import { exportExchangeXml, loadDemoWorkspace, ROLLOUT_DEMO_AS_OF, toCanonicalJson } from '@/io'
import { ModelStoreProvider } from '@/store'
import { pressOutside } from '@/test/dialogs'
import { stubDownloads } from '@/test/downloads'
import { unreadableFile } from '@/test/fixtures'
import { renderApp } from '@/test/render'
import { TakeoverScreen } from './TakeoverScreen'

function demo() {
  return loadDemoWorkspace()
}

let createObjectURL: ReturnType<typeof stubDownloads>['createObjectURL']

beforeEach(() => {
  createObjectURL = stubDownloads().createObjectURL
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('first run', () => {
  it('offers exactly three actions', () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    expect(screen.getByRole('heading', { name: 'Archipelago' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start empty/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import a file/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Explore the demo/ })).toBeInTheDocument()
    // Three, and no more: the empty state is not a place for a feature tour.
    expect(document.querySelectorAll('.first-run__action')).toHaveLength(3)
  })

  it('offers both demos under "Explore the demo", and only once it is opened (#212)', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    const explore = screen.getByRole('button', { name: /Explore the demo/ })
    expect(explore).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('button')).toHaveLength(3)

    await user.click(explore)
    expect(explore).toHaveAttribute('aria-expanded', 'true')
    const demos = screen.getByRole('group', { name: 'Demos' })
    expect(explore).toHaveAttribute('aria-controls', demos.id)
    expect(
      within(demos)
        .getAllByRole('button')
        .map((button) => button.querySelector('.first-run__action-title')?.textContent),
    ).toEqual(['Insurance landscape', 'Data-migration rollout'])
    // Still three actions: the demos are the third one's choices.
    expect(document.querySelectorAll('.first-run__action')).toHaveLength(3)

    await user.click(explore)
    expect(explore).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Demos' })).toBeNull()
  })

  it('loads the insurance demo onto the inventory', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Insurance landscape/ }))
    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
  })

  it('takes the insurance demo to the inventory from whatever route the app opened on (#212)', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'), { route: '/rollout/wp-rollout-site-data' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Insurance landscape/ }))
    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
  })

  it('loads the rollout demo onto its rollout’s home, unsaved (#212)', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Data-migration rollout/ }))
    expect(
      screen.getByRole('heading', { name: 'Site data to the regional lakes' }),
    ).toBeInTheDocument()
    expect(screen.getByText('160 sites · 8 waves · template v2')).toBeInTheDocument()
    expect(screen.getByText(`Phase at ${ROLLOUT_DEMO_AS_OF}`)).toBeInTheDocument()
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()
  })

  it('starts empty without inventing a workspace', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Start empty/ }))
    expect(screen.getByText('0 of 0 elements')).toBeInTheDocument()
    expect(screen.getByText('LOCAL · SAVED')).toBeInTheDocument()
  })

  it('opens the import dialog from the first-run screen', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Import a file/ }))
    expect(screen.getByRole('dialog', { name: 'Import' })).toBeInTheDocument()
  })

  it('says how this browser saves', () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    // jsdom has no File System Access API, which is the Firefox/Safari story.
    expect(screen.getByText(/saves by downloading a file/)).toBeInTheDocument()
  })
})

describe('import dialog', () => {
  async function openDialog() {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Import' }))
    return { user, dialog: screen.getByRole('dialog', { name: 'Import' }) }
  }

  it('imports canonical JSON, replaces the model and closes', async () => {
    const { user, dialog } = await openDialog()
    const replacement = { ...emptyWorkspace('ws-in', 'Imported'), elements: demo().elements }
    await user.upload(
      within(dialog).getByLabelText('Choose a file to import'),
      new File([toCanonicalJson(replacement)], 'other.json', { type: 'application/json' }),
    )

    // A clean import needs no report: the dialog closes and the model is there.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
  })

  it('imports exchange XML', async () => {
    const { user, dialog } = await openDialog()
    await user.upload(
      within(dialog).getByLabelText('Choose a file to import'),
      new File([exportExchangeXml(demo())], 'archisurance.xml', { type: 'application/xml' }),
    )
    await waitFor(() => expect(screen.getByText('29 of 29 elements')).toBeInTheDocument())
  })

  it('counts an import as unsaved, because no file on disk matches it yet', async () => {
    const { user, dialog } = await openDialog()
    await user.upload(
      within(dialog).getByLabelText('Choose a file to import'),
      new File([exportExchangeXml(demo())], 'archisurance.xml', { type: 'application/xml' }),
    )
    await waitFor(() => expect(screen.getByText(/LOCAL · \d+ UNSAVED/)).toBeInTheDocument())
  })

  it('reports what it skipped instead of dropping it silently', async () => {
    const { user, dialog } = await openDialog()
    const broken = exportExchangeXml(demo()).replace(
      /xsi:type="Capability"/g,
      'xsi:type="Microservice"',
    )
    await user.upload(
      within(dialog).getByLabelText('Choose a file to import'),
      new File([broken], 'broken.xml', { type: 'application/xml' }),
    )

    // The dialog stays open when there is something to say.
    const report = await waitFor(() => document.querySelector('.import-report') as HTMLElement)
    expect(within(report).getByText(/errors/)).toBeInTheDocument()
    expect(within(report).getAllByText('error').length).toBeGreaterThan(0)
    expect(within(report).getAllByText(/is not an ArchiMate 3.2 element type/).length).toBe(5)
    // …and the 24 elements it could read are in the model.
    expect(screen.getByText('24 of 24 elements')).toBeInTheDocument()
  })

  it('explains a file that is not a model at all', async () => {
    const { user, dialog } = await openDialog()
    // The picker's accept list already turns away a .txt, so this is the case
    // that actually reaches us: something named .json that is not JSON.
    await user.upload(
      within(dialog).getByLabelText('Choose a file to import'),
      new File(['hello'], 'notes.json', { type: 'application/json' }),
    )
    const report = await waitFor(() => document.querySelector('.import-report') as HTMLElement)
    expect(within(report).getByText(/Nothing could be read from that file/)).toBeInTheDocument()
    // The model that was already open is untouched.
    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
  })

  it('reports a file that cannot be read and gives the buttons back (#52)', async () => {
    const { user, dialog } = await openDialog()
    const input = within(dialog).getByLabelText<HTMLInputElement>('Choose a file to import')
    await user.upload(input, unreadableFile('synced.json'))

    const report = await waitFor(() => document.querySelector('.import-report') as HTMLElement)
    expect(
      within(report).getByText('The file could not be read: The file changed.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Choose a file…' })).toBeEnabled()
    // Cleared, or picking the same file again once the sync client is done
    // changes nothing, and a browser fires no `change` for it.
    expect(input.value).toBe('')

    // And the dialog still imports.
    await user.upload(
      input,
      new File([exportExchangeXml(demo())], 'archisurance.xml', { type: 'application/xml' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Import' })).not.toBeInTheDocument(),
    )
  })

  it('keeps focus inside the import dialog and gives it back on close', async () => {
    // `aria-modal="true"` is a promise: focus enters, focus stays, focus goes
    // back. None of it is statically detectable, which is why it keeps being
    // declared and not implemented — #24's menu and #25's palette both shipped
    // the attribute without the behaviour.
    renderApp(demo())
    const user = userEvent.setup()

    const opener = screen.getByRole('button', { name: 'Import' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Import' })
    expect(dialog.contains(document.activeElement)).toBe(true)

    // Behind this overlay sit SAVE FILE and Export. Tab must not reach them.
    for (let i = 0; i < 12; i += 1) await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Import' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const { user } = await openDialog()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Import' })).not.toBeInTheDocument()
  })

  it('closes on a press outside, and gives focus back to Import (#157)', async () => {
    const { user, dialog } = await openDialog()
    await pressOutside(user, dialog)
    expect(screen.queryByRole('dialog', { name: 'Import' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus()
  })
})

describe('saving', () => {
  it('downloads from the header, and leaves the unsaved count standing', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Element' }))
    await user.type(screen.getByLabelText(/Name/), 'New thing')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'SAVE FILE' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())

    // jsdom has no File System Access API, so this is the `downloaded` outcome:
    // a Blob URL and an anchor click, which report that a download was *offered*.
    // A user with "always ask where to save" on who presses Cancel has no file,
    // and `markSaved()` has no inverse, so a wrong SAVED here is permanent.
    // Only `saved` — which resolves after `writable.close()` — clears the count.
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()
    expect(screen.queryByText('LOCAL · SAVED')).not.toBeInTheDocument()
  })

  it('clears the unsaved count on a write it can watch finish', async () => {
    const written: string[] = []
    const close = vi.fn()
    const handle = {
      kind: 'file' as const,
      name: 'archisurance.json',
      createWritable: vi.fn(async () => ({
        write: async (data: string) => void written.push(data),
        close,
      })),
    }
    // `supportsFileSystemAccess()` requires both pickers, so stubbing one is
    // not enough to take the handle path.
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn(async () => handle),
    )
    vi.stubGlobal('showOpenFilePicker', vi.fn())

    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Element' }))
    await user.type(screen.getByLabelText(/Name/), 'New thing')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'SAVE FILE' }))

    // This is the distinction the whole indicator rests on: the handle path
    // resolves only after the stream is closed, so the bytes are on disk.
    await waitFor(() => expect(screen.getByText('LOCAL · SAVED')).toBeInTheDocument())
    expect(close).toHaveBeenCalled()
    expect(written.join('')).toContain('New thing')
  })

  it('writes back to the same file on the second save, with no second picker', async () => {
    // Issue #11's first acceptance criterion, and the whole reason the handle is
    // held: "save → edit → save writes to the same file without a picker". That
    // is what makes committing the JSON to git a workflow rather than a chore.
    const written: string[] = []
    const createWritable = vi.fn(async () => ({
      write: async (data: string) => void written.push(data),
      close: vi.fn(),
    }))
    const picker = vi.fn(async () => ({
      kind: 'file' as const,
      name: 'archisurance.json',
      createWritable,
    }))
    vi.stubGlobal('showSaveFilePicker', picker)
    vi.stubGlobal('showOpenFilePicker', vi.fn())

    renderApp(demo())
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'SAVE FILE' }))
    await waitFor(() => expect(screen.getByText('LOCAL · SAVED')).toBeInTheDocument())
    expect(picker).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '+ Element' }))
    await user.type(screen.getByLabelText(/Name/), 'Second thing')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'SAVE FILE' }))
    await waitFor(() => expect(screen.getByText('LOCAL · SAVED')).toBeInTheDocument())

    // Still one picker, two writes — the second went straight to the same file.
    expect(picker).toHaveBeenCalledTimes(1)
    expect(createWritable).toHaveBeenCalledTimes(2)
    expect(written.at(-1)).toContain('Second thing')
  })

  it('saves with ⌘S and with Ctrl+S', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.keyboard('{Meta>}s{/Meta}')
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2))
  })

  it('confirms where the file went, then gets out of the way', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'SAVE FILE' }))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/Downloaded archisurance\.json/)

    await user.click(screen.getByRole('button', { name: 'DISMISS' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('exports exchange XML from the header', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Export' }))
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/archisurance\.xml/)
  })
})

describe('second-tab takeover', () => {
  it('explains why the tab is read-only and offers to take over', async () => {
    render(
      <ModelStoreProvider initialWorkspace={demo()} ephemeral>
        <TakeoverScreen />
      </ModelStoreProvider>,
    )
    expect(
      screen.getByRole('heading', { name: 'This model is open in another tab' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/save over each other/)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Take over here' }))
    // No lock manager under jsdom, so this resolves immediately; what matters is
    // that the button is wired and does not throw.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Take over here/ })).toBeEnabled(),
    )
  })
})
