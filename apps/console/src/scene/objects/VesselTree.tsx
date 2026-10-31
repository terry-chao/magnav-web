import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { VesselTree as VesselTreeType, Vec3 } from '@magnav/protocol';
import { buildVesselGeometry, type StenosisMarker as Marker } from '../buildVesselGeometry';

const vertexShader = /* glsl */ `
  attribute float aTone;
  attribute float aHighlight;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vTone;
  varying float vHighlight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - world.xyz;
    vTone = aTone;
    vHighlight = aHighlight;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uAccent;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying float vTone;
  varying float vHighlight;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);
    float fres = pow(1.0 - abs(dot(N, V)), 2.1);
    vec3 deep = vec3(0.055, 0.20, 0.23);
    vec3 rim  = vec3(0.22, 0.82, 0.82);
    vec3 base = mix(deep, rim, 0.25 + vTone * 0.55);
    vec3 col = base * (0.45 + 1.55 * fres) + uAccent * 0.12;
    col = mix(col, vec3(1.0, 0.72, 0.32), vHighlight * 0.34);
    float alpha = uOpacity * (0.32 + 0.68 * fres) + vHighlight * 0.08;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
  }
`;

interface Props {
  tree: VesselTreeType;
  selectedBranchId?: string | null;
  picking?: boolean;
  showLabels?: boolean;
  opacity?: number;
  onPick?: (point: Vec3) => void;
}

function StenosisRing({
  marker,
  showLabel,
}: {
  marker: Marker;
  showLabel: boolean;
}) {
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(marker.tangent[0], marker.tangent[1], marker.tangent[2]).normalize(),
    );
    return q;
  }, [marker.tangent]);

  const ring = useMemo(() => {
    const geometry = new THREE.TorusGeometry(Math.max(1.5, marker.radius * 1.8), 0.42, 8, 32);
    const material = new THREE.MeshBasicMaterial({
      color: '#ffb454',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { geometry, material };
  }, [marker.radius]);

  useEffect(
    () => () => {
      ring.geometry.dispose();
      ring.material.dispose();
    },
    [ring],
  );

  return (
    <group position={marker.position} quaternion={quaternion}>
      <mesh geometry={ring.geometry} material={ring.material} />
      {showLabel ? (
        <Html position={[0, marker.radius + 6, 0]} center distanceFactor={260} zIndexRange={[8, 0]}>
          <div className="stenosis-tag">
            <span className="stenosis-tag__dot" />
            {marker.label}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

export function VesselTree({
  tree,
  selectedBranchId,
  picking = false,
  showLabels = false,
  opacity = 0.62,
  onPick,
}: Props) {
  const data = useMemo(() => buildVesselGeometry(tree), [tree]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uOpacity: { value: opacity },
          uAccent: { value: new THREE.Color('#2dd4bf') },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      }),
    [],
  );

  useEffect(() => {
    material.uniforms.uOpacity!.value = opacity;
  }, [material, opacity]);

  useEffect(() => {
    const attr = data.geometry.getAttribute('aHighlight') as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    array.fill(0);
    if (selectedBranchId) {
      const range = data.ranges.get(selectedBranchId);
      if (range) {
        for (let i = range.start; i < range.start + range.count; i += 1) array[i] = 1;
      }
    }
    attr.needsUpdate = true;
  }, [data, selectedBranchId]);

  useEffect(
    () => () => {
      data.geometry.dispose();
      material.dispose();
    },
    [data, material],
  );

  useEffect(() => {
    if (picking) document.body.style.cursor = 'crosshair';
    return () => {
      document.body.style.cursor = '';
    };
  }, [picking]);

  return (
    <group>
      <mesh geometry={data.geometry} material={material} renderOrder={2} />
      {data.markers.map((marker) => (
        <StenosisRing key={marker.branchId} marker={marker} showLabel={showLabels} />
      ))}
    </group>
  );
}
