import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, migrateWorkspace, type Workspace } from '@/model'
import { drawnWorkspace } from '@/test/fixtures'

describe('migrating a stored workspace (#75)', () => {
  it('leaves a current workspace exactly as it is', () => {
    const workspace = drawnWorkspace()
    expect(migrateWorkspace(workspace)).toBe(workspace)
  })

  it('moves schema-1 saved views to reports and starts views and folders empty', () => {
    const v1 = {
      id: 'ws',
      name: 'Old',
      schemaVersion: 1,
      elements: [],
      relationships: [],
      views: [{ id: 'r', name: 'Report', kind: 'graph' }],
      tagGroups: [],
    } as unknown as Workspace
    expect(migrateWorkspace(v1)).toEqual({
      id: 'ws',
      name: 'Old',
      schemaVersion: SCHEMA_VERSION,
      elements: [],
      relationships: [],
      views: [],
      folders: [],
      reports: [{ id: 'r', name: 'Report', kind: 'graph' }],
      tagGroups: [],
    })
  })
  it('moves a schema-2 workspace to the current version without touching its contents', () => {
    const v2 = { ...drawnWorkspace(), schemaVersion: 2 }
    expect(migrateWorkspace(v2)).toEqual({ ...v2, schemaVersion: SCHEMA_VERSION })
  })

  it('moves a schema-3 workspace to the current version without touching its contents', () => {
    const v3 = { ...drawnWorkspace(), schemaVersion: 3 }
    expect(migrateWorkspace(v3)).toEqual({ ...v3, schemaVersion: SCHEMA_VERSION })
  })

  it('moves a schema-4 workspace to the current version without touching its contents (#133)', () => {
    const v4 = { ...drawnWorkspace(), schemaVersion: 4 }
    expect(migrateWorkspace(v4)).toEqual({ ...v4, schemaVersion: SCHEMA_VERSION })
  })

  it('moves a schema-5 workspace to the current version without touching its contents (#209)', () => {
    const v5 = { ...drawnWorkspace(), schemaVersion: 5 }
    expect(migrateWorkspace(v5)).toEqual({ ...v5, schemaVersion: SCHEMA_VERSION })
  })

  it('moves a schema-6 workspace to the current version without touching its contents (#61)', () => {
    const v6 = { ...drawnWorkspace(), schemaVersion: 6 }
    expect(migrateWorkspace(v6)).toEqual({ ...v6, schemaVersion: SCHEMA_VERSION })
    expect(SCHEMA_VERSION).toBe(7)
  })
})
