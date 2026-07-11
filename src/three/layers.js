// ---------------------------------------------------------------------------
// Layers (Phase 5) — group a model's meshes into exportable "layers".
//
// A layer is a set of mesh UUIDs that get rendered together as one aligned
// spritesheet (body, shirt, hat…). Clothing is usually already separate meshes,
// but a single garment is often split into several meshes by material — those
// share a base name ("Shirt.001", "Shirt_2"), so we merge them under one layer.
//
// Layer isolation during capture is ONLY mesh.visible toggling (see scene.js);
// the camera never moves between layers, so shirt.png overlays body.png exactly.
// ---------------------------------------------------------------------------

// Strip a trailing material/duplicate suffix so split meshes group together:
//   "Shirt.001" / "Shirt_2" / "Body 3" / "Hat-1" -> "Shirt" / "Body" / "Hat".
export function layerBaseName(name) {
  const raw = String(name || '').trim()
  const stripped = raw.replace(/[._\s-]?\d+$/, '').trim()
  return stripped || raw || 'Part'
}

// Group a lightweight mesh list ([{ uuid, name }]) into layers, preserving first
// appearance order. Returns [{ id, name, uuids: string[] }].
export function buildLayers(meshes) {
  const map = new Map()
  for (const m of meshes || []) {
    const name = layerBaseName(m.name)
    const id = name.toLowerCase()
    if (!map.has(id)) map.set(id, { id, name, uuids: [] })
    map.get(id).uuids.push(m.uuid)
  }
  return Array.from(map.values())
}

// Resolve which layers are selected for export. `selection` is a { [id]: bool }
// map where an ABSENT entry means selected (so a fresh model exports everything
// by default). Returns export groups [{ key, label, uuids }].
export function selectedGroups(layers, selection) {
  return layers
    .filter((l) => !selection || selection[l.id] !== false)
    .map((l) => ({ key: l.id, label: l.name, uuids: l.uuids }))
}
