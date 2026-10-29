import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModelStore } from '@/store'
import type * as Store from '@/store'
import { renderScreenAs } from '@/test/render'
import { rolloutWorkspace, siteId } from '@/test/rollout-fixture'
import { ElementScreen } from '@/ui/factsheet/ElementScreen'

/**
 * The Progress dialog's refusal (#215). Its inputs are a date field and two
 * selects, whose values the store's guards always accept, so no value typed
 * here reaches the refusal; the store's answer is faked to drive the branch
 * that shows it. What the store refuses is `rollouts.test.ts`'s.
 */

vi.mock('@/store', async (original) => ({
  ...(await original<typeof Store>()),
  setSiteProgress: vi.fn(() => false),
}))

describe('the Progress dialog when the model refuses (#215)', () => {
  it('stays open, says so, and keeps what was typed', async () => {
    const store = new ModelStore(rolloutWorkspace(8))
    renderScreenAs('writer', store, {
      route: `/element/${siteId(4)}?tab=migration`,
      path: '/element/:id',
      screen: <ElementScreen />,
    })
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Progress in Local data to the central lake' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Progress of 004' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'RAG' }), 'red')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Not saved: the model refused these values.',
    )
    expect(screen.getByRole('dialog', { name: 'Progress of 004' })).toBe(dialog)
    expect(within(dialog).getByRole('combobox', { name: 'RAG' })).toHaveValue('red')
    expect(store.history).toHaveLength(0)
  })
})
