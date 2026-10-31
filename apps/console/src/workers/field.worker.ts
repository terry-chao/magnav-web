/// <reference lib="webworker" />
import { buildFieldLines, MAGNETIC_MODEL } from '@magnav/protocol';
import type { Vec3 } from '@magnav/protocol';

interface FieldRequest {
  id: number;
  tip: Vec3;
  moment: Vec3;
  highQuality?: boolean;
}

self.onmessage = (event: MessageEvent<FieldRequest>) => {
  const { id, tip, moment, highQuality } = event.data;
  const positions = buildFieldLines(tip, moment, {
    count: highQuality ? MAGNETIC_MODEL.lineCount * 2 : MAGNETIC_MODEL.lineCount,
    steps: highQuality ? MAGNETIC_MODEL.lineSteps : 36,
    stepMm: highQuality ? 5 : 7,
  });
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, positions }, [positions.buffer]);
};
