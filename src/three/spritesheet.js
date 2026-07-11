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
