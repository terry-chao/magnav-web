import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { Vec3, VesselTree } from '@magnav/protocol';
import { lpsToScene } from './coords';

interface Props {
  tree: VesselTree;
  onPick: (point: Vec3) => void;
}

/**
 * Screen-space vessel picker. Projects centreline samples with the live camera
 * and accepts a click within 28 px of a branch. This avoids relying on the
 * thin tube mesh as a hit target (and avoids mutating the raycast hierarchy
 * inside a pointer event).
 */
export function VesselPicker({ tree, onPick }: Props) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const element = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const scratch = new THREE.Vector3();

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      down = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !down) return;
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      down = null;
      if (Math.hypot(dx, dy) > 6) return; // orbit drag, not a pick

      const rect = element.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      let best: { screenDistance: number; point: Vec3 } | null = null;

      for (const branch of tree.branches) {
        for (const point of branch.points) {
          lpsToScene(point, scratch);
          scratch.project(camera);
          if (scratch.z < -1 || scratch.z > 1) continue;
          const sx = ((scratch.x + 1) / 2) * rect.width;
          const sy = ((1 - scratch.y) / 2) * rect.height;
          const distance = Math.hypot(localX - sx, localY - sy);
          if (!best || distance < best.screenDistance) {
            best = { screenDistance: distance, point };
          }
        }
      }

      if (best && best.screenDistance <= 28) {
        onPick(best.point);
      }
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointerup', onPointerUp);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, gl, onPick, tree]);

  return null;
}
