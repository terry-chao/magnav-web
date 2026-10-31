import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { V, pointAtS } from '@magnav/protocol';
import type { Plan, Vec3 } from '@magnav/protocol';

interface Props {
  plan: Plan;
  visible?: boolean;
  dimmed?: boolean;
  showTargetLabel?: boolean;
}

function slice(path: readonly Vec3[], startS: number, endS: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const step = 2;
  for (let s = startS; s <= endS + 0.001; s += step) {
    const p = pointAtS(path, s).point;
    points.push([p[0], p[1], p[2]]);
  }
  const end = pointAtS(path, endS).point;
  const last = points[points.length - 1];
  if (!last || V.dist(last as Vec3, end) > 0.5) points.push([end[0], end[1], end[2]]);
  return points;
}

function TargetMarker({ plan, showLabel }: { plan: Plan; showLabel: boolean }) {
  const group = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const end = plan.path[plan.path.length - 1]!;
  const prev = plan.path[Math.max(0, plan.path.length - 3)]!;
  const quaternion = useMemo(() => {
    const tangent = new THREE.Vector3(
      end[0] - prev[0],
      end[1] - prev[1],
      end[2] - prev[2],
    ).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  }, [end, prev]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ringA.current) {
      const s = 1 + Math.sin(t * 2.2) * 0.08;
      ringA.current.scale.setScalar(s);
      (ringA.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 2.2) * 0.15;
    }
    if (ringB.current) {
      const s = 1 + ((t * 0.55) % 1) * 0.9;
      ringB.current.scale.setScalar(s);
      (ringB.current.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - ((t * 0.55) % 1));
    }
    void group;
  });

  return (
    <group position={end} quaternion={quaternion}>
      <mesh ref={ringA}>
        <torusGeometry args={[9.6, 0.7, 8, 48]} />
        <meshBasicMaterial
          color="#ffcf7a"
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={ringB}>
        <torusGeometry args={[9.6, 0.3, 8, 48]} />
        <meshBasicMaterial
          color="#ffe4ad"
          transparent
          opacity={0.45}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.9, 16, 12]} />
        <meshBasicMaterial color="#ffe4ad" toneMapped={false} />
      </mesh>
      {showLabel ? (
        <Html position={[0, 14, 0]} center distanceFactor={260} zIndexRange={[8, 0]}>
          <div className="target-tag">TARGET · {plan.targetS.toFixed(0)} mm</div>
        </Html>
      ) : null}
    </group>
  );
}

export function TargetPath({ plan, visible = true, dimmed = false, showTargetLabel = false }: Props) {
  const segments = useMemo(
    () =>
      plan.segments.map((segment, index) => ({
        segment,
        points: slice(plan.path, segment.startS, segment.endS),
        color: ['#2a9aa6', '#44cdbf', '#8cf4e7', '#b8fff3'][index % 4]!,
      })),
    [plan],
  );
  const entry = plan.path[0]!;

  if (!visible) return null;
  return (
    <group>
      {segments.map(({ segment, points, color }) => (
        <Line
          key={segment.index}
          points={points}
          color={color}
          lineWidth={dimmed ? 1.3 : 2.1}
          transparent
          opacity={dimmed ? 0.32 : 0.8}
          depthWrite={false}
        />
      ))}
      <TargetMarker plan={plan} showLabel={showTargetLabel} />
      <group position={entry}>
        <mesh>
          <torusGeometry args={[3.2, 0.3, 6, 24]} />
          <meshBasicMaterial
            color="#3c8fa0"
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
