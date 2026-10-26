import { test, expect, openApp } from './support'

/**
 * Journey 12 — opening a shared folder (#147, part 2), with real directory
 * handles.
 *
 * No automation can drive the native folder picker, so the picker is replaced
 * by the origin-private file system (`navigator.storage.getDirectory()`): the
 * same `FileSystemDirectoryHandle` API, from a real implementation. What jsdom
 * cannot show is checked here: a real handle lists its files, survives being
 * stored in IndexedDB, and is offered again after a reload without the picker.
 */

test('a shared folder lists its models, and is offered again after a reload (#147)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        // Init scripts run again on reload; the tab's session remembers that the
        // picker was used, so a second use fails the journey.
        if (sessionStorage.getItem('picked')) throw new Error('the picker was used again')
        sessionStorage.setItem('picked', 'yes')
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle('Architecture', { create: true })
      },
    })
  })
  await openApp(page, 'folder')

  // A library as OneDrive leaves it: two models, a lock, a log and a conflict copy.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle('Architecture', { create: true })
    for (const name of [
      'Landscape.json',
      'Landscape.json.lock',
      'Landscape-DESKTOP7.json',
      'Claims.json',
      '.archipelago-log-c1.jsonl',
    ]) {
      const file = await folder.getFileHandle(name, { create: true })
      const writable = await file.createWritable()
      await writable.write('{}')
      await writable.close()
    }
  })

  await page.getByRole('button', { name: 'Open folder…' }).click()
  const form = page.getByRole('form', { name: 'Your name on the lock' })
  await form.getByLabel(/Your name/).fill('Markus')
  await form.getByRole('button', { name: 'Continue' }).click()

  const models = page.getByRole('region', { name: 'Models in Architecture' })
  await expect(models.getByRole('listitem')).toHaveText([
    /^Claims\.json/,
    /^Landscape\.json/,
    /Landscape-DESKTOP7\.json may be a copy of Landscape\.json/,
  ])

  // After a reload the folder is offered again, from IndexedDB, without the picker.
  await page.reload()
  const before = page.getByRole('region', { name: 'Folders opened before' })
  await before.getByRole('button', { name: 'Open Architecture' }).click()
  await expect(models.getByRole('listitem')).toHaveCount(3)
  // The name was kept too: no second prompt. And nothing went wrong on the way.
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('picked'))).toBe('yes')
})

/**
 * Journey 13 — editing a model in a shared folder (#147, part 3), against real
 * handles: the lock is taken after the settle delay, a save writes the file,
 * a colleague's lock taking over makes this tab read-only within a heartbeat,
 * and its edits then go into a copy, never over the file. Playwright's clock
 * runs the settle delay and the heartbeat; the fingerprints are real.
 */
test('a model in a shared folder is locked, saved, lost to a colleague and saved as a copy (#147)', async ({
  page,
}) => {
  await page.clock.install()
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('Team', { create: true }),
    })
  })
  await openApp(page, 'folder')

  const files = {
    write: (name: string, text: string) =>
      page.evaluate(
        async ([file, content]) => {
          const folder = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('Team', { create: true })
          const writable = await (
            await folder.getFileHandle(file!, { create: true })
          ).createWritable()
          await writable.write(content!)
          await writable.close()
        },
        [name, text],
      ),
    read: (name: string) =>
      page.evaluate(async (file) => {
        const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('Team')
        try {
          return await (await (await folder.getFileHandle(file)).getFile()).text()
        } catch {
          return undefined
        }
      }, name),
    names: () =>
      page.evaluate(async () => {
        const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('Team')
        const names: string[] = []
        for await (const [name] of (
          folder as unknown as { entries(): AsyncIterable<[string]> }
        ).entries())
          names.push(name)
        return names.sort()
      }),
  }

  await files.write(
    'Landscape.json',
    JSON.stringify({
      schemaVersion: 6,
      id: 'ws-shared',
      name: 'Landscape',
      elements: [
        { id: 'ac-1', type: 'ApplicationComponent', name: 'Claims Engine', properties: {} },
      ],
      relationships: [],
      views: [],
      folders: [],
      reports: [],
      tagGroups: [],
    }),
  )

  await page.getByRole('button', { name: 'Open folder…' }).click()
  const form = page.getByRole('form', { name: 'Your name on the lock' })
  await form.getByLabel(/Your name/).fill('Markus')
  await form.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Open Landscape.json' }).click()

  const status = page.getByRole('region', { name: 'Shared model' }).getByRole('status')
  await expect(status).toContainText('Taking Landscape.json for editing')
  // The banner says "Taking" before the lock is written, and the settle delay
  // starts only once the write lands: running the clock any sooner passes the
  // delay before its timer exists, and the lock is never taken (seen on CI).
  await expect.poll(async () => (await files.read('Landscape.json.lock')) ?? '').toContain('Markus')
  await page.clock.runFor(11_000)
  await expect(status).toContainText('Editing Landscape.json in Team')
  expect(JSON.parse((await files.read('Landscape.json.lock'))!)).toMatchObject({
    displayName: 'Markus',
  })

  // A save goes through the guard into the folder.
  await page.getByRole('button', { name: '+ Element' }).click()
  await page.getByLabel(/Name/).fill('Fraud Detection')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'SAVE FILE' }).click()
  await expect(page.locator('.save-state__label')).toHaveText('LOCAL · SAVED')
  expect(await files.read('Landscape.json')).toContain('Fraud Detection')

  // Ana takes it over; within a heartbeat this tab is read-only.
  await page.getByRole('link', { name: /^Inventory/ }).click()
  await page.getByRole('button', { name: '+ Element' }).click()
  await page.getByLabel(/Name/).fill('Unsaved idea')
  await page.getByRole('button', { name: 'Create' }).click()
  await files.write(
    'Landscape.json.lock',
    JSON.stringify({
      appVersion: '0.2.0',
      displayName: 'Ana',
      heartbeatAt: '2026-10-07T08:00:00.000Z',
      heartbeatSeq: 0,
      schemaVersion: 1,
      since: '2026-10-07T08:00:00.000Z',
      token: 'ana-1',
    }),
  )
  await page.clock.runFor(61_000)
  await expect(status).toContainText('You no longer hold Landscape.json: Ana took it over')

  // Its edits go into a copy; the file Ana holds is not written.
  await page
    .getByRole('region', { name: 'Shared model' })
    .getByRole('button', { name: 'Save as copy' })
    .click()
  await expect(status).toContainText('(copy Markus')
  const copy = (await files.names()).find((name) => name.includes('(copy Markus'))
  expect(copy).toBeDefined()
  expect(await files.read(copy!)).toContain('Unsaved idea')
  expect(await files.read('Landscape.json')).not.toContain('Unsaved idea')
})

