import Viewport from './three/Viewport.jsx'
import ModelPanel from './panels/ModelPanel.jsx'
import MaterialPanel from './panels/MaterialPanel.jsx'
import BonePanel from './panels/BonePanel.jsx'
import AnimationPanel from './panels/AnimationPanel.jsx'
import CapturePanel from './panels/CapturePanel.jsx'
import OutputPanel from './panels/OutputPanel.jsx'
import ExportPanel from './panels/ExportPanel.jsx'
import ViewPanel from './panels/ViewPanel.jsx'
import HelpOverlay from './panels/HelpOverlay.jsx'
import { useStore } from './store.js'

// Top-level layout: 3D viewport on the left, control sidebar on the right.
export default function App() {
  const toggleHelp = useStore((s) => s.toggleHelp)
  return (
    <div className="app">
      <Viewport />
      <aside className="sidebar">
        <div className="app-header">
          <div>
            <h1 className="app-title">3D → 2D Spritesheet Maker</h1>
            <div className="app-tagline">Render a model + motion into 2D spritesheets</div>
          </div>
          <button className="help-btn" title="Help & shortcuts (?)" onClick={toggleHelp}>
            ?
          </button>
        </div>
        <ModelPanel />
        <MaterialPanel />
        <AnimationPanel />
        <BonePanel />
        <CapturePanel />
        <OutputPanel />
        <ViewPanel />
        <ExportPanel />
      </aside>
      <HelpOverlay />
    </div>
  )
}
