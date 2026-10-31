import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { LIMITS } from '@magnav/protocol';
import type { Vec3 } from '@magnav/protocol';
import { hot } from '../../telemetry/hot';
import { serverNow } from '../../services/clock';

interface Props {
  visible?: boolean;
  playback?: { tip: Vec3; moment: Vec3 } | null;
  highQuality?: boolean;
}

export function FieldLines({ visible = true, playback = null, highQuality = false }: Props) {
  const [positions, setPositions] = useState<Float32Array>(() => new Float32Array(0));
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: '#63f3e2',
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/field.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<{ id: number; positions: Float32Array }>) => {
      if (event.data.id !== requestId.current) return;
      setPositions(event.data.positions);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const push = () => {
      if (!workerRef.current) return;
      let tip: Vec3 | null = null;
      let moment: Vec3 | null = null;
      if (playback) {
        tip = playback.tip;
        moment = playback.moment;
      } else {
        const frame = hot.sampleAt(serverNow() - LIMITS.renderDelayMs) ?? hot.latest;
        if (frame) {
          tip = frame.tip.t;
          moment = frame.moment;
        }
      }
      if (!tip || !moment) return;
      requestId.current += 1;
      workerRef.current.postMessage({
        id: requestId.current,
        tip,
        moment,
        highQuality,
      });
    };
    push();
    const timer = window.setInterval(push, 200);
    return () => window.clearInterval(timer);
  }, [visible, playback, highQuality]);

  useEffect(() => {
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr || attr.array.length !== positions.length) {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    } else {
      (attr.array as Float32Array).set(positions);
      attr.needsUpdate = true;
    }
    geometry.computeBoundingSphere();
  }, [geometry, positions]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (!visible || positions.length === 0) return null;
  return <lineSegments geometry={geometry} material={material} renderOrder={4} />;
}
