import { useEffect, useRef } from 'react';
import { LIMITS, V, type Plan, type VesselTree } from '@magnav/protocol';
import { hot } from '../../telemetry/hot';
import { serverNow } from '../../services/clock';
import type { PlaybackFrame } from '../../scene/objects/Catheter';
import type { ViewPreset } from '../../scene/CameraRig';

interface Props {
  tree: VesselTree;
  plan: Plan;
  playback?: PlaybackFrame | null;
  viewPreset?: ViewPreset;
  stale?: boolean;
  replay?: boolean;
  className?: string;
}

const PRESET_ANGLE: Record<ViewPreset, number> = {
  ISO: 0,
  AP: 0,
  PA: 0,
  LAO30: -30,
  RAO30: 30,
  CRAN: 0,
  CAUD: 0,
};

/**
 * Synthetic 2D fluoroscopy panel. The projection is a stylised parallel
 * projection of the same centreline data used by the 3D view — it exists so
 * the operator always has a low-cost fallback view, not as a DICOM viewer.
 */
export function DsaPanel({ tree, plan, playback = null, viewPreset = 'ISO', stale = false, replay = false, className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef({ tree, plan, playback, viewPreset, stale });
  dataRef.current = { tree, plan, playback, viewPreset, stale };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 66) return;
      last = now;
      const { tree, plan, playback, viewPreset, stale } = dataRef.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const bg = ctx.createRadialGradient(width * 0.5, height * 0.46, 4, width * 0.5, height * 0.5, width * 0.72);
      bg.addColorStop(0, '#0d1a1d');
      bg.addColorStop(0.55, '#050a0c');
      bg.addColorStop(1, '#010305');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // vignette
      ctx.strokeStyle = 'rgba(120, 220, 210, 0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i += 1) {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, (Math.min(width, height) / 2) * (i / 3.4), 0, Math.PI * 2);
        ctx.stroke();
      }

      const angle = (PRESET_ANGLE[viewPreset] * Math.PI) / 180;
      const raw = tree.branches.flatMap((b) => b.points);
      const projected = raw.map((p) => {
        const x = p[0] * Math.cos(angle) - p[1] * Math.sin(angle);
        return [x, p[2]] as [number, number];
      });
      const xs = projected.map((p) => p[0]);
      const zs = projected.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const pad = 18;
      const sx = (width - pad * 2) / Math.max(1, maxX - minX);
      const sy = (height - pad * 2) / Math.max(1, maxZ - minZ);
      const scale = Math.min(sx, sy);
      const ox = width / 2 - ((minX + maxX) / 2) * scale;
      const oy = height / 2 + ((minZ + maxZ) / 2) * scale;
      const toCanvas = (p: readonly [number, number, number]): [number, number] => {
        const x = p[0] * Math.cos(angle) - p[1] * Math.sin(angle);
        return [ox + x * scale, oy - p[2] * scale];
      };

      // vessels
      for (const branch of tree.branches) {
        const pts = branch.points.map(toCanvas);
        const meanRadius = branch.radii.reduce((a, b) => a + b, 0) / branch.radii.length;
        ctx.beginPath();
        pts.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.strokeStyle = branch.stenosis ? 'rgba(255, 190, 120, 0.5)' : 'rgba(126, 196, 190, 0.42)';
        ctx.lineWidth = Math.max(0.7, meanRadius * scale * 0.85);
        ctx.shadowColor = 'rgba(90, 220, 205, 0.4)';
        ctx.shadowBlur = 5;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // target
      const target = toCanvas(plan.target);
      ctx.beginPath();
      ctx.arc(target[0], target[1], 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 207, 122, 0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(target[0], target[1], 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 224, 173, 0.9)';
      ctx.fill();

      // catheter
      const liveFrame = playback
        ? null
        : (hot.sampleAt(serverNow() - LIMITS.renderDelayMs) ?? hot.latest);
      const shape = playback ? playback.shape : liveFrame?.shape;
      const tipPoint: readonly [number, number, number] | null = playback
        ? playback.tip
        : liveFrame?.tip.t ?? null;
      if (shape && tipPoint && !stale) {
        ctx.beginPath();
        for (let i = 0; i < 96; i += 1) {
          const [x, y] = toCanvas([shape[i * 3]!, shape[i * 3 + 1]!, shape[i * 3 + 2]!]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(120, 255, 240, 0.95)';
        ctx.lineWidth = 1.4;
        ctx.shadowColor = 'rgba(90, 255, 235, 0.9)';
        ctx.shadowBlur = 7;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const tip = toCanvas(tipPoint);
        ctx.strokeStyle = 'rgba(160, 255, 245, 0.5)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(tip[0] - 9, tip[1]);
        ctx.lineTo(tip[0] + 9, tip[1]);
        ctx.moveTo(tip[0], tip[1] - 9);
        ctx.lineTo(tip[0], tip[1] + 9);
        ctx.stroke();
      }

      // scan line + frame counter
      ctx.fillStyle = 'rgba(80, 220, 205, 0.035)';
      for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const angleLabel =
    viewPreset === 'LAO30'
      ? 'LAO 30°'
      : viewPreset === 'RAO30'
        ? 'RAO 30°'
        : viewPreset === 'CRAN'
          ? 'CRAN 25°'
          : viewPreset === 'CAUD'
            ? 'CAUD 25°'
            : viewPreset === 'PA'
              ? 'PA'
              : 'AP';

  return (
    <div ref={wrapRef} className={`dsa ${className}`}>
      <canvas ref={canvasRef} />
      <div className="dsa__badge">
        <span className={`dot ${stale ? 'dot--danger' : 'dot--live'}`} />
        {stale ? 'SIGNAL LOST' : replay ? 'REPLAY · DSA' : 'LIVE · DSA'}
      </div>
      <div className="dsa__meta">
        <span>{angleLabel}</span>
        <span>FOV 180 mm</span>
        <span className="mono">{new Date().toLocaleTimeString('zh-CN', { hour12: false })}</span>
      </div>
      <div className="dsa__scale">
        <span />
        20 mm
      </div>
      {stale ? <div className="dsa__lost">位姿数据中断 · 冻结显示</div> : null}
    </div>
  );
}
