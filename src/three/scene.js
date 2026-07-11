import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadModel, disposeObject } from './loadModel.js'
import {
  recordOriginalMaterials,
  applyMaterials,
  restoreOriginalMaterials,
  disposeGeneratedMaterials,
} from './materials.js'
import {
  initOutline,
  getOutlineEffect,
  setOutlineEnabled,
  applyOutlineParams,
  disposeOutline,
} from './outline.js'
import {
  initPosing,
  setPoseModel,
  clearPoseModel,
  updateBoneHelpers,
  disposePosing,
  suspendPosing,
  resumePosing,
} from './posing.js'
import {
  initAnimation,
  setAnimationModel,
  clearAnimationModel,
  updateAnimation,
} from './animation.js'
import {
  initObjects,
  addObject,
  removeObject,
  resetObject,
  disposeObjects,
  setCharacterObject,
  clearCharacterObject,
  getObjectsData,
  applyObjectsData,
} from './objects.js'
import { getPose, applyPose } from './posing.js'
import {
  initCaptureCamera,
  getCaptureCamera,
  computeRig,
  getRig,
  applyFrustum,
  setAngleIndex,
  updateGuides,
  setGuidesVisible,
  directionLabel,
  disposeCaptureCamera,
} from './captureCamera.js'
import { scrub } from './animation.js'
import { setBonesVisible } from './posing.js'
import {
  packSheet,
  packStacked,
  buildMeta,
  buildStackedMeta,
  canvasToBlob,
  makePreviewDataURL,
} from './spritesheet.js'
import { zipToBlob, padIndex, jsonBytes } from '../export/zip.js'
import { useStore } from '../store.js'

// ---------------------------------------------------------------------------
// Scene manager (module singleton)
//
// Holds all the live Three.js objects. It is intentionally NOT React state:
// the viewport owns a single long-lived WebGL context, and panels talk to it
// through these functions rather than through props.
//
// Rendering is ON DEMAND. We do not run a requestAnimationFrame loop when idle.
// A frame is drawn only when something visibly changed: the camera moved, a
// model loaded, or a toggle flipped. `requestRender()` coalesces multiple
// change events in a single tick into one draw. A continuous loop mode exists
// for later phases (animation playback) but stays off by default.
// ---------------------------------------------------------------------------

const state = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  container: null,
  gridHelper: null,
  shadow: null, // cheap blob ground shadow (Phase 6)
  shadowReceiver: null, // plane that catches real cast shadows
  shadowOn: true, // master ground-shadow toggle
  shadowMap: false, // real shadow mapping vs blob
  dirLight: null,
  ambientLight: null,
  lightDir: new THREE.Vector3(0.3, 0.6, 0.7), // unit direction to the key light
  modelCenter: new THREE.Vector3(0, 1, 0),
  modelRadius: 1, // ~max model dimension, for light distance + shadow camera

  currentModel: null, // parsed result from loadGLB (or null)

  renderScheduled: false,
  continuous: false, // when true, render every frame (for animation playback)
  animId: 0,
  clock: null, // THREE.Clock for per-frame deltas while playing
  fps: 0, // smoothed frames-per-second while playing (for the stats readout)
  recorder: null, // MediaRecorder while capturing a video
  recordedChunks: [],
  resizeObserver: null,

  // --- Capture rig (Phase 1) ---
  captureMode: false, // true => render through the orthographic capture camera
  captureAngle: 0, // index of the currently-previewed capture direction
  groundY: 0, // model feet height, for placing the angle guides
}

export function initScene(container) {
  if (state.renderer) return // already initialised

  state.container = container
  const width = container.clientWidth || 1
  const height = container.clientHeight || 1

  // --- Renderer ---
  // alpha:true + no scene.background => transparent output (for compositing).
  // preserveDrawingBuffer:true is required so we can read pixels for PNG export
  // in Phase 5. antialias:true for clean edges.
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // cap DPR (memory)
  renderer.setSize(width, height)
  renderer.setClearColor(0x000000, 0) // fully transparent clear
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true // used only when "realistic shadows" is on
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)
  state.renderer = renderer

  // Wrap the renderer for the (optional) inverted-hull outline pass.
  initOutline(renderer)

  // --- Scene ---
  const scene = new THREE.Scene()
  // No scene.background => transparent by default. Toggled on via setBackground.
  state.scene = scene

  // --- Camera ---
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000)
  camera.position.set(0, 1.5, 3)
  state.camera = camera

  // --- Controls ---
  // enableDamping is OFF so on-demand rendering stays trivial: each pointer move
  // fires 'change' once and a single frame is drawn. Damping would need a loop
  // to settle. (Revisit if the motion feels too stiff.)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.target.set(0, 1, 0)
  controls.addEventListener('change', requestRender)
  controls.update()
  state.controls = controls

  // --- Bone posing (gizmo + pickable bone dots) ---
  initPosing({
    scene,
    camera,
    renderer,
    controls,
    requestRender,
    // Report viewport picks up to the store; the Viewport effect then drives
    // the actual gizmo attach via selectBone (single source of truth).
    onSelect: (name) => useStore.getState().setSelectedBoneName(name),
  })

  // --- Animation (baked clips + in-app keyframing) ---
  state.clock = new THREE.Clock()
  initAnimation({
    requestRender,
    setContinuousRender,
    suspendPosing,
    resumePosing,
    onTime: (t) => useStore.getState().setCurrentTime(t),
    onEnded: () => useStore.getState().setPlayback('paused'),
  })

  // --- Scene objects (props / backgrounds with a move/rotate/scale gizmo) ---
  initObjects({ scene, camera, renderer, controls, requestRender })

  // --- Capture camera + angle guides (Phase 1) ---
  initCaptureCamera({ scene, requestRender })

  // --- Lights (only affect Toon/Standard modes in Phase 2; harmless in Unlit) ---
  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0)
  dirLight.position.set(2, 4, 3)
  dirLight.castShadow = false // enabled only in "realistic shadows" mode
  // Larger map keeps shadows crisp over the wide frustum (positionLight sizes it
  // to cover props + root-motion, not just the character).
  dirLight.shadow.mapSize.set(4096, 4096)
  dirLight.shadow.bias = -0.0005
  scene.add(dirLight)
  scene.add(dirLight.target) // shadow camera aims at the model via this target
  state.dirLight = dirLight

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)
  state.ambientLight = ambientLight

  // --- Grid helper (toggleable) ---
  const gridHelper = new THREE.GridHelper(10, 20, 0x555a66, 0x33363f)
  scene.add(gridHelper)
  state.gridHelper = gridHelper

  // --- Blob ground shadow (cheap: a soft radial sprite, not shadow mapping) ---
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: makeShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    }),
  )
  shadow.rotation.x = -Math.PI / 2 // lay flat on the ground
  shadow.renderOrder = -1 // draw before the model
  shadow.material.userData.outlineParameters = { visible: false } // never outline it
  scene.add(shadow)
  state.shadow = shadow

  // --- Real cast-shadow receiver (transparent plane that shows only shadows) ---
  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  )
  receiver.rotation.x = -Math.PI / 2
  receiver.receiveShadow = true
  receiver.visible = false
  receiver.material.userData.outlineParameters = { visible: false }
  scene.add(receiver)
  state.shadowReceiver = receiver

  // --- Sync initial UI toggles from the store ---
  const s = useStore.getState()
  setGridVisible(s.showGrid)
  setBackground(s.solidBackground, s.backgroundColor)
  setLightSettings(s.lightIntensity, s.lightAzimuth, s.lightElevation)
  setOutlineEnabled(s.outlineEnabled)
  setShadowVisible(s.showShadow)
  setShadowMapping(s.shadowMapping)

  // --- Resize handling ---
  const resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(container)
  state.resizeObserver = resizeObserver

  requestRender()
}

