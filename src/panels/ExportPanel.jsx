import { useState } from 'react'
import { useStore } from '../store.js'
import { exportPNG, enterFullscreen } from '../three/scene.js'
import { exportAnimationBVH } from '../three/animation.js'

// Side-panel section: get a single frame out of the app — a transparent PNG at
// the current camera angle, or the in-app animation as a .bvh, plus a fullscreen
// view. This is an interim single-frame export; batch spritesheet output arrives
// with the capture pipeline (see references/Plan.md).
const SCALES = [1, 2, 4]

export default function ExportPanel() {
  const modelInfo = useStore((s) => s.modelInfo)
  const exportScale = useStore((s) => s.exportScale)
  const setExportScale = useStore((s) => s.setExportScale)
  const st = useStore.getState
  const [msg, setMsg] = useState(null)

  const name = modelInfo?.name || 'render'

  function onPNG() {
    exportPNG(exportScale, name)
    setMsg(`Saved a ${exportScale}× PNG.`)
  }

  function onExportBVH() {
    const s = st()
    const text = exportAnimationBVH(s.animData, s.animFps, s.animDuration)
    if (!text) {
      setMsg('Nothing to export — make an in-app animation first.')
      return
    }
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.bvh`
    a.click()
    URL.revokeObjectURL(url)
    setMsg('Animation exported as .bvh.')
  }

  return (
    <div className="panel">
      <h2>Export</h2>
      <p className="panel-hint">
        Save the current frame as a transparent image, or the animation as .bvh.
      </p>

      <div className="field">
        <label className="field-label">Image size</label>
        <div className="seg">
          {SCALES.map((s) => (
            <button
              key={s}
              className={'seg-btn' + (exportScale === s ? ' active' : '')}
              onClick={() => setExportScale(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <button className="btn" style={{ marginTop: 8 }} onClick={onPNG}>
        Save image (PNG)
      </button>

      <button className="btn secondary" style={{ marginTop: 6 }} onClick={onExportBVH}>
        Export animation (.bvh)
      </button>

      <button className="btn secondary" style={{ marginTop: 6 }} onClick={() => enterFullscreen()}>
        Fullscreen (Esc to exit)
      </button>

      {msg && <div className="pose-msg">{msg}</div>}

      <p className="panel-hint" style={{ marginTop: 10 }}>
        Tip: the PNG captures the current camera angle with a transparent
        background, ready to drop into a 2D art pipeline.
      </p>
    </div>
  )
}
