import { useEffect, useRef } from 'react';

interface Props {
  values: readonly number[];
  height?: number;
  color?: string;
  fill?: boolean;
  min?: number;
  max?: number;
  marker?: number | null;
  grid?: number;
  className?: string;
}

/** Lightweight canvas sparkline (thousands of points without ECharts). */
export function Sparkline({
  values,
  height = 52,
  color = '#4de2d0',
  fill = true,
  min: minProp,
  max: maxProp,
  marker = null,
  grid = 2,
  className = '',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = wrap.clientWidth || 280;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const min = minProp ?? Math.min(...values, 0);
    const max = maxProp ?? Math.max(...values, min + 1);
    const span = max - min || 1;

    // grid
    ctx.strokeStyle = 'rgba(120, 180, 200, 0.10)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= grid; i += 1) {
      const y = (height / grid) * i + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (values.length < 2) return;
    const x = (index: number) => (index / (values.length - 1)) * width;
    const y = (value: number) => height - ((value - min) / span) * (height - 4) - 2;

    if (fill) {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, `${color}33`);
      gradient.addColorStop(1, `${color}00`);
      ctx.beginPath();
      ctx.moveTo(0, height);
      values.forEach((value, index) => ctx.lineTo(x(index), y(value)));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    values.forEach((value, index) => {
      if (index === 0) ctx.moveTo(x(index), y(value));
      else ctx.lineTo(x(index), y(value));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (marker !== null) {
      const mx = marker * width;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, height);
      ctx.stroke();
    }
  }, [values, height, color, fill, minProp, maxProp, marker, grid]);

  return (
    <div ref={wrapRef} className={`sparkline ${className}`}>
      <canvas ref={canvasRef} />
    </div>
  );
}
