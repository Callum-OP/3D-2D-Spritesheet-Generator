# 3D → 2D Spritesheet Maker

Load a 3D model, give it motion (a baked clip or an imported `.bvh`), pick a
**2D-style look** (toon shading + outline), and generate a **2D spritesheet** —
or a folder of individual frames — automatically.

The headline feature is **aligned layers**: because clothing/armour are separate
meshes, each can be rendered as its *own* spritesheet using the **identical
locked camera and canvas** as every other layer, so `shirt.png` overlays
`body.png` pixel-for-pixel. Point one over the other and they match perfectly.

Everything runs **client-side** — no backend, no upload. Files never leave your
machine.

## Getting started

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run dev        # start the Vite dev server (prints a local URL)
```

> **Note (this machine):** HTTPS is intercepted by a corporate/system CA, so npm
> may hang on install. Prefix commands with the system-CA flag:
> `NODE_OPTIONS=--use-system-ca npm install`.

Then open the printed URL and drag a model file onto the viewport (or use
**Load**). Pick a look in **Style**, add motion in **Animation**, and export.

### Other scripts

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Supported model formats

| Format        | Extensions | Notes                                             |
| ------------- | ---------- | ------------------------------------------------- |
| glTF (binary) | `.glb`     | Recommended. Rig + baked animations carry over.   |
| glTF (JSON)   | `.gltf`    | Self-contained files; external assets aren't fetched. |
| Autodesk FBX  | `.fbx`     | Loaded on demand (parser is code-split).          |

> Draco-compressed glTF isn't supported — re-export with compression off.

## Tech stack

- **[Vite](https://vitejs.dev/) + [React](https://react.dev/)** (JavaScript)
- **[Three.js](https://threejs.org/)** — `GLTFLoader` / `FBXLoader` / `OrbitControls`
- **[Zustand](https://github.com/pmndrs/zustand)** for app state

## Project structure

```
src/
  App.jsx               # layout: viewport + control sidebar
  store.js              # Zustand store (UI + model state)
  components/           # shared UI widgets (e.g. click-to-edit Slider)
  three/                # scene, model loading, materials, outline, posing,
                        # animation, BVH import/retarget, plus the sprite pipeline:
                        # captureCamera (frozen ortho rig), layers (mesh grouping),
                        # spritesheet (grid/stacked packing)
  export/               # zip.js — bundle frames + manifests (fflate)
  panels/               # Model / Material (style) / Animation / Bone / Capture /
                        # Layers / Spritesheet (output) / View / Export
```