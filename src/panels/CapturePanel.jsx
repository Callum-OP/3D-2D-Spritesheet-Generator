import { useStore } from '../store.js'
import { directionLabel } from '../three/captureCamera.js'
import {
  fitCaptureRig,
  setCaptureAngle,
  setCaptureMode,
  setModelFacing,
  setAngleGuidesVisible,
} from '../three/scene.js'

// Side-panel section: the orthographic CAPTURE rig — the camera that will
// rasterize sprites. Pick how many directions to shoot, the camera tilt, and how
// tightly to frame the model; orient the model so it faces the green "Front"
// arrow; then preview each locked angle. The frustum is fit once and frozen so
// every frame/angle/layer shares identical framing (see references/Plan.md).
const ANGLE_PRESETS = [1, 4, 8]

export default function CapturePanel() {
  const modelInfo = useStore((s) => s.modelInfo)
  const angleCount = useStore((s) => s.captureAngleCount)
  const elevation = useStore((s) => s.captureElevation)
  const padding = useStore((s) => s.capturePadding)
  const facing = useStore((s) => s.modelFacing)
  const showGuides = useStore((s) => s.showAngleGuides)
  const preview = useStore((s) => s.capturePreview)
  const angleIndex = useStore((s) => s.captureAngleIndex)
  const st = useStore.getState

  if (!modelInfo) {
    return (
      <div className="panel">
        <h2>Capture</h2>
        <p className="panel-hint">Load a model to set up the sprite camera.</p>
      </div>
    )
  }

  // --- Handlers (set store first, then re-fit the rig which reads the store) ---
  function changeAngleCount(n) {
    const count = Math.max(1, Math.min(64, Math.round(n)))
    st().setCaptureAngleCount(count)
    if (angleIndex >= count) {
      st().setCaptureAngleIndex(0)
      setCaptureAngle(0)
    }
    fitCaptureRig()
  }

  function changeElevation(v) {
    st().setCaptureElevation(v)
    fitCaptureRig()
  }

  function changePadding(v) {
    st().setCapturePadding(v)
    fitCaptureRig()
  }

  function changeFacing(v) {
    // Wrap into 0..359 so the slider and ±90 buttons agree.
    const deg = ((Math.round(v) % 360) + 360) % 360
    st().setModelFacing(deg)
    setModelFacing(deg)
  }

  function toggleGuides(on) {
    st().setShowAngleGuides(on)
    setAngleGuidesVisible(on)
  }

  function togglePreview(on) {
    st().setCapturePreview(on)
    setCaptureMode(on)
  }

  function gotoAngle(i) {
    const idx = ((i % angleCount) + angleCount) % angleCount
    st().setCaptureAngleIndex(idx)
    setCaptureAngle(idx)
  }

  return (
    <div className="panel">
      <h2>Capture</h2>
      <p className="panel-hint">
        Set up the sprite camera. Orient the model to the green <b>Front</b> arrow,
        then preview each locked direction.
      </p>

      {/* Number of directions */}
      <div className="field">
        <label className="field-label">Directions</label>
        <div className="seg">
          {ANGLE_PRESETS.map((n) => (
            <button
              key={n}
              className={'seg-btn' + (angleCount === n ? ' active' : '')}
              onClick={() => changeAngleCount(n)}
              title={n === 8 ? '8-directional (Front, ¾, Side, …)' : `${n} direction(s)`}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={64}
            value={angleCount}
            onChange={(e) => changeAngleCount(Number(e.target.value))}
            style={{ width: 52, marginLeft: 6 }}
            title="Custom number of directions"
          />
        </div>
      </div>

      <Slider
        label="Camera tilt"
        value={elevation}
        min={0}
        max={85}
        step={1}
        onChange={changeElevation}
        format={(v) => `${v}°`}
      />
      <Slider
        label="Frame padding"
        value={padding}
        min={0}
        max={40}
        step={1}
        onChange={changePadding}
        format={(v) => `${v}%`}
      />

      {/* Model facing — rotate so the character points at the Front camera */}
      <div className="field" style={{ marginTop: 6 }}>
        <label className="field-label">Model facing (align to Front arrow)</label>
        <Slider
          label="Yaw"
          value={facing}
          min={0}
          max={359}
          step={1}
          onChange={changeFacing}
          format={(v) => `${v}°`}
        />
        <div className="seg" style={{ marginTop: 4 }}>
          <button className="seg-btn" onClick={() => changeFacing(facing - 90)}>
            ⟲ 90°
          </button>
          <button className="seg-btn" onClick={() => changeFacing(facing + 90)}>
            90° ⟳
          </button>
          <button className="seg-btn" onClick={() => changeFacing(0)} title="Reset facing">
            Reset
          </button>
        </div>
      </div>

      <label className="toggle-row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={showGuides} onChange={(e) => toggleGuides(e.target.checked)} />
        Show direction guides
      </label>

      <button className="btn secondary" style={{ marginTop: 6 }} onClick={() => fitCaptureRig()}>
        Refit frame to animation
      </button>

      {/* Preview the locked capture camera + step through directions */}
      <label className="toggle-row" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={preview} onChange={(e) => togglePreview(e.target.checked)} />
        Preview capture camera
      </label>

      {preview && (
        <>
          <div className="scrub-row" style={{ marginTop: 4 }}>
            <button className="btn secondary" onClick={() => gotoAngle(angleIndex - 1)}>
              ‹ Prev
            </button>
            <span className="slider-value" style={{ minWidth: 80, textAlign: 'center' }}>
              {directionLabel(angleIndex, angleCount)}
            </span>
            <button className="btn secondary" onClick={() => gotoAngle(angleIndex + 1)}>
              Next ›
            </button>
          </div>
          <div className="preset-row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
            {Array.from({ length: angleCount }, (_, i) => (
              <button
                key={i}
                className={'preset-btn' + (i === angleIndex ? ' active' : '')}
                onClick={() => gotoAngle(i)}
                title={directionLabel(i, angleCount)}
              >
                {angleCount === 8 || angleCount === 4 ? directionLabel(i, angleCount) : `${i}`}
              </button>
            ))}
          </div>
          <p className="panel-hint" style={{ marginTop: 8 }}>
            The square outline shows the exact area each sprite cell will capture.
          </p>
        </>
      )}
    </div>
  )
}

// A labelled range input with a live numeric readout.
function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{format(value)}</span>
    </label>
  )
}
