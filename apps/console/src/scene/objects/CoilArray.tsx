import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useSyncExternalStore } from 'react';
import { COIL_SPECS, LIMITS } from '@magnav/protocol';
import type { TelemetryFrame } from '@magnav/protocol';
import { hot } from '../../telemetry/hot';

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.22, 'rgba(160,255,240,0.6)');
  gradient.addColorStop(0.55, 'rgba(60,220,200,0.16)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function coilColor(load: number, saturated: boolean, temperature: number): THREE.Color {
  const cold = new THREE.Color('#123039');
  const warm = new THREE.Color('#53f2e2');
  const hot = new THREE.Color('#ffb454');
  const danger = new THREE.Color('#ff5d6c');
  if (saturated) return danger;
  const color = cold.clone().lerp(warm, Math.min(1, load * 1.15));
  if (temperature > LIMITS.coilTempWarn) {
    color.lerp(hot, Math.min(1, (temperature - LIMITS.coilTempWarn) / 9));
  }
  return color;
}

interface Props {
  visible?: boolean;
  playback?: TelemetryFrame | null;
}

export function CoilArray({ visible = true, playback = null }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const version = useSyncExternalStore(hot.subscribe, hot.getVersion);

  const geometry = useMemo(() => new THREE.TorusGeometry(19, 2.5, 9, 36), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.58,
        toneMapped: false,
      }),
    [],
  );
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const glowMaterial = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 46,
        map: glowTexture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    [glowTexture],
  );
  const glowGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array(COIL_SPECS.length * 3);
    const colors = new Float32Array(COIL_SPECS.length * 3);
    COIL_SPECS.forEach((coil, i) => {
      positions[i * 3] = coil.position[0];
      positions[i * 3 + 1] = coil.position[1];
      positions[i * 3 + 2] = coil.position[2];
      colors[i * 3] = 0.1;
      colors[i * 3 + 1] = 0.25;
      colors[i * 3 + 2] = 0.3;
    });
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    COIL_SPECS.forEach((coil, i) => {
      dummy.position.set(coil.position[0], coil.position[1], coil.position[2]);
      dummy.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(coil.axis[0], coil.axis[1], coil.axis[2]).normalize(),
      );
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color('#183d46'));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useEffect(() => {
    void version;
    const frame = playback ?? hot.latest;
    const mesh = meshRef.current;
    const points = pointsRef.current;
    const color = new THREE.Color();
    for (let i = 0; i < COIL_SPECS.length; i += 1) {
      const current = Math.abs(frame?.coils[i] ?? 0);
      const load = Math.min(1, current / COIL_SPECS[i]!.maxCurrentA);
      const saturated = load >= 0.985;
      const temperature = 32 + load * 26;
      color.copy(coilColor(load, saturated, temperature));
      mesh?.setColorAt(i, color);
      if (points) {
        const attr = points.geometry.getAttribute('color') as THREE.BufferAttribute;
        const array = attr.array as Float32Array;
        array[i * 3] = color.r;
        array[i * 3 + 1] = color.g;
        array[i * 3 + 2] = color.b;
        attr.needsUpdate = true;
      }
    }
    if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [version, playback]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      glowTexture.dispose();
    },
    [geometry, material, glowGeometry, glowMaterial, glowTexture],
  );

  if (!visible) return null;
  return (
    <group>
      <instancedMesh ref={meshRef} args={[geometry, material, COIL_SPECS.length]} renderOrder={3} />
      <points ref={pointsRef} geometry={glowGeometry} material={glowMaterial} renderOrder={4} />
    </group>
  );
}
