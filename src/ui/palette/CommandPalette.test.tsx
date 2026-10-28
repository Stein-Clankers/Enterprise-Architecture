import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyWorkspace } from '@/model'
import { loadDemoWorkspace } from '@/io'
import { pressOutside } from '@/test/dialogs'
import { stubDownloads } from '@/test/downloads'
import { renderApp } from '@/test/render'
import { applyTheme } from '@/app/theme'
import { isTypingTarget } from './typing-target'

function demo() {
  return loadDemoWorkspace()
}

beforeEach(() => {
  applyTheme('light')
})

/** The palette's own input. Queried by label: the inventory adds more inputs,
 * and the palette's is a `combobox` rather than a `textbox` since it gained
 * `aria-activedescendant`, so neither role alone stays unambiguous. */
function paletteInput() {
  return screen.getByLabelText('Jump to element, run an action')
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Meta>}k{/Meta}')
  return screen.getByRole('dialog', { name: 'Command palette' })
}

describe('opening and closing', () => {
  it('opens from the header search button', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Search elements, relations, actions/ }))
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it('opens with ⌘K and with Ctrl+K', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('clears the query on reopen', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('claim')
    expect(paletteInput()).toHaveValue('claim')

    await user.keyboard('{Escape}')
    await openPalette(user)
    expect(paletteInput()).toHaveValue('')
  })

  it('closes on a press on the backdrop, and gives focus back to what opened it (#157)', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    const search = screen.getByRole('button', { name: /Search elements, relations, actions/ })
    await user.click(search)
    await pressOutside(user, screen.getByRole('dialog', { name: 'Command palette' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(search).toHaveFocus()
  })

  it('autofocuses the input', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    expect(paletteInput()).toHaveFocus()
  })
})

describe('searching', () => {
  it('lists every element until a query narrows it', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    expect(screen.getByText('29 elements indexed')).toBeInTheDocument()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(29) // elements + actions

    await user.keyboard('claim')
    const names = screen.getAllByRole('option').map((row) => row.textContent ?? '')
    expect(names.some((name) => name.includes('Claim Handling'))).toBe(true)
    expect(names.some((name) => name.includes('Payment Gateway'))).toBe(false)
  })

  it('matches on type as well as name', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('data object')
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBe(4)
    expect(rows.every((row) => row.textContent?.includes('Data Object'))).toBe(true)
  })

  it('is case insensitive', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('CRM')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('CRM System')
  })

  it('says so when nothing matches', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('zzzz')
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
  })

  it('shows the type code badge and type name on each element row', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('CRM System')
    const row = screen.getAllByRole('option')[0]!
    expect(within(row).getByText('AC')).toBeInTheDocument()
    expect(within(row).getByText('Application Component')).toBeInTheDocument()
  })
})

