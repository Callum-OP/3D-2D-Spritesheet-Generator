import { useStore } from '../store.js'

// Full-screen help & shortcuts overlay. Explains, in plain language, what the app
// is for and how to drive it — for people who've never touched animation software.
// Toggled by the "?" key or the header button.
export default function HelpOverlay() {
  const show = useStore((s) => s.showHelp)
  const setShow = useStore((s) => s.setShowHelp)
  if (!show) return null

  return (
    <div className="help-backdrop" onClick={() => setShow(false)}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <button className="help-close" title="Close (Esc)" onClick={() => setShow(false)}>
          ×
        </button>
        <h2>Welcome to the 3D → 2D Spritesheet Maker</h2>
        <p className="help-intro">
          Load a 3D character, give it a look and some motion, then render it into
          a 2D spritesheet — turnaround directions, aligned clothing layers and all
          — on a transparent background, ready for your game or 2D art.
        </p>

        <div className="help-cols">
          <div>
            <h3>From model to spritesheet</h3>
            <ol className="help-steps">
              <li>
                <b>Load a character.</b> Drag a <code>.glb</code>, <code>.gltf</code>{' '}
                or <code>.fbx</code> file onto the view, or use the <b>Load</b>{' '}
                button. Or hit a <b>Preset</b> to start from a common setup.
              </li>
              <li>
                <b>Style it.</b> Pick a look (Flat / Cartoon / Realistic), add an
                outline, and tweak the light — this is what makes 3D read as 2D.
              </li>
              <li>
                <b>Give it motion.</b> Play a built-in clip, import motion capture
                (<code>.bvh</code>), or keyframe your own. A single pose works too.
              </li>
              <li>
                <b>Aim the camera.</b> In <b>Capture</b>, set how many directions to
                shoot (1 / 4 / 8…) and the tilt, then face the model at the green
                <b> Front</b> arrow.
              </li>
              <li>
                <b>Split into layers (optional).</b> In <b>Layers</b>, export each
                part (body, clothes, hat) as its own aligned sheet that overlays
                the others pixel-for-pixel.
              </li>
              <li>
                <b>Generate.</b> In <b>Spritesheet</b>, choose cell size, frames and
                outputs (packed sheet and/or a zip of frames), then <b>Generate</b>.
              </li>
            </ol>
          </div>

          <div>
            <h3>Mouse</h3>
            <ul className="help-keys">
              <li>
                <b>Left-drag</b> — orbit around the character
              </li>
              <li>
                <b>Right-drag</b> — slide the view
              </li>
              <li>
                <b>Scroll</b> — zoom in / out
              </li>
              <li>
                <b>Click a dot</b> — select a joint to pose
              </li>
            </ul>
            <h3>Keyboard</h3>
            <ul className="help-keys">
              <li>
                <b>?</b> — open / close this help
              </li>
              <li>
                <b>Esc</b> — deselect / close
              </li>
              <li>
                <b>Ctrl / Cmd + Z</b> — undo a pose change
              </li>
            </ul>
            <h3>Tips</h3>
            <ul className="help-keys">
              <li>
                <b>Click any slider value</b> to type an exact number.
              </li>
              <li>
                <b>Save settings</b> (in Presets) to reuse a look later.
              </li>
            </ul>
          </div>
        </div>

        <div className="help-tip">
          New to this? Load a character, click a <b>Preset</b>, then press{' '}
          <b>Generate</b> — nothing you do here changes your original file.
        </div>
      </div>
    </div>
  )
}