// Coalesced single-frame render. Multiple calls in one tick => one draw.
export function requestRender() {
  if (state.continuous || state.renderScheduled || !state.renderer) return
  state.renderScheduled = true
  requestAnimationFrame(() => {
    state.renderScheduled = false
    renderOnce()
  })
}

// The camera we currently render through: the orthographic capture camera while
// previewing a capture angle, otherwise the orbit (perspective) camera.
function activeCamera() {
  return state.captureMode ? getCaptureCamera() || state.camera : state.camera
}

function renderOnce() {
  if (!state.renderer) return
  updateBoneHelpers() // park bone dots on their (possibly just-moved) bones
  const cam = activeCamera()
  // Route through the outline effect. When the outline is disabled it falls
  // straight through to renderer.render, so there's no overhead when it's off.
  const effect = getOutlineEffect()
  if (effect) effect.render(state.scene, cam)
  else state.renderer.render(state.scene, cam)
}

// Continuous render loop, used later for animation playback. Off by default.
export function setContinuousRender(on) {
  if (on === state.continuous) return
  state.continuous = on
  if (on) {
    if (state.clock) state.clock.getDelta() // reset delta so the first frame isn't a big jump
    const tick = () => {
      if (!state.continuous) return
      state.animId = requestAnimationFrame(tick)
      const delta = state.clock ? state.clock.getDelta() : 0
      // Smoothed FPS for the stats readout (only meaningful while playing).
      if (delta > 0) state.fps = state.fps * 0.9 + (1 / delta) * 0.1
      updateAnimation(delta) // advance the mixer before drawing
      renderOnce()
    }
    state.animId = requestAnimationFrame(tick)
  } else {
    cancelAnimationFrame(state.animId)
    state.fps = 0
    requestRender()
  }
}

function handleResize() {
  const { container, renderer, camera } = state
  if (!container || !renderer) return
  const width = container.clientWidth || 1
  const height = container.clientHeight || 1
  renderer.setSize(width, height)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  // Keep the capture camera's on-screen frustum matched to the viewport so the
  // preview isn't stretched (the real capture always renders square).
  if (state.captureMode && getRig()) applyFrustum(width / height)
  requestRender()
}

// ---------------------------------------------------------------------------
// Model loading / disposal
// ---------------------------------------------------------------------------

export async function loadModelFile(file) {
  const store = useStore.getState()
  store.setLoading(true)
  try {
    const parsed = await loadModel(file)
    disposeCurrentModel() // free the previous model FIRST (memory hygiene)
    state.currentModel = parsed
    state.scene.add(parsed.root)
    parsed.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    setCharacterObject(parsed.root, parsed.info.name) // make the character movable

    // Record the as-loaded (Standard/PBR) materials, then apply the active mode
    // + shading/outline settings. Non-destructive — originals are kept.
    recordOriginalMaterials(parsed)
    applyModelMaterials()
    setPoseModel(parsed) // capture rest pose + build the bone-dot overlay
    setAnimationModel(parsed) // new mixer + baked clips

    frameCameraToObject(parsed.root)
    store.setModelInfo(parsed.info)

    // Reset the capture rig for the new model and build the angle guides so the
    // direction ring is visible straight away.
    state.captureMode = false
    state.captureAngle = 0
    if (state.controls) state.controls.enabled = true
    fitCaptureRig()
    setGuidesVisible(useStore.getState().showAngleGuides)

    requestRender()
    return parsed
  } catch (err) {
    store.setLoadError(err.message || String(err))
    throw err
  }
}

// ---------------------------------------------------------------------------
// Scene objects (props / backgrounds) — independent of the character model
// ---------------------------------------------------------------------------

// Load a file and add it as a movable scene object (does NOT replace the
// character). Selects it so the gizmo is ready. Errors propagate to the caller.
export async function addObjectFile(file) {
  const parsed = await loadModel(file)
  const meta = addObject(parsed, parsed.info.name, parsed.info.format)
  useStore.getState().addSceneObject(meta) // sets selectedObjectId = meta.id
  requestRender()
  return meta
}

