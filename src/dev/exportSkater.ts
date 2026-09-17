import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Turns the Mixamo FBX into the GLB the game ships, using the same loader the game once used, so
 * every bone keeps exactly the local frame the pose code was fitted against. Blender's FBX
 * importer rebuilds bones in its own convention and the skaters come out lying on the ice.
 *
 * Only the diffuse texture survives, at 2048² as JPEG where it is opaque and at 512² where it
 * has an alpha channel (eyelashes); the game paints the clothes itself. The FBX loader hands
 * back unindexed triangles, so every mesh is indexed here, which is most of the saving.
 * Runs in the browser, driven by scripts/export-skater.mjs.
 */
const CUTOUT_SIZE = 512;
export async function exportSkater(url: string): Promise<ArrayBuffer> {
  const template = await new FBXLoader().loadAsync(url);
  // The loader hands the model back before its embedded textures have decoded.
  await texturesReady(template);
  template.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
      THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;
    // The game recolours these, so their textures would only be dead weight.
    const painted = /shirt|pant|sneaker|shoe/i.test(mesh.name);
    let map = painted ? null : src.map;
    if (map && !src.transparent) map.userData.mimeType = 'image/jpeg';
    if (map && src.transparent) map = shrink(map, CUTOUT_SIZE);
    mesh.geometry = mergeVertices(mesh.geometry);
    mesh.material = new THREE.MeshStandardMaterial({
      map,
      color: src.color,
      transparent: src.transparent,
      opacity: src.opacity,
      alphaTest: src.alphaTest,
      side: src.side,
    });
  });
  const out = await new GLTFExporter().parseAsync(template, {
    binary: true,
    trs: true,
    maxTextureSize: 2048,
  });
  return out as ArrayBuffer;
}

function texturesReady(root: THREE.Object3D) {
  const maps: THREE.Texture[] = [];
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshPhongMaterial | undefined;
    if (material?.map) maps.push(material.map);
  });
  const ready = () =>
    maps.every((map) => {
      const image = map.image as { complete?: boolean } | undefined;
      return !!image && image.complete !== false;
    });
  return new Promise<void>((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (ready()) return resolve();
      if (performance.now() - started > 60_000) return reject(new Error('textures never decoded'));
      setTimeout(check, 50);
    };
    check();
  });
}

/** The same texture drawn at a smaller size. */
function shrink(map: THREE.Texture, size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.drawImage(map.image as CanvasImageSource, 0, 0, size, size);
  const small = map.clone();
  small.image = canvas;
  small.needsUpdate = true;
  return small;
}
