import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { rolloutPlanOf, wavesOf } from '@/model'
import { useModelSelector, useModelStoreContext } from '@/store'
import { NewRolloutDialog } from './RolloutDialogs'
import { rolloutsOf } from './rollout-data'
import '@/ui/inventory/inventory.css'
import './rollout.css'

/**
 * Every rollout in the model (#211): the nav's entry to the rollout screens.
 * A row opens the rollout's home; + Rollout makes a new one.
 */

const COLUMNS = 'minmax(0,2fr) 90px 90px 110px'

export function RolloutsScreen() {
  const { role } = useModelStoreContext()
  const readOnly = role === 'reader'
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (readOnly) setCreating(false)
  }, [readOnly])

  const rows = useModelSelector((store) =>
    rolloutsOf(store).map((rollout) => {
      const plan = rolloutPlanOf(rollout)!
      return {
        id: rollout.id,
        name: rollout.name,
        sites: plan.sites.length,
        waves: wavesOf(store.elements(), rollout.id).length,
        unassigned: plan.sites.filter((site) => site.wave === undefined).length,
      }
    }),
  )

  return (
    <div className="rollout">
      <div className="inventory__head">
        <div>
          <h1 className="inventory__title">Rollouts</h1>
          <p className="inventory__result">{`${rows.length} rollout${rows.length === 1 ? '' : 's'}`}</p>
        </div>
        <div className="inventory__controls">
          <button
            type="button"
            className="button button--primary"
            onClick={() => setCreating(true)}
            disabled={readOnly}
          >
            + Rollout
          </button>
        </div>
      </div>
      <div className="table">
        <div className="table__header" style={{ gridTemplateColumns: COLUMNS }} role="row">
          <span>Rollout</span>
          <span className="table__right">Sites</span>
          <span className="table__right">Waves</span>
          <span className="table__right">Unassigned</span>
        </div>
        {rows.length === 0 ? (
          <p className="table__empty">
            No rollouts yet.
            <br />A rollout plans the same change across many sites, in waves.
          </p>
        ) : (
          <div className="table__scroll">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className="table__row"
                style={{ gridTemplateColumns: COLUMNS }}
                onClick={() => navigate(`/rollout/${row.id}`)}
              >
                <span className="table__name">{row.name}</span>
                <span className="table__right mono">{row.sites}</span>
                <span className="table__right mono">{row.waves}</span>
                <span className="table__right mono">{row.unassigned}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {creating && (
        <NewRolloutDialog
          onCancel={() => setCreating(false)}
          onCreated={(rollout) => {
            setCreating(false)
            navigate(`/rollout/${rollout.id}`)
          }}
        />
      )}
    </div>
  )
}