export function removeObjectById(id) {
  removeObject(id)
  useStore.getState().removeSceneObject(id)
  requestRender()
}

export function resetObjectById(id) {
  resetObject(id)
}

// Current character root transform (for "keyframe position" root motion).
export function getCharacterRootTransform() {
  if (!state.currentModel) return null
  const r = state.currentModel.root
  return { pos: r.position.toArray(), quat: r.quaternion.toArray() }
}

// ---------------------------------------------------------------------------
// Capture rig (Phase 1): orthographic camera + angle guides
//
// "Fit once from the worst case, then freeze." The frustum is sized from a union
// bounding box that already covers the model across the whole animation and every
// orbit angle, so scale/framing never change frame-to-frame or layer-to-layer.
// ---------------------------------------------------------------------------

// Build the union bounding box the capture frustum must contain: the model's rest
// extents plus the envelope its bones sweep through over the animation. (Skinned-
// mesh AABBs don't reflect the deformed pose, so we track bone world positions —
// which DO move — and let padding cover the flesh around them.)
function unionBoxOverMotion() {
  const box = new THREE.Box3()
  const model = state.currentModel
  if (!model) return box
  const root = model.root

  box.setFromObject(root) // baseline: rest-pose mesh extents

  const bones = model.bones || []
  const dur = useStore.getState().duration || 0
  const v = new THREE.Vector3()
  const addBonesAt = () => {
    for (const b of bones) box.expandByPoint(b.getWorldPosition(v))
  }

  if (dur > 0 && bones.length) {
    const SAMPLES = 16
    const savedTime = useStore.getState().currentTime || 0
    for (let i = 0; i <= SAMPLES; i++) {
      scrub((i / SAMPLES) * dur) // pose the rig at this time (no-op if nothing armed)
      addBonesAt()
    }
    scrub(savedTime) // leave the rig where the user had it
  } else if (bones.length) {
    addBonesAt()
  }
  return box
}

// Recompute the frozen frustum + rebuild the angle guides from current settings.
export function fitCaptureRig() {
  if (!state.currentModel) return null
  const s = useStore.getState()
  const box = unionBoxOverMotion()
  if (box.isEmpty()) return null
  state.groundY = box.min.y
  const rig = computeRig(box, {
    angleCount: s.captureAngleCount,
    elevationDeg: s.captureElevation,
    paddingPct: s.capturePadding,
    baseYawDeg: 0,
  })
  updateGuides(state.groundY)
  setAngleIndex(state.captureAngle)
  requestRender()
  return rig
}

// Rebuild just the guides (e.g. after toggling their visibility on).
export function refreshGuides() {
  if (getRig()) updateGuides(state.groundY)
}

export function setAngleGuidesVisible(visible) {
  if (visible && !getRig()) fitCaptureRig() // need a rig before we can draw them
  setGuidesVisible(visible)
}

// Preview a specific capture direction (index into the N angles).
export function setCaptureAngle(i) {
  state.captureAngle = i
  if (!getRig()) fitCaptureRig()
  setAngleIndex(i)
  requestRender()
}

// Enter/exit the orthographic capture preview. While previewing, the orbit
// controls are disabled (the camera is locked to the chosen angle) and the frustum
// is matched to the viewport aspect so nothing looks stretched.
export function setCaptureMode(on) {
  state.captureMode = on
  if (on) {
    if (!getRig()) fitCaptureRig()
    const w = state.container?.clientWidth || 1
    const h = state.container?.clientHeight || 1
    applyFrustum(w / h)
    setAngleIndex(state.captureAngle)
    if (state.controls) state.controls.enabled = false
  } else {
    if (state.controls) state.controls.enabled = true
  }
  requestRender()
}

// Rotate the whole character about the vertical axis so it can be aligned to the
// "Front" camera. Re-fits the frustum (the AABB changes as the model turns).
export function setModelFacing(deg) {
  if (!state.currentModel) return
  state.currentModel.root.rotation.y = (deg * Math.PI) / 180
  state.currentModel.root.updateMatrixWorld(true)
  fitCaptureRig()
}

// The absolute times (seconds) to sample for a `count`-frame capture of the
// current motion. A looping clip samples [0, duration) so the wrap frame isn't
// duplicated; a static model collapses to a single frame at t=0.
function sampleTimes(count) {
  const dur = useStore.getState().duration || 0
  if (dur <= 0) return [0]
  const n = Math.max(1, count)
  const times = []
  for (let i = 0; i < n; i++) times.push((i / n) * dur)
  return times
}

// Show only the meshes in `uuids` (a Set) — the layer-isolation primitive. A
// null Set means "show everything". Meshes the user hid globally
// (meshOverrides.visible === false) stay hidden either way, so a hidden helper
// never sneaks into a layer. See three/layers.js.
function applyLayerVisibility(uuids) {
  if (!state.currentModel) return
  const ov = useStore.getState().meshOverrides || {}
  for (const mesh of state.currentModel.meshes) {
    const hidden = ov[mesh.uuid] && ov[mesh.uuid].visible === false
    mesh.visible = hidden ? false : uuids ? uuids.has(mesh.uuid) : true
  }
}

// Put mesh visibility back to what the store says (undoes applyLayerVisibility).
function restoreLayerVisibility() {
  if (!state.currentModel) return
  const ov = useStore.getState().meshOverrides || {}
  for (const mesh of state.currentModel.meshes) {
    mesh.visible = !(ov[mesh.uuid] && ov[mesh.uuid].visible === false)
  }
}

