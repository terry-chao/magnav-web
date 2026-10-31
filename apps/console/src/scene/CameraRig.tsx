import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

export type ViewPreset = 'ISO' | 'AP' | 'PA' | 'LAO30' | 'RAO30' | 'CRAN' | 'CAUD';

export const VIEW_PRESETS: Record<ViewPreset, { label: string; offset: [number, number, number] }> = {
  ISO: { label: 'ISO', offset: [430, 290, 480] },
  AP: { label: 'AP', offset: [0, 70, 640] },
  PA: { label: 'PA', offset: [0, 70, -640] },
  LAO30: { label: 'LAO 30°', offset: [-330, 80, 550] },
  RAO30: { label: 'RAO 30°', offset: [330, 80, 550] },
  CRAN: { label: 'CRAN', offset: [0, 590, 170] },
  CAUD: { label: 'CAUD', offset: [0, -340, 540] },
};

interface Props {
  preset: ViewPreset;
  center: THREE.Vector3;
}

export function CameraRig({ preset, center }: Props) {
  const camera = useThree((state) => state.camera);
  const controls = useRef<any>(null);
  const animation = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    start: number;
    active: boolean;
  }>({ from: new THREE.Vector3(), to: new THREE.Vector3(), start: 0, active: false });

  useEffect(() => {
    const offset = VIEW_PRESETS[preset].offset;
    const target = new THREE.Vector3(center.x + offset[0], center.y + offset[1], center.z + offset[2]);
    animation.current = {
      from: camera.position.clone(),
      to: target,
      start: performance.now(),
      active: true,
    };
    if (controls.current?.target) {
      controls.current.target.copy(center);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, center.x, center.y, center.z]);

  useFrame(() => {
    const anim = animation.current;
    if (!anim.active) return;
    const t = Math.min(1, (performance.now() - anim.start) / 480);
    const ease = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(anim.from, anim.to, ease);
    if (controls.current?.target) {
      controls.current.target.lerp(center, 0.12);
      controls.current.update();
    }
    if (t >= 1) anim.active = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={center}
      enableDamping
      dampingFactor={0.08}
      minDistance={110}
      maxDistance={1600}
      maxPolarAngle={Math.PI * 0.94}
      minPolarAngle={Math.PI * 0.06}
      panSpeed={0.75}
      rotateSpeed={0.72}
      zoomSpeed={0.8}
    />
  );
}