/**
 * Journey 14 — an unlock is logged under the profile's Web Lock (#165). Two
 * tabs of one profile share a log, and the Web Lock is what keeps their
 * appends apart. jsdom has no Web Locks, so the unit tests use a stand-in;
 * this runs the append against Chromium's own `navigator.locks`. The recording
 * calls the browser's method on the object it was called on, so a call that
 * loses its `this` fails here as it would without the recording.
 */
test('an unlock is written to the log under the profile’s Web Lock (#165)', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('Locked', { create: true }),
    })
    const requested: string[] = []
    Object.defineProperty(window, 'requestedLocks', { value: requested })
    const request = LockManager.prototype.request as (...args: unknown[]) => Promise<unknown>
    LockManager.prototype.request = function (this: LockManager, ...args: unknown[]) {
      requested.push(String(args[0]))
      return request.apply(this, args)
    } as typeof LockManager.prototype.request
  })
  await openApp(page, 'folder')

  const inFolder = {
    write: (name: string, text: string) =>
      page.evaluate(
        async ([file, content]) => {
          const folder = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('Locked', { create: true })
          const writable = await (
            await folder.getFileHandle(file!, { create: true })
          ).createWritable()
          await writable.write(content!)
          await writable.close()
        },
        [name, text],
      ),
    names: () =>
      page.evaluate(async () => {
        const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('Locked')
        const names: string[] = []
        for await (const [name] of (
          folder as unknown as { entries(): AsyncIterable<[string]> }
        ).entries())
          names.push(name)
        return names.sort()
      }),
    read: (name: string) =>
      page.evaluate(async (file) => {
        const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('Locked')
        return (await (await folder.getFileHandle(file)).getFile()).text()
      }, name),
  }

  await inFolder.write(
    'Landscape.json',
    JSON.stringify({
      schemaVersion: 3,
      id: 'ws-locked',
      name: 'Landscape',
      elements: [
        { id: 'ac-1', type: 'ApplicationComponent', name: 'Claims Engine', properties: {} },
      ],
      relationships: [],
      views: [],
      folders: [],
      reports: [],
      tagGroups: [],
    }),
  )
  await inFolder.write(
    'Landscape.json.lock',
    JSON.stringify({
      appVersion: '0.2.0',
      displayName: 'Ana',
      heartbeatAt: '2026-10-07T08:00:00.000Z',
      heartbeatSeq: 0,
      schemaVersion: 1,
      since: '2026-10-07T08:00:00.000Z',
      token: 'ana-1',
    }),
  )

  await page.getByRole('button', { name: 'Open folder…' }).click()
  const form = page.getByRole('form', { name: 'Your name on the lock' })
  await form.getByLabel(/Your name/).fill('Markus')
  await form.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Open Landscape.json' }).click()

  const banner = page.getByRole('region', { name: 'Shared model' })
  await expect(banner.getByRole('status')).toContainText('Ana is editing it')
  await banner.getByRole('button', { name: 'Unlock…' }).click()
  await banner.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(banner.getByRole('button', { name: 'Edit' })).toBeVisible()

  const names = await inFolder.names()
  expect(names).toContain('Landscape.json')
  expect(names).not.toContain('Landscape.json.lock')
  const log = names.find((name) => name.startsWith('.archipelago-log-'))
  expect(log).toBeDefined()
  expect(JSON.parse((await inFolder.read(log!)).trim())).toMatchObject({
    action: 'unlock',
    displayName: 'Markus',
    model: 'Landscape.json',
    previousOwner: 'Ana',
  })
  expect(
    await page.evaluate(() => (window as unknown as { requestedLocks: string[] }).requestedLocks),
  ).toContain('archipelago.audit-log')
})