// Live-viewport solo preview: show only `uuids` (Set) so the user can flip
// through layers and confirm alignment under the locked capture camera. Pass
// null to restore. Non-destructive — it doesn't touch the store, so any later
// material change re-applies the user's real visibility.
export function previewLayerSolo(uuids) {
  if (uuids) applyLayerVisibility(uuids)
  else restoreLayerVisibility()
  requestRender()
}

// Render every sampled frame, for each requested LAYER and direction, through
// the frozen ortho camera into its own square canvas at exactly `cellSize` px.
// Helpers (grid/shadow/guides/bones) and any solid background are hidden so
// sprites come out clean and transparent, then everything is restored. The
// camera frustum is frozen throughout and only ORBITS between directions — and
// layers differ ONLY by which meshes are visible — so every layer/direction's
// cells align pixel-for-pixel. Yields to the event loop between frames so a
// progress bar can update.
//
// `layers` is [{ key, label, uuids: Set|null }]. Returns
// HTMLCanvasElement[layerIndex][angleIndex] = frame canvases.
async function renderSpriteFrames({ cellSize, times, angleIndices, layers, onProgress }) {
  const { renderer, container, scene } = state
  const w0 = container.clientWidth || 1
  const h0 = container.clientHeight || 1

  // --- Save what we're about to change ---
  const prev = {
    captureMode: state.captureMode,
    background: scene.background,
    grid: state.gridHelper ? state.gridHelper.visible : null,
    shadow: state.shadow ? state.shadow.visible : null,
    receiver: state.shadowReceiver ? state.shadowReceiver.visible : null,
  }

  // --- Set up a clean, square, transparent capture ---
  state.captureMode = true // route renderOnce through the ortho capture camera
  scene.background = null // transparent sprite cells regardless of the Scene toggle
  if (state.gridHelper) state.gridHelper.visible = false
  if (state.shadow) state.shadow.visible = false
  if (state.shadowReceiver) state.shadowReceiver.visible = false
  setGuidesVisible(false)
  setBonesVisible(false)
  applyFrustum(1) // exact square — the real capture, not the preview aspect
  renderer.setSize(cellSize, cellSize, false) // bigger/smaller buffer, keep CSS size

  const framesByLayer = layers.map(() => angleIndices.map(() => []))
  const total = layers.length * angleIndices.length * times.length
  let done = 0
  try {
    for (let L = 0; L < layers.length; L++) {
      applyLayerVisibility(layers[L].uuids) // isolate this layer (visibility only)
      for (let a = 0; a < angleIndices.length; a++) {
        setAngleIndex(angleIndices[a]) // orbit only — frustum size unchanged
        for (let i = 0; i < times.length; i++) {
          scrub(times[i]) // pose the rig at this time (no-op if nothing is armed)
          renderOnce() // synchronous draw; preserveDrawingBuffer keeps the pixels
          const cell = document.createElement('canvas')
          cell.width = cellSize
          cell.height = cellSize
          cell.getContext('2d').drawImage(renderer.domElement, 0, 0)
          framesByLayer[L][a].push(cell)
          done++
          if (onProgress) onProgress(done, total)
          await new Promise((r) => setTimeout(r, 0)) // let the UI breathe
        }
      }
    }
  } finally {
    // --- Restore everything ---
    restoreLayerVisibility()
    renderer.setSize(w0, h0, false)
    state.captureMode = prev.captureMode
    scene.background = prev.background
    if (state.gridHelper) state.gridHelper.visible = prev.grid
    if (state.shadow) state.shadow.visible = prev.shadow
    if (state.shadowReceiver) state.shadowReceiver.visible = prev.receiver
    setGuidesVisible(useStore.getState().showAngleGuides)
    setBonesVisible(useStore.getState().showBones)
    if (prev.captureMode) applyFrustum(w0 / h0) // back to on-screen preview aspect
    setAngleIndex(state.captureAngle) // restore the previewed direction
    scrub(useStore.getState().currentTime || 0) // leave the rig where the user had it
    requestRender()
  }
  return framesByLayer
}

// Turn a direction label into a filesystem-safe slug ("Side (E)" -> "Side_E").
function slugLabel(s) {
  return String(s).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'dir'
}

