// ---------------------------------------------------------------------------
// Spritesheet packing (Phase 2) — pure canvas/2D work, no Three.js.
//
// Takes an array of already-rendered square frame canvases (all the same size,
// all shot with the frozen capture camera so they align) and lays them out in a
// grid. Frame order is left-to-right, top-to-bottom — the order a game engine
// reads them back with the metadata sidecar.
// ---------------------------------------------------------------------------

// The widest/tallest a 2D canvas can be before browsers refuse to allocate it.
// Chrome/Firefox cap around 16384; stay just under to be safe.
export const MAX_CANVAS_DIM = 16384

// Rows/cols for `count` frames given a column count.
export function computeGrid(count, columns) {
  const cols = Math.max(1, Math.min(columns, count))
  const rows = Math.ceil(count / cols)
  return { cols, rows }
}

// Sheet pixel size for a given cell size + layout (no packing, just the maths —
// used by the UI to show/validate dimensions before generating).
export function sheetDimensions(count, columns, cell) {
  const { cols, rows } = computeGrid(count, columns)
  return { cols, rows, width: cols * cell, height: rows * cell }
}

// Pixel size of a STACKED sheet: each of `angleCount` directions gets its own
// horizontal band (`framesPerAngle` frames laid out in `columns`), the bands
// stacked top-to-bottom. Used by the UI to show/validate before generating.
export function stackedDimensions(framesPerAngle, columns, cell, angleCount) {
  const { cols, rows: rowsPerAngle } = computeGrid(framesPerAngle, columns)
  const totalRows = rowsPerAngle * Math.max(1, angleCount)
  return { cols, rowsPerAngle, totalRows, width: cols * cell, height: totalRows * cell }
}

// Pack frame canvases into one sheet. `frames[i]` is drawn into cell i.
export function packSheet(frames, { cell, columns }) {
  const { cols, rows } = computeGrid(frames.length, columns)
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height) // stay transparent
  frames.forEach((frame, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    ctx.drawImage(frame, 0, 0, frame.width, frame.height, col * cell, row * cell, cell, cell)
  })
  return { canvas, cols, rows, width: canvas.width, height: canvas.height }
}

// Pack multiple directions into ONE stacked sheet: each direction is its own
// band of `rowsPerAngle` rows, bands laid out top-to-bottom in `framesByAngle`
// order. Every frame is shot with the same frozen capture camera, so a band's
// cells align with the matching cells in every other band. `framesByAngle[a][i]`
// is direction a's frame i.
export function packStacked(framesByAngle, { cell, columns }) {
  const angleCount = framesByAngle.length
  const per = framesByAngle[0]?.length || 0
  const cols = Math.max(1, Math.min(columns, per || 1))
  const rowsPerAngle = Math.ceil(Math.max(1, per) / cols)
  const totalRows = rowsPerAngle * angleCount
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = totalRows * cell
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height) // stay transparent
  framesByAngle.forEach((frames, a) => {
    const rowBase = a * rowsPerAngle
    frames.forEach((frame, i) => {
      const col = i % cols
      const row = rowBase + Math.floor(i / cols)
      ctx.drawImage(frame, 0, 0, frame.width, frame.height, col * cell, row * cell, cell, cell)
    })
  })
  return { canvas, cols, rowsPerAngle, totalRows, angleCount, width: canvas.width, height: canvas.height }
}

// Metadata sidecar for a stacked (all-directions) sheet. Each entry in `angles`
// ({ index, label }) maps to one band; band a occupies rows [a*rowsPerAngle,
// (a+1)*rowsPerAngle). `count` is the per-direction frame count.
export function buildStackedMeta({ name, cell, cols, rowsPerAngle, count, fps, angles, times, width, height }) {
  return {
    format: 'spritesheet-stacked-v1',
    source: name,
    cell,
    columns: cols,
    rowsPerAngle,
    count,
    fps: fps || null,
    width,
    height,
    layout: 'stacked-by-direction',
    angles, // band order, top-to-bottom
    frameTimes: times.map((t) => Math.round(t * 1000) / 1000),
  }
}

// Metadata sidecar describing the sheet, enough to slice it back apart.
export function buildMeta({ name, cell, cols, rows, count, fps, angle, times, width, height }) {
  return {
    format: 'spritesheet-v1',
    source: name,
    cell,
    columns: cols,
    rows,
    count,
    fps: fps || null,
    width,
    height,
    angle, // { index, label }
    // Absolute time (seconds) each frame was sampled at, in sheet order.
    frameTimes: times.map((t) => Math.round(t * 1000) / 1000),
  }
}

// Promise wrapper around canvas.toBlob (PNG, alpha preserved).
export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

// A small data-URL thumbnail of a big sheet, for an in-panel preview.
export function makePreviewDataURL(canvas, maxDim = 256) {
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height))
  const w = Math.max(1, Math.round(canvas.width * scale))
  const h = Math.max(1, Math.round(canvas.height * scale))
  const small = document.createElement('canvas')
  small.width = w
  small.height = h
  small.getContext('2d').drawImage(canvas, 0, 0, w, h)
  return small.toDataURL('image/png')
}
