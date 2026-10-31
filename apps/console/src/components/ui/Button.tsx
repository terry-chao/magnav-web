import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { playClick } from '../../services/audio';

type Variant = 'default' | 'primary' | 'danger' | 'warn' | 'ghost' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  trailing?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', icon, trailing, block, className = '', children, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      className={`btn btn--${variant} btn--${size} ${block ? 'btn--block' : ''} ${className}`}
      onClick={(event) => {
        playClick();
        onClick?.(event);
      }}
      {...rest}
    >
      {icon ? <span className="btn__icon">{icon}</span> : null}
      <span className="btn__label">{children}</span>
      {trailing ? <span className="btn__trailing">{trailing}</span> : null}
    </button>
  );
});

interface HoldButtonProps extends Omit<ButtonProps, 'onClick'> {
  onConfirm: () => void;
  holdMs?: number;
  holdLabel?: string;
  progressLabel?: string;
}

/**
 * 800 ms long-press control used for irreversible actions. Pointer release
 * before completion cancels; the progress is rendered inside the button.
 */
export function HoldButton({
  onConfirm,
  holdMs = 800,
  holdLabel = '按住确认',
  progressLabel = '继续按住…',
  disabled,
  className = '',
  children,
  ...rest
}: HoldButtonProps) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const completed = useRef(false);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setHolding(false);
    if (!completed.current) setProgress(0);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const tick = useCallback(() => {
    const elapsed = performance.now() - start.current;
    const next = Math.min(1, elapsed / holdMs);
    setProgress(next);
    if (next >= 1) {
      completed.current = true;
      setHolding(false);
      setProgress(0);
      onConfirm();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }, [holdMs, onConfirm]);

  const begin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    completed.current = false;
    start.current = performance.now();
    setHolding(true);
    setProgress(0);
    playClick();
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <Button
      {...rest}
      disabled={disabled}
      className={`btn--hold ${holding ? 'is-holding' : ''} ${className}`}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      <span className="btn__hold-track" style={{ transform: `scaleX(${progress})` }} />
      <span className="btn__label">{holding ? progressLabel : children ?? holdLabel}</span>
    </Button>
  );
}
