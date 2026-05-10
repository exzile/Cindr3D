import { useEffect, useState } from 'react';
import * as THREE from 'three';

export type ThumbnailEntry = { url: string; accent: string };

/**
 * Renders a list of STL files to PNG data-URL thumbnails using a single shared
 * off-screen WebGLRenderer (one GL context for the whole batch).
 *
 * Returns a Map<url -> dataUrl> that fills in progressively as each model loads.
 */
export function useStlThumbnails(entries: ThumbnailEntry[]): Map<string, string> {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let disposed = false;

    (async () => {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      if (disposed) return;

      const W = 320;
      const H = 200;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(W, H);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 5000);
      camera.up.set(0, 0, 1);

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.3);
      key.position.set(3, 5, 4);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xaaccff, 0.35);
      fill.position.set(-3, 1, -2);
      scene.add(fill);

      const loader = new STLLoader();

      for (const { url, accent } of entries) {
        if (disposed) break;

        await new Promise<void>((resolve) => {
          loader.load(
            url,
            (geo) => {
              if (disposed) {
                geo.dispose();
                resolve();
                return;
              }

              geo.computeBoundingBox();
              const box = geo.boundingBox!;
              const center = new THREE.Vector3();
              box.getCenter(center);
              const size = new THREE.Vector3();
              box.getSize(size);
              const maxDim = Math.max(size.x, size.y, size.z);

              geo.translate(-center.x, -center.y, -center.z);

              const mat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(accent),
                roughness: 0.42,
                metalness: 0.06,
              });
              const mesh = new THREE.Mesh(geo, mat);
              // Eye-level front view so the model reads like a first-person preview without appearing tilted.
              scene.add(mesh);

              const dist = maxDim * 2.15;
              camera.position.set(dist * 0.12, -dist, Math.max(size.z * 0.24, maxDim * 0.2));
              camera.lookAt(0, 0, Math.max(size.z * 0.08, maxDim * 0.05));

              renderer.render(scene, camera);
              const dataUrl = renderer.domElement.toDataURL('image/png');

              setThumbnails((prev) => new Map(prev).set(url, dataUrl));

              scene.remove(mesh);
              geo.dispose();
              mat.dispose();
              resolve();
            },
            undefined,
            () => resolve(),
          );
        });
      }

      renderer.dispose();
    })();

    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return thumbnails;
}
