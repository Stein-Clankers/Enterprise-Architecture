import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ROLLOUT_DEMO_AS_OF, ROLLOUT_DEMO_ID } from '@/io'
import { supportsDirectoryAccess } from '@/io/shared-folder'
import { useFileWorkspace } from './context'
import './files.css'

/**
 * The first-run screen: **exactly three actions** (design brief, "Global UI
 * elements").
 *
 * Three is the point. An empty repository is the moment a tool either earns a
 * few more minutes or gets closed, and the answer to "what now?" has to fit on
 * one screen without a tour.
 *
 * "Explore the demo" is one of the three, and it offers two demos (#212): it
 * opens them as a disclosure beneath it rather than adding a fourth action.
 * The insurance demo opens on the inventory, wherever first run was shown;
 * the rollout demo opens on its rollout's home at the day it is planned as of
 * (`?at=`), so its pilot shows as under way whatever today is.
 */

export interface FirstRunProps {
  onStartEmpty: () => void
}

export function FirstRun({ onStartEmpty }: FirstRunProps) {
  const { startImport, loadDemo, canPickFiles } = useFileWorkspace()
  const navigate = useNavigate()
  const [choosingDemo, setChoosingDemo] = useState(false)

  return (
    <div className="first-run">
      <div className="first-run__inner">
        <span className="first-run__mark" aria-hidden="true" />
        <h1 className="first-run__title">Archipelago</h1>
        <p className="first-run__lead">
          An Enterprise Architecture repository that runs entirely in this browser. Nothing is
          uploaded anywhere; your model lives here and in the files you export.
        </p>

        <div className="first-run__actions">
          <button type="button" className="first-run__action" onClick={onStartEmpty}>
            <span className="first-run__action-title">Start empty</span>
            <span className="first-run__action-help">
              Begin with a blank workspace and add elements as you go.
            </span>
          </button>

          <button type="button" className="first-run__action" onClick={startImport}>
            <span className="first-run__action-title">Import a file</span>
            <span className="first-run__action-help">
              Canonical JSON, or ArchiMate exchange XML from Archi.
              {canPickFiles && ' Saves write back to the same file.'}
            </span>
          </button>

          <button
            type="button"
            className="first-run__action first-run__action--primary"
            aria-expanded={choosingDemo}
            aria-controls="first-run-demos"
            onClick={() => setChoosingDemo((open) => !open)}
          >
            <span className="first-run__action-title">Explore the demo</span>
            <span className="first-run__action-help">
              Two models to look around in: an insurance landscape, or a data-migration rollout
              across 160 sites.
            </span>
          </button>

          {choosingDemo && (
            <div id="first-run-demos" className="first-run__demos" role="group" aria-label="Demos">
              <button
                type="button"
                className="first-run__demo"
                onClick={() => {
                  navigate('/inventory')
                  loadDemo('archisurance')
                }}
              >
                <span className="first-run__action-title">Insurance landscape</span>
                <span className="first-run__action-help">29 elements, assessed and dated.</span>
              </button>
              <button
                type="button"
                className="first-run__demo"
                onClick={() => {
                  navigate(`/rollout/${ROLLOUT_DEMO_ID}?at=${ROLLOUT_DEMO_AS_OF}`)
                  loadDemo('rollout')
                }}
              >
                <span className="first-run__action-title">Data-migration rollout</span>
                <span className="first-run__action-help">
                  160 sites in 8 waves, with a few planning problems left in on purpose.
                </span>
              </button>
            </div>
          )}
        </div>

        <p className="first-run__note">
          {canPickFiles
            ? 'This browser can save straight into a folder on your machine — a git working copy, for instance.'
            : 'This browser saves by downloading a file. Chromium browsers can write back into a folder directly.'}
        </p>
        <p className="first-run__note">
          {supportsDirectoryAccess() ? (
            <>
              Working from a folder your team shares through OneDrive or SharePoint?{' '}
              <Link to="/folder">Open the shared folder</Link>: one person edits a model at a time,
              and everyone else sees it read-only.
            </>
          ) : (
            'Shared folders need a Chromium browser, such as Edge or Chrome: Firefox and Safari cannot write into a folder you pick.'
          )}
        </p>
        <p className="first-run__note">
          New to ArchiMate? <Link to="/guide">Read the guide</Link>: what each element and
          relationship means, and how to model with them.
        </p>
      </div>
    </div>
  )
}
