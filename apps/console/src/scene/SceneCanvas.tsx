import { Component, type ReactNode, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { SceneContent, type SceneProps } from './SceneContent';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <div className="scene-fallback">
          <div className="scene-fallback__title">3D 渲染不可用</div>
          <p>已保留 2D / 数值视图，接管与中止功能不受影响。</p>
          <button type="button" className="btn btn-ghost" onClick={() => this.setState({ failed: false })}>
            重新初始化 3D
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function ContextGuard() {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.scene-canvas canvas');
    if (!canvas) return;
    const onLost = (event: Event) => {
      event.preventDefault();
      setLost(true);
    };
    const onRestored = () => setLost(false);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, []);
  return lost ? (
    <div className="scene-lost">
      <span className="dot dot--danger" /> 渲染上下文丢失，正在恢复…
    </div>
  ) : null;
}

export function SceneCanvas({ className = '', ...props }: SceneProps & { className?: string }) {
  return (
    <SceneBoundary>
      <div className={`scene-canvas ${className}`}>
        <Canvas
          dpr={[1, 1.8]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            stencil: false,
          }}
          camera={{ fov: 38, near: 1, far: 3000, position: [430, 290, 480] }}
          onCreated={({ gl }) => {
            gl.setClearColor(new THREE.Color('#05090e'), 0);
            gl.toneMappingExposure = 1.05;
          }}
        >
          <SceneContent {...props} />
        </Canvas>
        <ContextGuard />
      </div>
    </SceneBoundary>
  );
}
