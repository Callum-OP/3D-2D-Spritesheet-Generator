import { useStore } from '../store.js'
import { buildLayers } from '../three/layers.js'
import { previewLayerSolo } from '../three/scene.js'

// Side-panel section: LAYER isolation (Phase 5, advanced). Split the model's
// meshes into "parts" (body, clothes, hat…) and export each as its own aligned
// spritesheet. Every part is captured through the SAME frozen camera, so
// shirt.png overlays body.png pixel-for-pixel. The actual generation runs from
// the Spritesheet panel; this panel only chooses which parts to isolate.
export default function LayersPanel() {
  const modelInfo = useStore((s) => s.modelInfo)
  const enabled = useStore((s) => s.layerExportEnabled)
  const selection = useStore((s) => s.layerSelection)
  const combined = useStore((s) => s.layerCombined)
  const soloId = useStore((s) => s.layerSoloId)
  const st = useStore.getState

  if (!modelInfo) {
    return (
      <div className="panel">
        <h2>Layers</h2>
        <p className="panel-hint">Load a model to export parts as separate aligned sheets.</p>
      </div>
    )
  }

  const layers = buildLayers(modelInfo.meshes || [])
  const isSelected = (id) => selection?.[id] !== false
  const selectedCount = layers.filter((l) => isSelected(l.id)).length

  function clearSolo() {
    if (st().layerSoloId != null) {
      st().setLayerSoloId(null)
      previewLayerSolo(null)
    }
  }

  function toggleEnabled(on) {
    st().setLayerExportEnabled(on)
    if (!on) clearSolo() // don't leave the viewport stuck in a solo view
  }

  function solo(layer) {
    if (soloId === layer.id) {
      clearSolo()
      return
    }
    st().setLayerSoloId(layer.id)
    previewLayerSolo(new Set(layer.uuids))
  }

  function setAll(sel) {
    st().setAllLayersSelected(layers.map((l) => l.id), sel)
  }

  if (layers.length <= 1) {
    return (
      <div className="panel">
        <h2>Layers</h2>
        <p className="panel-hint">
          This model is a single mesh — there are no separate parts to isolate.
          Layer export is for models split into multiple meshes (e.g. body +
          clothing).
        </p>
      </div>
    )
  }

  return (
    <div className="panel">
      <h2>Layers</h2>
      <p className="panel-hint">
        Export each part as its <b>own</b> aligned sheet. Every layer uses the same
        locked camera, so the sheets overlay pixel-for-pixel.
      </p>

      <label className="toggle-row">
        <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled(e.target.checked)} />
        Export parts as separate sheets
      </label>

      <div className="mesh-row mesh-head" style={{ marginTop: 6 }}>
        <span>Part</span>
        <span title="How many meshes are merged into this part">Meshes</span>
        <span title="Include this part in the export">Export</span>
        <span title="Show only this part in the viewport">Solo</span>
      </div>
      <div className="mesh-list">
        {layers.map((l) => (
          <div key={l.id} className={'mesh-row' + (soloId === l.id ? ' layer-solo' : '')}>
            <span className="mesh-name" title={l.name}>
              {l.name}
            </span>
            <span className="mesh-cell" style={{ fontSize: 11 }}>
              {l.uuids.length}
            </span>
            <label className="mesh-cell" title="Include this part in the export">
              <input
                type="checkbox"
                checked={isSelected(l.id)}
                disabled={!enabled}
                onChange={(e) => st().setLayerSelected(l.id, e.target.checked)}
              />
            </label>
            <button
              className={'preset-btn' + (soloId === l.id ? ' active' : '')}
              style={{ padding: '2px 8px' }}
              onClick={() => solo(l)}
              title="Show only this part in the viewport (to check alignment)"
            >
              {soloId === l.id ? '●' : '○'}
            </button>
          </div>
        ))}
      </div>

      <div className="preset-row" style={{ marginTop: 4 }}>
        <button className="preset-btn" disabled={!enabled} onClick={() => setAll(true)}>
          All
        </button>
        <button className="preset-btn" disabled={!enabled} onClick={() => setAll(false)}>
          None
        </button>
        {soloId != null && (
          <button className="preset-btn" onClick={clearSolo} title="Stop solo preview">
            Show all
          </button>
        )}
      </div>

      <label className="toggle-row" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={combined}
          disabled={!enabled || selectedCount < 2}
          onChange={(e) => st().setLayerCombined(e.target.checked)}
        />
        Also export a combined sheet
      </label>

      {enabled && selectedCount === 0 && (
        <p className="panel-hint" style={{ color: '#ff8080' }}>
          Select at least one part, or turn layer export off.
        </p>
      )}
      {enabled && selectedCount > 0 && (
        <p className="panel-hint">
          {selectedCount} layer{selectedCount === 1 ? '' : 's'}
          {combined && selectedCount > 1 ? ' + combined' : ''} — press{' '}
          <b>Generate</b> in the Spritesheet panel.
        </p>
      )}
    </div>
  )
}
