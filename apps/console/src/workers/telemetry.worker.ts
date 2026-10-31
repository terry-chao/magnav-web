/// <reference lib="webworker" />
import { decodeTelemetry } from '@magnav/protocol';

interface DecodeRequest {
  buffer: ArrayBuffer;
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { buffer } = event.data;
  try {
    const frame = decodeTelemetry(buffer);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(frame, [buffer]);
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      error: error instanceof Error ? error.message : 'decode failed',
    });
  }
};
