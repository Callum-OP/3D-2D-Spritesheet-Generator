import { useState } from 'react'
import { useStore } from '../store.js'
import { generateOutput, cancelGeneration, isCaptureCancelled } from '../three/scene.js'
import { sheetDimensions, stackedDimensions, MAX_CANVAS_DIM } from '../three/spritesheet.js'
import { directionLabel } from '../three/captureCamera.js'
import { buildLayers, selectedGroups } from '../three/layers.js'

// Rough memory the capture holds at once: every frame canvas (RGBA) is kept in
// memory until it's packed/zipped. Warn past ~512 MB, block past ~2 GB so a huge
// angles×frames×layers×cell² combo can't hard-crash the tab.
const BYTES_PER_PX = 4
const MEM_WARN = 512 * 1024 * 1024
const MEM_BLOCK = 2 * 1024 * 1024 * 1024

function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.round(n / 1024)} KB`
}

// Side-panel section: turn the current model + motion into packed spritesheet(s)
// and/or a zip of individual frames — one capture pass feeds every output. Can
// shoot just the previewed direction or all N directions at once, laid out as
// separate per-direction sheets or a single sheet with one band per direction.
export default function OutputPanel() {
  const modelInfo = useStore((s) => s.modelInfo)
  const duration = useStore((s) => s.duration)
  const angleCount = useStore((s) => s.captureAngleCount)
  const angleIndex = useStore((s) => s.captureAngleIndex)
  const layerEnabled = useStore((s) => s.layerExportEnabled)
  const layerSelection = useStore((s) => s.layerSelection)
  const layerCombined = useStore((s) => s.layerCombined)

  // Output settings live in the store (Phase 6) so presets + save/load reach them.
  const cellSize = useStore((s) => s.outCellSize)
  const frameCount = useStore((s) => s.outFrameCount)
  const columns = useStore((s) => s.outColumns)
  const scope = useStore((s) => s.outScope)
  const layout = useStore((s) => s.outAngleLayout)
  const wantSheet = useStore((s) => s.outWantSheet)
  const wantFrames = useStore((s) => s.outWantFrames)
  const setCellSize = useStore((s) => s.setOutCellSize)
  const setFrameCount = useStore((s) => s.setOutFrameCount)
  const setColumns = useStore((s) => s.setOutColumns)
  const setScope = useStore((s) => s.setOutScope)
  const setLayout = useStore((s) => s.setOutAngleLayout)
  const setWantSheet = useStore((s) => s.setOutWantSheet)
  const setWantFrames = useStore((s) => s.setOutWantFrames)

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)

  if (!modelInfo) {
    return (
      <div className="panel">
        <h2>Spritesheet</h2>
        <p className="panel-hint">Load a model to generate a spritesheet.</p>
      </div>
    )
  }

  const hasAnim = duration > 0
  const effectiveFrames = hasAnim ? Math.max(1, frameCount) : 1

  // Which directions this run will cover.
  const allDirections = scope === 'all' && angleCount > 1
  const dirCount = allDirections ? angleCount : 1
  const usingStacked = allDirections && layout === 'stacked'

  // Sheet size depends on the layout: a stacked sheet stacks every direction's
  // band; otherwise each direction (or the single one) is its own sheet.
  const perDims = sheetDimensions(effectiveFrames, columns, cellSize)
  const stackDims = stackedDimensions(effectiveFrames, columns, cellSize, dirCount)
  const dims = usingStacked ? stackDims : perDims
  const tooBig = wantSheet && (dims.width > MAX_CANVAS_DIM || dims.height > MAX_CANVAS_DIM)
  const noOutput = !wantSheet && !wantFrames

  const angleIndices = allDirections
    ? Array.from({ length: angleCount }, (_, i) => i)
    : [angleIndex]

  // Which parts to isolate (Phase 5). Resolved from the Layers panel selection.
  const allLayers = buildLayers(modelInfo.meshes || [])
  const layerGroups = selectedGroups(allLayers, layerSelection)
  const layered = layerEnabled && layerGroups.length > 0
  const targetCount = layered
    ? layerGroups.length + (layerCombined && layerGroups.length > 1 ? 1 : 0)
    : 1

  // Peak memory the run will hold (all frame canvases at once).
  const totalFrames = effectiveFrames * dirCount * targetCount
  const estBytes = totalFrames * cellSize * cellSize * BYTES_PER_PX
  const memBlock = estBytes > MEM_BLOCK
  const memWarn = !memBlock && estBytes > MEM_WARN

  async function onGenerate() {
    if (busy || tooBig || noOutput || memBlock) return
    setBusy(true)
    setMsg(null)
    setProgress({ done: 0, total: effectiveFrames * dirCount * targetCount })
    try {
      const res = await generateOutput(
        {
          cellSize,
          frameCount: effectiveFrames,
          columns,
          angleIndices,
          angleLayout: layout,
          layers: { enabled: layered, groups: layerGroups, combined: layerCombined },
          name: modelInfo.name || 'sprites',
          outputs: { sheet: wantSheet, frames: wantFrames },
        },
        (done, total) => setProgress({ done, total }),
      )
      setPreview(res.preview)
      const parts = []
      if (res.wroteSheet) {
        if (res.layers > 1) parts.push('per-layer sheets zip')
        else if (allDirections) parts.push(usingStacked ? 'stacked sheet PNG + JSON' : 'per-direction sheets zip')
        else parts.push('spritesheet PNG + JSON')
      }
      if (res.wroteFrames) parts.push(res.layers > 1 ? 'per-layer frames zip' : 'frames zip')
      const where = allDirections
        ? `${res.angles} directions`
        : directionLabel(angleIndex, angleCount)
      const layerTxt = res.layers > 1 ? ` × ${res.layers} layers` : ''
      setMsg(`Saved ${res.count} frame(s) × ${where}${layerTxt}: ${parts.join(' + ')}.`)
    } catch (err) {
      setMsg(isCaptureCancelled(err) ? 'Cancelled — nothing was saved.' : err.message || String(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="panel">
      <h2>Spritesheet</h2>
      <p className="panel-hint">
        Renders the current motion through the locked capture camera and packs the
        frames into aligned sheet(s).
      </p>

      <NumberField
        label="Cell size (px per frame)"
        value={cellSize}
        min={16}
        max={2048}
        step={16}
        onChange={setCellSize}
      />
      <NumberField
        label="Frames"
        value={frameCount}
        min={1}
        max={256}
        step={1}
        disabled={!hasAnim}
        onChange={setFrameCount}
      />
      <NumberField
        label="Columns"
        value={columns}
        min={1}
        max={64}
        step={1}
        disabled={!wantSheet}
        onChange={setColumns}
      />

      {/* Which directions to shoot */}
      <div className="field-label" style={{ marginTop: 8 }}>Directions</div>
      <div className="seg">
        <button
          className={'seg-btn' + (scope === 'current' ? ' active' : '')}
          onClick={() => setScope('current')}
          title="Only the direction previewed in the Capture panel"
        >
          Current
        </button>
        <button
          className={'seg-btn' + (scope === 'all' ? ' active' : '')}
          onClick={() => setScope('all')}
          disabled={angleCount <= 1}
          title={angleCount <= 1 ? 'Set more than one direction in the Capture panel' : `All ${angleCount} directions`}
        >
          All {angleCount > 1 ? `(${angleCount})` : ''}
        </button>
      </div>

      {allDirections && wantSheet && (
        <>
          <div className="field-label" style={{ marginTop: 8 }}>Sheet layout</div>
          <div className="seg">
            <button
              className={'seg-btn' + (layout === 'stacked' ? ' active' : '')}
              onClick={() => setLayout('stacked')}
              title="One sheet — each direction is its own band of rows"
            >
              Stacked rows
            </button>
            <button
              className={'seg-btn' + (layout === 'separate' ? ' active' : '')}
              onClick={() => setLayout('separate')}
              title="One sheet per direction, bundled into a zip"
            >
              Separate (zip)
            </button>
          </div>
        </>
      )}

      <div className="field-label" style={{ marginTop: 8 }}>Output</div>
      <label className="toggle-row">
        <input type="checkbox" checked={wantSheet} onChange={(e) => setWantSheet(e.target.checked)} />
        Spritesheet (packed PNG + JSON)
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={wantFrames} onChange={(e) => setWantFrames(e.target.checked)} />
        Individual frames (zip of PNGs)
      </label>
      {noOutput && (
        <p className="panel-hint" style={{ color: '#ff8080' }}>
          Pick at least one output.
        </p>
      )}

      {!hasAnim && (
        <p className="panel-hint">
          No animation is armed — this will export a single static frame. Pick a
          clip (or import a .bvh) in <b>Animation</b> for a multi-frame sheet.
        </p>
      )}

      <div className="info-row" style={{ marginTop: 8 }}>
        <span>Directions</span>
        <span>
          {allDirections ? `${angleCount} (all)` : directionLabel(angleIndex, angleCount)}
        </span>
      </div>
      {layered && (
        <div className="info-row">
          <span>Layers</span>
          <span>
            {targetCount} ({layerGroups.length} part{layerGroups.length === 1 ? '' : 's'}
            {layerCombined && layerGroups.length > 1 ? ' + combined' : ''})
          </span>
        </div>
      )}
      {wantSheet && (
        <div className="info-row">
          <span>{usingStacked ? 'Sheet size' : allDirections ? 'Each sheet' : 'Sheet size'}</span>
          <span style={{ color: tooBig ? '#ff8080' : undefined }}>
            {dims.width}×{dims.height}px ({dims.cols}×{usingStacked ? dims.totalRows : dims.rows})
            {allDirections && !usingStacked ? ` × ${angleCount}` : ''}
          </span>
        </div>
      )}

      <div className="info-row">
        <span>Total frames</span>
        <span>{totalFrames}</span>
      </div>
      <div className="info-row">
        <span>Est. memory</span>
        <span style={{ color: memBlock ? '#ff8080' : memWarn ? '#ffc234' : undefined }}>
          ~{formatBytes(estBytes)}
        </span>
      </div>

      {tooBig && (
        <p className="panel-hint" style={{ color: '#ff8080' }}>
          Too large — browsers cap canvases near {MAX_CANVAS_DIM}px. Reduce the cell
          size{usingStacked ? ', fewer directions,' : ''} or use more columns.
        </p>
      )}
      {memBlock && (
        <p className="panel-hint" style={{ color: '#ff8080' }}>
          This would allocate ~{formatBytes(estBytes)} of frames at once and likely
          crash the tab. Reduce cell size, frames, directions or layers.
        </p>
      )}
      {memWarn && (
        <p className="panel-hint" style={{ color: '#ffc234' }}>
          Heads up — this holds ~{formatBytes(estBytes)} of frames in memory. It may
          be slow on lower-end machines.
        </p>
      )}

      <div className="scrub-row" style={{ marginTop: 8 }}>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={onGenerate}
          disabled={busy || tooBig || noOutput || memBlock}
        >
          {busy
            ? progress
              ? `Rendering ${progress.done}/${progress.total}…`
              : 'Working…'
            : 'Generate'}
        </button>
        {busy && (
          <button className="btn secondary" onClick={() => cancelGeneration()} title="Stop the capture">
            Cancel
          </button>
        )}
      </div>

      {msg && <div className="pose-msg">{msg}</div>}

      {preview && (
        <div style={{ marginTop: 10 }}>
          <div className="field-label">Last sheet</div>
          <img
            src={preview}
            alt="spritesheet preview"
            style={{
              width: '100%',
              marginTop: 4,
              borderRadius: 6,
              // Checkerboard so transparency reads clearly in the thumbnail.
              backgroundColor: '#2a2c33',
              backgroundImage:
                'linear-gradient(45deg,#3a3d46 25%,transparent 25%,transparent 75%,#3a3d46 75%),linear-gradient(45deg,#3a3d46 25%,transparent 25%,transparent 75%,#3a3d46 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0,8px 8px',
            }}
          />
        </div>
      )}
    </div>
  )
}

// A labelled numeric input row.
function NumberField({ label, value, min, max, step, disabled, onChange }) {
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)))
        }}
        style={{ width: 72 }}
      />
    </label>
  )
}
