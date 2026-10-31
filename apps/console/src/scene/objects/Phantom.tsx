import { useMemo } from 'react';
import * as THREE from 'three';

/** Very low-contrast patient envelope + room grid for spatial grounding. */
export function Phantom() {
  const shellMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#1c5b62',
        transparent: true,
        opacity: 0.022,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  return (
    <group>
      <mesh position={[0, 0, -10]} scale={[150, 95, 225]} material={shellMaterial}>
        <sphereGeometry args={[1, 32, 24]} />
      </mesh>
    </group>
  );
}
