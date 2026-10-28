import { createContext, useContext } from 'react'
import type { DemoId, ExportFormat, ImportResult, SaveOutcome } from '@/io'
import type { SharedModel } from './use-shared-model'

export interface FileWorkspaceContextValue {
  /** Name of the file this workspace is bound to, if any. */
  fileName: string | undefined
  /** True when saving writes back to the same file without a picker. */
  hasHandle: boolean
  /** False on Firefox and Safari, where saving is a download. */
  canPickFiles: boolean
  importing: boolean
  lastImport: ImportResult | undefined
  notice: string | undefined
  save: (format?: ExportFormat, options?: { reuseHandle?: boolean }) => Promise<SaveOutcome>
  openFile: () => Promise<void>
  /** Never rejects on a file it cannot read: that is reported in `lastImport` (#52). */
  importFile: (file: File) => Promise<void>
  /** Replace the workspace with a bundled demo, unsaved. */
  loadDemo: (demo: DemoId) => void
  startImport: () => void
  cancelImport: () => void
  dismissNotice: () => void
  /** The model opened from a shared folder, if any (#147). */
  shared: SharedModel
}

export const FileWorkspaceContext = createContext<FileWorkspaceContextValue | null>(null)

export function useFileWorkspace(): FileWorkspaceContextValue {
  const value = useContext(FileWorkspaceContext)
  if (!value) throw new Error('useFileWorkspace must be used inside <FileWorkspaceProvider>')
  return value
}
