import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Plan, VesselTree, Vec3 } from '@magnav/protocol';
import { V } from '@magnav/protocol';
import { LPS_TO_SCENE, lpsToScene } from './coords';
import { VesselTree as VesselTreeObject } from './objects/VesselTree';
import { TargetPath } from './objects/TargetPath';
import { Catheter, type PlaybackFrame } from './objects/Catheter';
import { CoilArray } from './objects/CoilArray';
import { FieldLines } from './objects/FieldLines';
import { Phantom } from './objects/Phantom';
import { CameraRig, type ViewPreset } from './CameraRig';
import { VesselPicker } from './VesselPicker';

export interface SceneLayers {
  vessels: boolean;
  path: boolean;
  coils: boolean;
  field: boolean;
  phantom: boolean;
}

export interface SceneProps {
  tree: VesselTree;
  plan?: Plan | null;
  mode: 'planning' | 'procedure' | 'review';
  viewPreset?: ViewPreset;
  layers?: Partial<SceneLayers>;
  selectedBranchId?: string | null;
  picking?: boolean;
  draftTarget?: Vec3 | null;
  playback?: PlaybackFrame | null;
  frozen?: boolean;
  onPick?: (point: Vec3) => void;
}

const DEFAULT_LAYERS: SceneLayers = {
  vessels: true,
  path: true,
  coils: true,
  field: true,
  phantom: true,
};

export function treeCenterScene(tree: VesselTree): THREE.Vector3 {
  const { min, max } = tree.bounds;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return lpsToScene(center);
}

function DraftTarget({ point }: { point: Vec3 }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    ref.current?.position.set(point[0], point[1], point[2]);
  }, [point]);
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[1.8, 16, 12]} />
        <meshBasicMaterial color="#ffcf7a" toneMapped={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[5.5, 0.32, 6, 32]} />
        <meshBasicMaterial
          color="#ffcf7a"
          transparent
          opacity={0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export function SceneContent({
  tree,
  plan = null,
  mode,
  viewPreset = 'ISO',
  layers,
  selectedBranchId = null,
  picking = false,
  draftTarget = null,
  playback = null,
  frozen = false,
  onPick,
}: SceneProps) {
  const merged = { ...DEFAULT_LAYERS, ...layers };
  const center = useMemo(() => treeCenterScene(tree), [tree]);
  const worldRoot = useMemo(() => {
    const group = new THREE.Group();
    group.matrix.copy(LPS_TO_SCENE);
    group.matrixAutoUpdate = false;
    group.matrixWorldNeedsUpdate = true;
    return group;
  }, []);

  useEffect(() => {
    return () => {
      // worldRoot has no disposable resources itself
    };
  }, [worldRoot]);

  return (
    <>
      <ambientLight intensity={0.85} color="#9fd8e6" />
      <directionalLight position={[220, 320, 260]} intensity={1.1} color="#c4f5ff" />
      <pointLight position={[-240, 120, 160]} intensity={0.8} color="#2a8ea0" />
      <pointLight position={[0, -160, 0]} intensity={0.5} color="#164552" />

      <primitive object={worldRoot}>
        {merged.phantom ? <Phantom /> : null}
        {merged.vessels ? (
          <VesselTreeObject
            tree={tree}
            selectedBranchId={selectedBranchId}
            picking={picking}
            showLabels={false}
            opacity={mode === 'procedure' ? 0.85 : 0.9}
            onPick={onPick}
          />
        ) : null}
        {plan && merged.path ? (
          <TargetPath
            plan={plan}
            dimmed={mode === 'procedure'}
            showTargetLabel={false}
          />
        ) : null}
        {merged.coils ? <CoilArray /> : null}
        {merged.field && mode !== 'planning' ? <FieldLines /> : null}
        {mode !== 'planning' ? <Catheter playback={playback} frozen={frozen} /> : null}
        {draftTarget ? <DraftTarget point={draftTarget} /> : null}
      </primitive>

      {picking && onPick ? <VesselPicker tree={tree} onPick={onPick} /> : null}
      <gridHelper args={[1500, 60, '#0d2832', '#09151c']} position={[0, -260, 0]} renderOrder={0} />
      <CameraRig preset={viewPreset} center={center} />
      <fog attach="fog" args={['#05090e', 520, 1400]} />
    </>
  );
}