// Full pipeline: capture the current motion across one or more directions — and
// one or more layers — ONCE, then emit packed spritesheet(s) (PNG + JSON) and/or
// a zip of individual frames (+ manifest), per `opts.outputs`.
//
// Directions come from `opts.angleIndices` (defaults to the single previewed
// `opts.angleIndex`). With several directions, `opts.angleLayout` chooses:
//   'stacked'  → one sheet, each direction its own band of rows (single PNG+JSON)
//   'separate' → one sheet per direction, bundled into a `_sheets_.zip`
// The frames zip nests each direction under its own subfolder when multi.
//
// Layers (Phase 5) come from `opts.layers = { enabled, groups:[{label,uuids}],
// combined }`. When enabled, each selected part is captured as its own aligned
// sheet (same frozen camera, so they overlay exactly) and everything is bundled
// into per-layer folders in a zip, plus an optional "Combined" layer.
//
// Returns { count, angles, layers, wroteSheet, wroteFrames, preview }.
// `onProgress(done, total)`.
export async function generateOutput(opts, onProgress) {
  if (!state.currentModel) throw new Error('Load a model first.')
  const { cellSize, frameCount, columns, name } = opts
  const wantSheet = opts.outputs?.sheet !== false
  const wantFrames = !!opts.outputs?.frames
  if (!wantSheet && !wantFrames) throw new Error('Pick at least one output.')
  if (!getRig()) fitCaptureRig()

  const angleCount = getRig().angleCount
  // Normalise the requested directions to valid, in-range, de-duplicated indices.
  const requested =
    Array.isArray(opts.angleIndices) && opts.angleIndices.length
      ? opts.angleIndices
      : [opts.angleIndex || 0]
  const angleIndices = [...new Set(requested.map((i) => ((i % angleCount) + angleCount) % angleCount))]
  const multi = angleIndices.length > 1
  const layout = opts.angleLayout === 'stacked' ? 'stacked' : 'separate'

  // Layers to isolate (Phase 5). Absent/empty => a single combined capture that
  // reproduces the Phase 4 behaviour exactly.
  const groups = Array.isArray(opts.layers?.groups)
    ? opts.layers.groups.filter((g) => g.uuids && g.uuids.length)
    : []
  const layered = !!(opts.layers?.enabled && groups.length)
  const targets = layered
    ? buildTargets(groups, opts.layers.combined)
    : [{ key: 'all', label: 'All', uuids: null }]

  const times = sampleTimes(frameCount)
  // One capture pass feeds every output — never render the model twice.
  const framesByLayer = await renderSpriteFrames({ cellSize, times, angleIndices, layers: targets, onProgress })
  const per = framesByLayer[0][0].length // frames per direction (same for all)

  const dur = useStore.getState().duration || 0
  const fps = dur > 0 ? Math.round((per / dur) * 100) / 100 : null
  const angles = angleIndices.map((idx) => ({ index: idx, label: directionLabel(idx, angleCount) }))
  const roundedTimes = times.map((t) => Math.round(t * 1000) / 1000)
  const stamp = timestamp()

  // Layered exports always bundle into per-layer folders in a zip.
  if (layered) {
    const ctx = { cellSize, columns, layout, multi, per, fps, angles, times, roundedTimes, name }
    return await emitLayeredOutput({ framesByLayer, targets, wantSheet, wantFrames, ctx, stamp })
  }

  // ---- Single combined capture (Phase 4 path: loose files / per-direction zip) ----
  const framesByAngle = framesByLayer[0]
  let preview = null

  if (wantSheet) {
    if (multi && layout === 'stacked') {
      const packed = packStacked(framesByAngle, { cell: cellSize, columns })
      const meta = buildStackedMeta({
        name,
        cell: cellSize,
        cols: packed.cols,
        rowsPerAngle: packed.rowsPerAngle,
        count: per,
        fps,
        angles,
        times,
        width: packed.width,
        height: packed.height,
      })
      downloadBlob(await canvasToBlob(packed.canvas), `${name}_sheet_stacked_${stamp}.png`)
      downloadBlob(
        new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
        `${name}_sheet_stacked_${stamp}.json`,
      )
      preview = makePreviewDataURL(packed.canvas, 320)
    } else if (multi) {
      // Separate sheet per direction — bundle so it's one download, not 2×N.
      const files = {}
      const sheets = []
      for (let a = 0; a < angleIndices.length; a++) {
        const packed = packSheet(framesByAngle[a], { cell: cellSize, columns })
        const base = `dir_${angles[a].index}_${slugLabel(angles[a].label)}`
        const meta = buildMeta({
          name,
          cell: cellSize,
          cols: packed.cols,
          rows: packed.rows,
          count: per,
          fps,
          angle: angles[a],
          times,
          width: packed.width,
          height: packed.height,
        })
        files[`${base}.png`] = new Uint8Array(await (await canvasToBlob(packed.canvas)).arrayBuffer())
        files[`${base}.json`] = jsonBytes(meta)
        sheets.push({ index: angles[a].index, label: angles[a].label, file: `${base}.png` })
        if (a === 0) preview = makePreviewDataURL(packed.canvas, 320)
      }
      files['sheets.json'] = jsonBytes({
        format: 'spritesheets-v1',
        source: name,
        cell: cellSize,
        columns,
        count: per,
        fps,
        layout: 'separate',
        frameTimes: roundedTimes,
        sheets,
      })
      downloadBlob(await zipToBlob(files), `${name}_sheets_${stamp}.zip`)
    } else {
      // Single direction — loose PNG + JSON (unchanged from Phase 2/3).
      const packed = packSheet(framesByAngle[0], { cell: cellSize, columns })
      const meta = buildMeta({
        name,
        cell: cellSize,
        cols: packed.cols,
        rows: packed.rows,
        count: per,
        fps,
        angle: angles[0],
        times,
        width: packed.width,
        height: packed.height,
      })
      downloadBlob(await canvasToBlob(packed.canvas), `${name}_sheet_${stamp}.png`)
      downloadBlob(
        new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
        `${name}_sheet_${stamp}.json`,
      )
      preview = makePreviewDataURL(packed.canvas, 320)
    }
  }

  if (wantFrames) {
    const files = {}
    const directions = []
    for (let a = 0; a < angleIndices.length; a++) {
      const frames = framesByAngle[a]
      // Nest per-direction only when there's more than one, so single-direction
      // zips stay `frames/frame_NNN.png` (unchanged from Phase 3).
      const dir = multi ? `frames/dir_${angles[a].index}_${slugLabel(angles[a].label)}` : 'frames'
      const fileNames = []
      for (let i = 0; i < frames.length; i++) {
        const blob = await canvasToBlob(frames[i])
        const fname = `${dir}/frame_${padIndex(i, frames.length)}.png`
        files[fname] = new Uint8Array(await blob.arrayBuffer())
        fileNames.push(fname)
      }
      directions.push({ index: angles[a].index, label: angles[a].label, dir, files: fileNames })
    }
    files['manifest.json'] = jsonBytes(
      multi
        ? {
            format: 'frames-multi-v1',
            source: name,
            cell: cellSize,
            count: per,
            fps,
            frameTimes: roundedTimes,
            directions,
          }
        : {
            format: 'frames-v1',
            source: name,
            cell: cellSize,
            count: per,
            fps,
            angle: angles[0],
            frameTimes: roundedTimes,
            files: directions[0].files,
          },
    )
    downloadBlob(await zipToBlob(files), `${name}_frames_${stamp}.zip`)
    if (!preview) preview = makePreviewDataURL(framesByAngle[0][0], 320)
  }

  return {
    count: per,
    angles: angles.length,
    layers: 1,
    wroteSheet: wantSheet,
    wroteFrames: wantFrames,
    preview,
  }
}

