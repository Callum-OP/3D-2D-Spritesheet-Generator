import { useRef, useState } from 'react'
import { useStore, pickSettings } from '../store.js'
import { syncCaptureFromStore } from '../three/scene.js'
import { PRESETS } from '../presets.js'

// Side-panel section (Phase 6): one-click presets and save/load of all settings.
// Presets and loaded files both go through applySettings(); Style/light/outline
// re-apply via the Viewport's store effects, and syncCaptureFromStore() nudges
// the imperative capture rig so the change is visible immediately.
export default function PresetsPanel() {
  const modelInfo = useStore((s) => s.modelInfo)
  const applySettings = useStore((s) => s.applySettings)
  const fileRef = useRef(null)
  const [msg, setMsg] = useState(null)

  function apply(obj, note) {
    applySettings(obj)
    syncCaptureFromStore() // capture rig isn't reactive; re-apply it explicitly
    setMsg(note)
  }

  function onPreset(p) {
    apply(p.settings, `Applied preset “${p.name}”.`)
  }

  function onSave() {
    const settings = pickSettings(useStore.getState())
    const doc = { format: 'spritesheet-settings-v1', settings }
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'spritesheet-settings.json'
    a.click()
    URL.revokeObjectURL(url)
    setMsg('Saved settings to spritesheet-settings.json.')
  }

  function onLoadFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result))
        const settings = doc && doc.settings ? doc.settings : doc
        if (!settings || typeof settings !== 'object') throw new Error('bad file')
        apply(settings, 'Loaded settings.')
      } catch {
        setMsg('Could not read that settings file.')
      }
    }
    reader.onerror = () => setMsg('Could not read that file.')
    reader.readAsText(file)
  }

  return (
    <div className="panel">
      <h2>Presets</h2>
      <p className="panel-hint">
        Jump to a common setup, or save your current style + capture + output
        settings to reuse later.
      </p>

      <div className="preset-row" style={{ flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className="preset-btn"
            title={p.desc}
            disabled={!modelInfo}
            onClick={() => onPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="seg" style={{ marginTop: 8 }}>
        <button className="seg-btn" onClick={onSave} title="Download all current settings as JSON">
          Save settings
        </button>
        <button className="seg-btn" onClick={() => fileRef.current && fileRef.current.click()} title="Load settings from a JSON file">
          Load settings
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={onLoadFile}
      />

      {!modelInfo && (
        <p className="panel-hint">Load a model to apply a preset.</p>
      )}
      {msg && <div className="pose-msg">{msg}</div>}
    </div>
  )
}
