import { useState } from 'react'
import { useStore } from '../store.js'
import { generateOutput } from '../three/scene.js'
import { sheetDimensions, MAX_CANVAS_DIM } from '../three/spritesheet.js'
import { directionLabel } from '../three/captureCamera.js'

// Side-panel section: turn the current model + motion into a packed spritesheet
// and/or a zip of individual frames — one capture pass feeds both. Single
// direction / combined model for now (per-mesh layers arrive later; see
// references/Plan.md).
export default function OutputPanel() {
  const modelInfo = useStore((s) => s.modelInfo)
  const duration = useStore((s) => s.duration)
  const angleCount = useStore((s) => s.captureAngleCount)
  const angleIndex = useStore((s) => s.captureAngleIndex)

  const [cellSize, setCellSize] = useState(256)
  const [frameCount, setFrameCount] = useState(12)
  const [columns, setColumns] = useState(6)
  const [wantSheet, setWantSheet] = useState(true)
  const [wantFrames, setWantFrames] = useState(false)
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
  const dims = sheetDimensions(effectiveFrames, columns, cellSize)
  // The grid only matters when a packed sheet is requested.
  const tooBig = wantSheet && (dims.width > MAX_CANVAS_DIM || dims.height > MAX_CANVAS_DIM)
  const noOutput = !wantSheet && !wantFrames

  async function onGenerate() {
    if (busy || tooBig || noOutput) return
    setBusy(true)
    setMsg(null)
    setProgress({ done: 0, total: effectiveFrames })
    try {
      const res = await generateOutput(
        {
          cellSize,
          frameCount: effectiveFrames,
          columns,
          angleIndex,
          name: modelInfo.name || 'sprites',
          outputs: { sheet: wantSheet, frames: wantFrames },
        },
        (done, total) => setProgress({ done, total }),
      )
      setPreview(res.preview)
      const parts = []
      if (res.wroteSheet) parts.push('spritesheet PNG + JSON')
      if (res.wroteFrames) parts.push('frames zip')
      setMsg(`Saved ${res.count} frame(s) (${directionLabel(angleIndex, angleCount)}): ${parts.join(' + ')}.`)
    } catch (err) {
      setMsg(err.message || String(err))
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
        frames into one aligned sheet.
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
        <span>Direction</span>
        <span>{directionLabel(angleIndex, angleCount)}</span>
      </div>
      {wantSheet && (
        <div className="info-row">
          <span>Sheet size</span>
          <span style={{ color: tooBig ? '#ff8080' : undefined }}>
            {dims.width}×{dims.height}px ({dims.cols}×{dims.rows})
          </span>
        </div>
      )}

      {tooBig && (
        <p className="panel-hint" style={{ color: '#ff8080' }}>
          Too large — browsers cap canvases near {MAX_CANVAS_DIM}px. Reduce the cell
          size or use more columns.
        </p>
      )}

      <button
        className="btn"
        style={{ marginTop: 8 }}
        onClick={onGenerate}
        disabled={busy || tooBig || noOutput}
      >
        {busy
          ? progress
            ? `Rendering ${progress.done}/${progress.total}…`
            : 'Working…'
          : 'Generate'}
      </button>

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
