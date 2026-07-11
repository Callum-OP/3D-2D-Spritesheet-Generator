import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Capture camera + rig (Phase 1)
//
// The whole spritesheet pipeline rests on ONE invariant (see references/Plan.md
// §3): the camera frustum and the output canvas must be computed ONCE and reused
// identically for every frame, every angle, and every layer. If the frustum were
// re-fit per frame, layers wouldn't line up and the animation would "swim".
//
// So we use an OrthographicCamera (constant scale = clean tiling + pixel-perfect
// overlays) sized to a UNION bounding box that already contains the model across
// the whole animation and every orbit angle. `computeRig()` freezes that size;
// `setAngleIndex()` only orbits around the centre — the frustum never changes.
//
// This module also draws the on-ground ANGLE GUIDES: a ring with one marker per
// capture direction, text labels, and a bright arrow showing which way the model
// should face so it lines up with the "Front" camera.
// ---------------------------------------------------------------------------

const cc = {
  camera: null, // THREE.OrthographicCamera
  guides: null, // THREE.Group holding the ring/markers/labels/arrow
  scene: null,
  requestRender: () => {},
  rig: null, // frozen { center, orthoHalf, distance, near, far, angleCount, elevationDeg, baseYawDeg }
}

// 8-direction names, clockwise from Front toward world +X (East / screen-right).
// Index 0 is always "Front" — the direction the model should face.
const NAMES_8 = ['Front', 'FR ¾', 'Side (E)', 'BR ¾', 'Back', 'BL ¾', 'Side (W)', 'FL ¾']
const NAMES_4 = ['Front', 'Side (E)', 'Back', 'Side (W)']

// Human-readable label for capture direction `i` of `count`.
export function directionLabel(i, count) {
  if (count === 8) return NAMES_8[i]
  if (count === 4) return NAMES_4[i]
  if (i === 0) return 'Front'
  return `${Math.round((i * 360) / count)}°`
}

export function initCaptureCamera({ scene, requestRender }) {
  cc.scene = scene
  cc.requestRender = requestRender || (() => {})
  // Frustum values are placeholders until computeRig() runs.
  cc.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)
  cc.camera.position.set(0, 1, 3)
  cc.camera.lookAt(0, 1, 0)

  cc.guides = new THREE.Group()
  cc.guides.visible = false
  scene.add(cc.guides)
}

export function getCaptureCamera() {
  return cc.camera
}

export function getRig() {
  return cc.rig
}

// Freeze the capture frustum from a union bounding box (already covering the whole
// animation + all angles). Square frustum so cells are square and nothing clips at
// any orbit angle for the chosen elevation.
export function computeRig(box, { angleCount, elevationDeg, paddingPct, baseYawDeg }) {
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  const halfH = size.y / 2
  // Max horizontal reach from the vertical axis through the centre (box corner).
  // As the camera orbits in yaw, this is the widest the silhouette ever gets.
  const Rh = 0.5 * Math.hypot(size.x, size.z)

  const phi = (elevationDeg * Math.PI) / 180
  // Vertical screen extent needed once the camera tilts by elevation φ: the
  // cylinder's height projects as halfH·cosφ and its radius adds Rh·sinφ.
  const halfV = halfH * Math.cos(phi) + Rh * Math.sin(phi)
  // Square frame fits both the widest yaw (Rh) and the tilted height (halfV).
  const orthoHalf = Math.max(Rh, halfV) * (1 + (paddingPct || 0) / 100)

  const diag = size.length() || 1
  const distance = diag * 2 + 1 // ortho: distance only affects clipping, not scale

  cc.rig = {
    center,
    orthoHalf,
    distance,
    near: Math.max(0.001, distance - diag * 2),
    far: distance + diag * 2,
    angleCount,
    elevationDeg,
    baseYawDeg: baseYawDeg || 0,
  }
  applyFrustum(1) // default to square; preview overrides with the viewport aspect
  setAngleIndex(0)
  return cc.rig
}

// Set the ortho frustum. `aspect` = width/height: 1 for the real (square) capture,
// or the viewport aspect while previewing so the model isn't stretched on screen.
export function applyFrustum(aspect = 1) {
  if (!cc.rig || !cc.camera) return
  const h = cc.rig.orthoHalf
  const w = h * aspect
  cc.camera.left = -w
  cc.camera.right = w
  cc.camera.top = h
  cc.camera.bottom = -h
  cc.camera.near = cc.rig.near
  cc.camera.far = cc.rig.far
  cc.camera.updateProjectionMatrix()
}