describe('running a result', () => {
  it('opens the top hit on Enter', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('CRM System{Enter}')
    expect(screen.getByRole('heading', { name: 'CRM System' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a hit on click', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('Payment Gateway')
    await user.click(screen.getAllByRole('option')[0]!)
    expect(screen.getByRole('heading', { name: 'Payment Gateway' })).toBeInTheDocument()
  })

  it('walks the list with the arrow keys', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('policy')

    const before = screen.getAllByRole('option')
    expect(before[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    // Wraps to the end rather than sticking at the top.
    const rows = screen.getAllByRole('option')
    expect(rows.at(-1)).toHaveAttribute('aria-selected', 'true')
  })

  it('offers actions below the element hits', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('graph')
    const action = screen.getByRole('option', { name: /Go to graph/ })
    await user.click(action)
    expect(screen.getByRole('heading', { name: 'Dependency graph' })).toBeInTheDocument()
  })

  it('runs the theme action', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('toggle theme')
    await user.click(screen.getByRole('option', { name: /Toggle theme/ }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('runs Save file through the one save owner, which does not clear the counter', async () => {
    const { createObjectURL } = stubDownloads()

    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Insurance landscape/ }))
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()

    await openPalette(user)
    await user.keyboard('save file')
    await user.click(screen.getByRole('option', { name: /Save file/ }))

    // The action used to inline the download and `markSaved()` — the header's
    // defect, copy-pasted. Both now call `useSaveWorkspace`, which is where the
    // reader guard lives too (covered in use-save-workspace.test.tsx).
    expect(createObjectURL).toHaveBeenCalled()
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()
  })
})

describe('the keyboard flow the palette is named for', () => {
  it('goes open → type → arrow → Enter → fact sheet', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)

    // The whole chain in one test. The halves each passed on their own, which is
    // how a flow that breaks the moment focus moves was reported as working.
    await user.keyboard('policy')
    await user.keyboard('{ArrowDown}')
    const selected = screen.getAllByRole('option')[1]!
    const name = selected.querySelector('.palette__name')?.textContent ?? ''
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name })).toBeInTheDocument()
  })

  it('survives a Tab press: focus stays in the dialog and arrows still work', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('policy')

    // Tab used to land on row 0 — where arrows did nothing and the highlight and
    // the focus ring pointed at different rows — or walk out onto the chrome
    // behind the overlay, where Enter downloaded a file nobody asked for.
    await user.tab()
    expect(paletteInput()).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the rows out of the tab order', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('policy')

    // The behavioural half of this is the Tab test above; this is the structural
    // half. An `option` inside the combobox pattern is pointed at by
    // `aria-activedescendant`, never focused, so being a tab stop is wrong even
    // when the trap makes it unreachable.
    for (const row of screen.getAllByRole('option')) {
      expect(row).toHaveAttribute('tabindex', '-1')
    }
  })

  it('stays operable after a click on the footer', async () => {
    const { container } = renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('policy')

    await user.click(container.ownerDocument.querySelector('.palette__footer') as Element)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('gives focus back to whatever opened it', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    const search = screen.getByRole('button', { name: /Search elements, relations, actions/ })

    await user.click(search)
    await user.keyboard('{Escape}')

    // Escape used to unmount the input and leave focus on <body>.
    expect(search).toHaveFocus()
  })

  it('announces the highlighted row through aria-activedescendant', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('policy')

    const input = paletteInput()
    const rows = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', rows[0]!.id)

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', rows[1]!.id)
    expect(rows[1]!.id).not.toBe(rows[0]!.id)
  })

  it('ignores a mousemove from a pointer that did not move', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('policy')
    await user.keyboard('{ArrowDown}')

    const rows = screen.getAllByRole('option')
    // Arrowing scrolls rows under a stationary cursor; the mousemove that
    // produces carries the same coordinates as the last one, and used to hand
    // the selection to whichever row had slid under the pointer.
    fireEvent.mouseMove(rows[0]!, { clientX: 40, clientY: 40 })
    fireEvent.mouseMove(rows[2]!, { clientX: 40, clientY: 40 })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    // A pointer that really moves still picks a row.
    fireEvent.mouseMove(rows[2]!, { clientX: 41, clientY: 44 })
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
  })
})

describe('single-letter shortcuts', () => {
  it('jumps to the graph and back with g and i', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.keyboard('g')
    expect(screen.getByRole('heading', { name: 'Dependency graph' })).toBeInTheDocument()
    await user.keyboard('i')
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
  })

  it('does not navigate while the palette is open', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await openPalette(user)
    await user.keyboard('g')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(paletteInput()).toHaveValue('g')
  })

  it('does not navigate while a text input has focus — the prototype gap', async () => {
    // A text field outside the palette: typing "graph" in it must not navigate.
    renderApp(demo())
    const user = userEvent.setup()
    const input = document.createElement('input')
    input.type = 'text'
    document.body.append(input)
    input.focus()

    await user.keyboard('graph')
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
    expect(input.value).toBe('graph')
    input.remove()
  })

  it('ignores modified keystrokes', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.keyboard('{Meta>}g{/Meta}')
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
  })
})

describe('isTypingTarget', () => {
  it('recognises the elements that swallow letters', () => {
    const text = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    const range = document.createElement('input')
    range.type = 'range'
    // jsdom does not implement isContentEditable, so it is defined here directly.
    const editable = document.createElement('div')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    const button = document.createElement('button')

    expect(isTypingTarget(text)).toBe(true)
    expect(isTypingTarget(textarea)).toBe(true)
    expect(isTypingTarget(select)).toBe(true)
    expect(isTypingTarget(editable)).toBe(true)
    expect(isTypingTarget(checkbox)).toBe(false)
    expect(isTypingTarget(range)).toBe(false)
    expect(isTypingTarget(button)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
