import { SCHEMA_VERSION, type Workspace } from './workspace'

/**
 * Bring a workspace written by an earlier build up to the current shape.
 *
 * This is for workspaces that arrive as objects rather than text — the
 * IndexedDB snapshots an earlier build stored. Files go through the canonical
 * JSON reader, which validates every field and migrates on the way in; a
 * snapshot was written by our own code and is trusted to have the shape its
 * `schemaVersion` says.
 *
 * - **1 → 2** (#75): `views` held saved report definitions. They move to
 *   `reports`, and `views` now holds hand-drawn diagrams, of which a v1
 *   workspace has none. Folders are new.
 * - **2 → 3** (#84): only the version moves. Relationships gained optional
 *   `isDirected` and `modifier`, which a schema-2 workspace never has.
 * - **3 → 4** (#95): only the version moves. Relationships and the workspace
 *   gained an optional `documentation`, which a schema-3 workspace never has.
 * - **4 → 5** (#133): only the version moves. Views gained an optional
 *   `router`, and a connection's appearance an optional `labelPosition`.
 * - **5 → 6** (#209): only the version moves. Elements gained an optional
 *   `plan`, which a schema-5 workspace never has.
 * - **6 → 7** (#61): only the version moves. A plan gained the kind
 *   `initiative`, which a schema-6 workspace never has.
 */
export function migrateWorkspace(stored: Workspace): Workspace {
  const version = stored.schemaVersion || SCHEMA_VERSION
  if (version >= SCHEMA_VERSION) return stored
  if (version >= 2) return { ...stored, schemaVersion: SCHEMA_VERSION }
  const legacy = stored as unknown as LegacyV1
  return {
    ...stored,
    schemaVersion: SCHEMA_VERSION,
    reports: legacy.views ?? [],
    views: [],
    folders: [],
  }
}

interface LegacyV1 {
  views?: Workspace['reports']
}