// PNG bytes for a canvas, ready to drop into a zip.
async function pngBytes(canvas) {
  return new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer())
}

// Turn selected layer groups into capture targets. Each target is a Set of the
// mesh UUIDs to show. When "combined" is on (and there's more than one layer) an
// extra target with every selected mesh visible is appended.
function buildTargets(groups, combined) {
  const targets = groups.map((g) => ({
    key: `layer_${slugLabel(g.label)}`,
    label: g.label,
    uuids: new Set(g.uuids),
  }))
  if (combined && groups.length > 1) {
    const all = new Set()
    for (const g of groups) for (const u of g.uuids) all.add(u)
    targets.push({ key: 'combined', label: 'Combined', uuids: all })
  }
  return targets
}

// Pack one layer's captured frames into sheet file(s) under `prefix/`, following
// the same direction-layout rules as the single-capture path (stacked band /
// separate per-direction / single). Returns { files: {path: bytes}, preview }.
async function buildAngleSheetFiles(framesByAngle, ctx, prefix) {
  const { cellSize, columns, layout, multi, per, fps, angles, times, name } = ctx
  const p = prefix ? prefix.replace(/\/+$/, '') + '/' : ''
  const files = {}
  let preview = null

  if (multi && layout === 'stacked') {
    const packed = packStacked(framesByAngle, { cell: cellSize, columns })
    files[`${p}sheet_stacked.png`] = await pngBytes(packed.canvas)
    files[`${p}sheet_stacked.json`] = jsonBytes(
      buildStackedMeta({
        name,
        cell: cellSize,
        cols: packed.cols,
        rowsPerAngle: packed.rowsPerAngle,
        count: per,
        fps,
        angles,
        times,
        width: packed.width,
        height: packed.height,
      }),
    )
    preview = makePreviewDataURL(packed.canvas, 320)
  } else if (multi) {
    for (let a = 0; a < angles.length; a++) {
      const packed = packSheet(framesByAngle[a], { cell: cellSize, columns })
      const base = `dir_${angles[a].index}_${slugLabel(angles[a].label)}`
      files[`${p}${base}.png`] = await pngBytes(packed.canvas)
      files[`${p}${base}.json`] = jsonBytes(
        buildMeta({
          name,
          cell: cellSize,
          cols: packed.cols,
          rows: packed.rows,
          count: per,
          fps,
          angle: angles[a],
          times,
          width: packed.width,
          height: packed.height,
        }),
      )
      if (a === 0) preview = makePreviewDataURL(packed.canvas, 320)
    }
  } else {
    const packed = packSheet(framesByAngle[0], { cell: cellSize, columns })
    files[`${p}sheet.png`] = await pngBytes(packed.canvas)
    files[`${p}sheet.json`] = jsonBytes(
      buildMeta({
        name,
        cell: cellSize,
        cols: packed.cols,
        rows: packed.rows,
        count: per,
        fps,
        angle: angles[0],
        times,
        width: packed.width,
        height: packed.height,
      }),
    )
    preview = makePreviewDataURL(packed.canvas, 320)
  }
  return { files, preview }
}

// Emit a layered export: every layer (+ optional Combined) as its own aligned
// sheet/frames, bundled into per-layer folders in one zip each. Because every
// layer was shot with the same frozen camera, shirt/ overlays body/ exactly.
async function emitLayeredOutput({ framesByLayer, targets, wantSheet, wantFrames, ctx, stamp }) {
  const { cellSize, columns, layout, multi, per, fps, angles, roundedTimes, name } = ctx
  let preview = null

  if (wantSheet) {
    const files = {}
    const layers = []
    for (let L = 0; L < targets.length; L++) {
      const dir = slugLabel(targets[L].label)
      const built = await buildAngleSheetFiles(framesByLayer[L], ctx, dir)
      Object.assign(files, built.files)
      layers.push({ layer: targets[L].label, key: targets[L].key, dir })
      if (!preview) preview = built.preview
    }
    files['layers.json'] = jsonBytes({
      format: 'spritesheets-layered-v1',
      source: name,
      cell: cellSize,
      columns,
      count: per,
      fps,
      directionLayout: multi ? layout : 'single',
      angles,
      frameTimes: roundedTimes,
      layers,
    })
    downloadBlob(await zipToBlob(files), `${name}_layers_${stamp}.zip`)
  }

  if (wantFrames) {
    const files = {}
    const layers = []
    for (let L = 0; L < targets.length; L++) {
      const layerDir = slugLabel(targets[L].label)
      const directions = []
      for (let a = 0; a < angles.length; a++) {
        const frames = framesByLayer[L][a]
        // Nest per-direction only when there's more than one.
        const sub = multi ? `${layerDir}/dir_${angles[a].index}_${slugLabel(angles[a].label)}` : layerDir
        const fileNames = []
        for (let i = 0; i < frames.length; i++) {
          const fname = `${sub}/frame_${padIndex(i, frames.length)}.png`
          files[fname] = await pngBytes(frames[i])
          fileNames.push(fname)
        }
        directions.push({ index: angles[a].index, label: angles[a].label, dir: sub, files: fileNames })
      }
      layers.push({ layer: targets[L].label, key: targets[L].key, directions })
    }
    files['manifest.json'] = jsonBytes({
      format: 'frames-layered-v1',
      source: name,
      cell: cellSize,
      count: per,
      fps,
      frameTimes: roundedTimes,
      layers,
    })
    downloadBlob(await zipToBlob(files), `${name}_layer_frames_${stamp}.zip`)
    if (!preview) preview = makePreviewDataURL(framesByLayer[0][0][0], 320)
  }

  return {
    count: per,
    angles: angles.length,
    layers: targets.length,
    wroteSheet: wantSheet,
    wroteFrames: wantFrames,
    preview,
  }
}

