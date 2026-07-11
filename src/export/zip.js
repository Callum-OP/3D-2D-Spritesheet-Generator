import { zip } from 'fflate'

// ---------------------------------------------------------------------------
// Zip bundling (Phase 3) — package individual sprite frames + a manifest into a
// single downloadable archive, so exporting "a folder of images" is one save
// instead of hundreds of download prompts.
// ---------------------------------------------------------------------------

// Bundle a { path: Uint8Array } map into a zip Blob. PNGs are already compressed,
// so we store them (level 0) — fast, and re-deflating wouldn't shrink them.
export function zipToBlob(files) {
  return new Promise((resolve, reject) => {
    const opts = {}
    for (const name of Object.keys(files)) opts[name] = [files[name], { level: 0 }]
    zip(opts, (err, data) => {
      if (err) reject(err)
      // `data` is a view into fflate's buffer; copy so the Blob owns its bytes.
      else resolve(new Blob([data.slice()], { type: 'application/zip' }))
    })
  })
}

// Zero-pad `i` to the width of `total` (e.g. 128 frames -> "007").
export function padIndex(i, total) {
  const width = String(Math.max(1, total - 1)).length
  return String(i).padStart(width, '0')
}

// Encode a JS object as pretty JSON bytes for inclusion in a zip.
export function jsonBytes(obj) {
  return new TextEncoder().encode(JSON.stringify(obj, null, 2))
}
