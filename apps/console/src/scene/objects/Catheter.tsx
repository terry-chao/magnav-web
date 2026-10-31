import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { LIMITS } from '@magnav/protocol';
import type { Quat, Vec3 } from '@magnav/protocol';
import { hot } from '../../telemetry/hot';
import { serverNow } from '../../services/clock';
import {
  CATHETER_SECTIONS,
  createCatheterGeometry,
  updateCatheterGeometry,
} from '../buildCatheterGeometry';
export interface PlaybackFrame {
  progress: number;
  tip: Vec3;
  q: Quat;
  moment: Vec3;
  shape: Float32Array;
}

interface Props {
  playback?: PlaybackFrame | null;
  frozen?: boolean;
}

export function Catheter({ playback = null, frozen = false }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const tipRef = useRef<THREE.Group>(null);
  const momentRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => createCatheterGeometry(), []);
  const lineGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c7fdff',
        emissive: '#25d9e8',
        emissiveIntensity: 2.2,
        roughness: 0.32,
        metalness: 0.15,
        toneMapped: false,
      }),
    [],
  );
  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#7ffcf1',
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );
  const tipMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f7ffff',
        emissive: '#6ef4ff',
        emissiveIntensity: 2.8,
        roughness: 0.2,
        metalness: 0.3,
        toneMapped: false,
      }),
    [],
  );
  const torqueMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffc46b',
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => lineGeometry.dispose(), [lineGeometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => lineMaterial.dispose(), [lineMaterial]);
  useEffect(() => () => tipMaterial.dispose(), [tipMaterial]);
  useEffect(() => () => torqueMaterial.dispose(), [torqueMaterial]);

  const centerline = useMemo(() => {
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.frustumCulled = false;
    return line;
  }, [lineGeometry, lineMaterial]);

  const applyFrame = (shape: Float32Array, tip: Vec3, q: Quat, moment: Vec3) => {
    updateCatheterGeometry(geometry, shape);
    const tipPos = new THREE.Vector3();
    // shape coordinates are LPS; the group lives under worldRoot so no manual swap
    tipPos.set(tip[0], tip[1], tip[2]);
    if (tipRef.current) {
      tipRef.current.position.copy(tipPos);
      // local frame is LPS; worldRoot applies F, so use the raw LPS quaternion
      tipRef.current.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    if (momentRef.current) {
      momentRef.current.position.copy(tipPos);
      momentRef.current.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(moment[0], moment[1], moment[2]).normalize(),
      );
    }
    const linePos = lineGeometry.getAttribute('position') as THREE.BufferAttribute;
    const L = linePos.array as Float32Array;
    const count = Math.min(96, Math.floor(shape.length / 3));
    for (let i = 0; i < count; i += 1) {
      L[i * 3] = shape[i * 3]!;
      L[i * 3 + 1] = shape[i * 3 + 1]!;
      L[i * 3 + 2] = shape[i * 3 + 2]!;
    }
    linePos.needsUpdate = true;
    lineGeometry.computeBoundingSphere();
  };

  useEffect(() => {
    if (!playback) return;
    applyFrame(playback.shape, playback.tip, playback.q, playback.moment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  useFrame(() => {
    if (playback || frozen) return;
    const frame = hot.sampleAt(serverNow() - LIMITS.renderDelayMs);
    if (!frame) return;
    applyFrame(frame.shape, frame.tip.t, frame.tip.q, frame.moment);
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={5}
      />
      <primitive object={centerline} />
      <group ref={tipRef}>
        <mesh material={tipMaterial}>
          <sphereGeometry args={[2.1, 20, 16]} />
        </mesh>
        <mesh material={tipMaterial} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[3.4, 0.34, 8, 28]} />
        </mesh>
        <pointLight color="#5ef2ff" intensity={1.4} distance={34} decay={2} />
      </group>
      <group ref={momentRef}>
        <mesh material={torqueMaterial} position={[0, 0, 9]}>
          <coneGeometry args={[1.35, 18, 12]} />
        </mesh>
        <mesh material={torqueMaterial} position={[0, 0, -1]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.6, 0.18, 6, 18]} />
        </mesh>
      </group>
    </group>
  );
}

export { CATHETER_SECTIONS };