// ---------------------------------------------------------------------------
// Export (Phase 5): PNG, video recording, fullscreen
// ---------------------------------------------------------------------------

function timestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Render the current frame at `scale`× the viewport resolution and save a PNG.
// Transparent background is preserved (alpha), so it drops into 2D art.
export function exportPNG(scale = 2, name = 'render') {
  if (!state.renderer || !state.container) return
  const w = state.container.clientWidth || 1
  const h = state.container.clientHeight || 1
  state.renderer.setSize(w * scale, h * scale, false) // false: keep CSS size, bigger buffer
  renderOnce()
  state.renderer.domElement.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${name}_${timestamp()}.png`)
    state.renderer.setSize(w, h, false) // restore
    requestRender()
  }, 'image/png')
}

// True if the browser can record the canvas to a video.
export function canRecordVideo() {
  return typeof MediaRecorder !== 'undefined' && !!state.renderer?.domElement?.captureStream
}

// Start recording the live canvas to a webm video. Returns false if unsupported.
export function startRecording(fps = 30) {
  if (!canRecordVideo()) return false
  const stream = state.renderer.domElement.captureStream(fps)
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || ''
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  state.recordedChunks = []
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size) state.recordedChunks.push(e.data)
  }
  recorder.start()
  state.recorder = recorder
  return true
}

// Stop recording and download the webm.
export function stopRecordingAndDownload(name = 'animation') {
  const recorder = state.recorder
  if (!recorder) return
  recorder.onstop = () => {
    const blob = new Blob(state.recordedChunks, { type: 'video/webm' })
    downloadBlob(blob, `${name}_${timestamp()}.webm`)
    state.recordedChunks = []
  }
  recorder.stop()
  state.recorder = null
}

// Enter fullscreen on the viewport (Esc exits — browser default).
export function enterFullscreen() {
  const el = state.container && state.container.parentElement
  if (el && el.requestFullscreen) el.requestFullscreen()
}

// ---------------------------------------------------------------------------
// Scene save / load (layout: character + object transforms + current pose)
// ---------------------------------------------------------------------------

// Capture the placement of the character and every prop, plus the current pose.
// NOTE: this stores TRANSFORMS, not geometry — reload the same files, then Load
// scene to restore where everything sat.
export function getSceneData() {
  const data = { format: 'scene-v1', objects: getObjectsData() }
  if (state.currentModel) {
    const root = state.currentModel.root
    data.character = {
      name: state.currentModel.info.name,
      position: root.position.toArray(),
      quaternion: root.quaternion.toArray(),
      scale: root.scale.toArray(),
      pose: getPose(),
    }
  }
  return data
}

// Apply a saved scene layout to what's currently loaded (matched by name).
export function applySceneData(json) {
  if (!json || json.format !== 'scene-v1') {
    throw new Error('Not a valid scene file (expected format "scene-v1").')
  }
  if (json.character && state.currentModel) {
    const root = state.currentModel.root
    const c = json.character
    if (c.position) root.position.fromArray(c.position)
    if (c.quaternion) root.quaternion.fromArray(c.quaternion)
    if (c.scale) root.scale.fromArray(c.scale)
    if (c.pose) {
      try {
        applyPose(c.pose)
      } catch {
        /* pose from a different rig — skip */
      }
    }
  }
  applyObjectsData(json.objects)
  requestRender()
}

export function disposeCurrentModel() {
  if (!state.currentModel) return
  const model = state.currentModel
  setContinuousRender(false) // stop any playback before tearing the model down
  state.captureMode = false // leave capture preview; guides need a model to anchor
  setGuidesVisible(false)
  if (state.controls) state.controls.enabled = true
  clearCharacterObject() // unregister the movable-character entry
  clearAnimationModel() // dispose the mixer
  clearPoseModel() // detach gizmo + remove bone overlay before the graph goes away
  // Put the real materials back so the deep-dispose walk frees them (and their
  // textures) rather than a generated shell that only borrows those textures...
  restoreOriginalMaterials(model)
  disposeGeneratedMaterials(model) // ...then free the generated Basic/Toon shells.
  state.scene.remove(model.root)
  disposeObject(model.root) // geometries, materials, textures
  state.currentModel = null
  useStore.getState().clearModel()
}

// Frame the camera so the whole model fits comfortably in view, and point the
// orbit target at its centre.
function frameCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = (state.camera.fov * Math.PI) / 180
  // Distance so the largest dimension fits the vertical FOV, with padding.
  let dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.4
  dist = Math.max(dist, 0.1)

  // Place the camera off to the front-side at a pleasant 3/4 angle.
  const dir = new THREE.Vector3(0.5, 0.35, 1).normalize()
  state.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)))

  // Adjust clipping planes to the model's scale so it never gets clipped.
  state.camera.near = Math.max(dist / 1000, 0.001)
  state.camera.far = dist * 100
  state.camera.updateProjectionMatrix()

  state.controls.target.copy(center)
  state.controls.update()

  placeShadowUnder(box)
}

// Park the ground shadows under the model and size the shadow camera. Scale-aware
// so it works for both metre-scale glTF and centimetre-scale FBX.
function placeShadowUnder(box) {
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  state.modelCenter.copy(center)
  state.modelRadius = Math.max(maxDim, 0.5)

  if (state.shadow) {
    // Much smaller now — just the contact footprint under the feet.
    const footprint = Math.max(size.x, size.z) * 0.7
    state.shadow.scale.set(footprint, footprint, 1)
    state.shadow.position.set(center.x, box.min.y + maxDim * 0.001, center.z)
  }
  if (state.shadowReceiver) {
    const r = maxDim * 6
    state.shadowReceiver.scale.set(r, r, 1)
    state.shadowReceiver.position.set(center.x, box.min.y, center.z)
  }
  positionLight()
}

// Position the key light along its direction, high and far enough out to cast
// shadows across a generous area — not just the character's bounding box, so
// props and root-motion movement stay shadowed. `r` ~ the model's max dimension.
function positionLight() {
  const dl = state.dirLight
  if (!dl) return
  const r = state.modelRadius
  const dist = Math.max(10, r * 6) // high & far so the frustum sits above the scene
  dl.position.copy(state.modelCenter).addScaledVector(state.lightDir, dist)
  dl.target.position.copy(state.modelCenter)
  dl.target.updateMatrixWorld()

  const cam = dl.shadow.camera
  const half = Math.max(r * 4, 1) // cover ±4× the model size around the centre
  cam.left = -half
  cam.right = half
  cam.top = half
  cam.bottom = -half
  cam.near = Math.max(0.01, dist - r * 5)
  cam.far = dist + r * 5
  cam.updateProjectionMatrix()
  // Scale-aware normal bias: bigger frustum = bigger texels, so offset along the
  // surface normal in world units to avoid acne without peter-panning.
  dl.shadow.normalBias = r * 0.02
}

// ---------------------------------------------------------------------------
// Display toggles (called from panels via the store subscription in Viewport)
// ---------------------------------------------------------------------------

export function setGridVisible(visible) {
  if (state.gridHelper) state.gridHelper.visible = visible
  requestRender()
}

export function setShadowVisible(visible) {
  state.shadowOn = visible
  applyShadowMode()
}

export function setShadowMapping(on) {
  state.shadowMap = on
  applyShadowMode()
}

// The blob and the real cast-shadow are mutually exclusive: blob when shadows are
// on but shadow-mapping is off; real shadows when both are on.
function applyShadowMode() {
  const blobOn = state.shadowOn && !state.shadowMap
  const realOn = state.shadowOn && state.shadowMap
  if (state.shadow) state.shadow.visible = blobOn
  if (state.shadowReceiver) state.shadowReceiver.visible = realOn
  if (state.dirLight) state.dirLight.castShadow = realOn
  requestRender()
}

// A soft radial gradient used as the blob-shadow texture (opaque centre → clear
// edge). Generated once on a small canvas — no external asset.
function makeShadowTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

// Live renderer stats for the (optional) corner readout. Proves the low-overhead
// claim: triangle/draw counts, GPU resource counts, JS heap, and playback FPS.
export function getStats() {
  if (!state.renderer) return null
  const info = state.renderer.info
  const mem = typeof performance !== 'undefined' && performance.memory
  return {
    fps: state.continuous ? Math.round(state.fps) : null,
    triangles: info.render.triangles,
    calls: info.render.calls,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
  }
}

export function setBackground(solid, color) {
  if (!state.scene) return
  if (solid) {
    state.scene.background = new THREE.Color(color)
  } else {
    state.scene.background = null // transparent
  }
  requestRender()
}

// ---------------------------------------------------------------------------
// Material mode + lighting (Phase 2)
// ---------------------------------------------------------------------------

// Re-apply materials + outline to the loaded model from the current store state.
// This is the single entry point for any material/shading/outline-width change
// (mode, toon steps, soften, per-mesh overrides). No-op if nothing is loaded.
export function applyModelMaterials() {
  if (!state.currentModel) return
  const s = useStore.getState()
  const soften = s.softenEnabled ? s.softenAmount : 0
  applyMaterials(state.currentModel, {
    mode: s.materialMode,
    toonSteps: s.toonSteps,
    soften,
    overrides: s.meshOverrides,
  })
  // Materials may have been swapped; re-stamp outline params onto the live ones.
  applyOutlineParams(state.currentModel, s.outlineWidth, soften, s.meshOverrides)
  requestRender()
}

// Toggle the outline pass on/off (width/visibility come from applyModelMaterials).
export function setOutlineToggle(enabled) {
  setOutlineEnabled(enabled)
  requestRender()
}

// Position + brighten the key directional light from spherical angles. Azimuth
// sweeps around the vertical axis (0 = straight in front, +ve = to the right),
// elevation lifts it above the horizon. Radius is arbitrary — only direction
// matters for a DirectionalLight.
export function setLightSettings(intensity, azimuthDeg, elevationDeg) {
  if (!state.dirLight) return
  state.dirLight.intensity = intensity

  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  state.lightDir.set(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  )
  positionLight() // reposition the light + shadow camera along the new direction
  requestRender()
}

// ---------------------------------------------------------------------------
// Teardown (called when the Viewport unmounts)
// ---------------------------------------------------------------------------

export function disposeScene() {
  setContinuousRender(false)
  disposeCurrentModel()
  disposeObjects()
  disposePosing()
  disposeCaptureCamera()
  disposeOutline()

  if (state.resizeObserver) {
    state.resizeObserver.disconnect()
    state.resizeObserver = null
  }
  if (state.controls) {
    state.controls.removeEventListener('change', requestRender)
    state.controls.dispose()
    state.controls = null
  }
  if (state.gridHelper) {
    state.gridHelper.geometry.dispose()
    state.gridHelper.material.dispose()
    state.gridHelper = null
  }
  if (state.shadow) {
    state.shadow.geometry.dispose()
    if (state.shadow.material.map) state.shadow.material.map.dispose()
    state.shadow.material.dispose()
    state.shadow = null
  }
  if (state.shadowReceiver) {
    state.shadowReceiver.geometry.dispose()
    state.shadowReceiver.material.dispose()
    state.shadowReceiver = null
  }
  if (state.renderer) {
    state.renderer.dispose()
    state.renderer.forceContextLoss()
    if (state.renderer.domElement && state.renderer.domElement.parentNode) {
      state.renderer.domElement.parentNode.removeChild(state.renderer.domElement)
    }
    state.renderer = null
  }
  state.scene = null
  state.camera = null
  state.container = null
}

// Expose current model reference for panels that need live objects later.
export function getCurrentModel() {
  return state.currentModel
}