// Orbit the (frozen-size) camera to capture direction `i`. Yaw 0 sits on world +Z
// (in front of a model that faces +Z); increasing yaw rotates toward +X (East).
export function setAngleIndex(i) {
  if (!cc.rig || !cc.camera) return
  const { center, distance, angleCount, elevationDeg, baseYawDeg } = cc.rig
  const theta = ((baseYawDeg + (i * 360) / angleCount) * Math.PI) / 180
  const phi = (elevationDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  cc.camera.position.set(
    center.x + distance * Math.sin(theta) * cosP,
    center.y + distance * Math.sin(phi),
    center.z + distance * Math.cos(theta) * cosP,
  )
  cc.camera.up.set(0, 1, 0)
  cc.camera.lookAt(center)
  cc.camera.updateMatrixWorld()
  cc.requestRender()
}

// Unit ground direction (x,z) the model should face to line up with the Front
// camera — i.e. toward where capture direction 0 sits.
export function frontFacingDir() {
  if (!cc.rig) return { x: 0, z: 1 }
  const theta = (cc.rig.baseYawDeg * Math.PI) / 180
  return { x: Math.sin(theta), z: Math.cos(theta) }
}

// ---------------------------------------------------------------------------
// Angle guides (ground ring + markers + labels + facing arrow)
// ---------------------------------------------------------------------------

export function setGuidesVisible(visible) {
  if (cc.guides) cc.guides.visible = visible
  cc.requestRender()
}

// Rebuild the guide overlay from the current rig + a ground box (for placement).
// `groundY` is where the ring sits (usually the model's feet).
export function updateGuides(groundY) {
  if (!cc.guides || !cc.rig) return
  clearGroup(cc.guides)

  const { center, orthoHalf, angleCount, baseYawDeg } = cc.rig
  const R = orthoHalf * 1.5 // ring radius: sit the markers outside the silhouette
  const markerSize = orthoHalf * 0.12
  const cx = center.x
  const cz = center.z
  const y = groundY

  // --- Ring ---
  const ringPts = []
  const SEG = 96
  for (let s = 0; s <= SEG; s++) {
    const t = (s / SEG) * Math.PI * 2
    ringPts.push(new THREE.Vector3(cx + R * Math.sin(t), y, cz + R * Math.cos(t)))
  }
  const ring = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(ringPts),
    lineMat(0x5a6b8c),
  )
  ring.renderOrder = 998
  cc.guides.add(ring)

  // --- One marker + label per capture direction ---
  for (let i = 0; i < angleCount; i++) {
    const theta = ((baseYawDeg + (i * 360) / angleCount) * Math.PI) / 180
    const dx = Math.sin(theta)
    const dz = Math.cos(theta)
    const isFront = i === 0
    const color = isFront ? 0x36d17a : 0xcf6b34

    // A cone lying on the ground, pointing inward toward the model (= where the
    // camera looks from this direction).
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(markerSize * 0.6, markerSize * 1.6, 4),
      basicMat(color),
    )
    cone.position.set(cx + R * dx, y, cz + R * dz)
    // Point the cone's +Y toward the centre, laid flat on the ground.
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-dx, 0, -dz).normalize(),
    )
    cone.renderOrder = 999
    cc.guides.add(cone)

    // Text label just outside the marker.
    const label = makeTextSprite(directionLabel(i, angleCount), isFront)
    const ls = orthoHalf * 0.9
    label.scale.set(ls, ls * 0.35, 1)
    label.position.set(cx + R * 1.18 * dx, y + orthoHalf * 0.12, cz + R * 1.18 * dz)
    cc.guides.add(label)
  }

  // --- Facing arrow: from centre toward the Front direction (where the model
  // should point). A flat triangle + shaft on the ground. ---
  const fd = frontFacingDir()
  const arrow = makeGroundArrow(cx, y, cz, fd.x, fd.z, R * 0.85, orthoHalf * 0.18)
  cc.guides.add(arrow)

  cc.requestRender()
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function lineMat(color) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })
}

function basicMat(color) {
  const m = new THREE.MeshBasicMaterial({ color })
  m.userData.outlineParameters = { visible: false } // never outline guides
  return m
}

function makeGroundArrow(cx, y, cz, dx, dz, length, headW) {
  const g = new THREE.Group()
  const tip = new THREE.Vector3(cx + dx * length, y, cz + dz * length)
  // Shaft
  const shaft = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx, y, cz),
      tip.clone(),
    ]),
    lineMat(0x36d17a),
  )
  shaft.renderOrder = 999
  g.add(shaft)
  // Arrowhead (flat triangle) at the tip.
  const perpX = -dz
  const perpZ = dx
  const back = new THREE.Vector3(cx + dx * (length - headW), y, cz + dz * (length - headW))
  const head = new THREE.Mesh(
    new THREE.BufferGeometry().setFromPoints([
      tip.clone(),
      new THREE.Vector3(back.x + perpX * headW * 0.6, y, back.z + perpZ * headW * 0.6),
      new THREE.Vector3(back.x - perpX * headW * 0.6, y, back.z - perpZ * headW * 0.6),
    ]),
    new THREE.MeshBasicMaterial({ color: 0x36d17a, side: THREE.DoubleSide }),
  )
  head.geometry.setIndex([0, 1, 2])
  head.material.userData.outlineParameters = { visible: false }
  head.renderOrder = 999
  g.add(head)
  return g
}

// Canvas-based text sprite that always faces the viewer. `highlight` tints the
// "Front" label green.
function makeTextSprite(text, highlight) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 52px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 8
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, 128, 48)
  ctx.fillStyle = highlight ? '#5cf0a0' : '#e8ecf4'
  ctx.fillText(text, 128, 48)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  const spr = new THREE.Sprite(mat)
  spr.renderOrder = 1000
  return spr
}

function clearGroup(group) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i]
    group.remove(c)
    if (c.geometry) c.geometry.dispose()
    if (c.material) {
      if (c.material.map) c.material.map.dispose()
      c.material.dispose()
    }
    if (c.children && c.children.length) clearGroup(c) // nested (arrow group)
  }
}

export function disposeCaptureCamera() {
  if (cc.guides) {
    clearGroup(cc.guides)
    if (cc.scene) cc.scene.remove(cc.guides)
    cc.guides = null
  }
  cc.camera = null
  cc.scene = null
  cc.rig = null
}
