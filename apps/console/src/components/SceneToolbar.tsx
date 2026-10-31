import { Crosshair, Eye, EyeOff, Layers, RotateCcw } from 'lucide-react';
import type { ViewPreset } from '../scene/CameraRig';
import { VIEW_PRESETS } from '../scene/CameraRig';
import type { SceneLayers } from '../scene/SceneContent';

const PRESET_ORDER: ViewPreset[] = ['ISO', 'AP', 'LAO30', 'RAO30', 'CRAN', 'CAUD'];

const LAYER_LABELS: Array<{ key: keyof SceneLayers; label: string }> = [
  { key: 'vessels', label: '血管' },
  { key: 'path', label: '路径' },
  { key: 'coils', label: '线圈' },
  { key: 'field', label: '场线' },
  { key: 'phantom', label: '体表' },
];

export function SceneToolbar({
  preset,
  onPreset,
  layers,
  onLayers,
  picking,
  onPicking,
  extra,
}: {
  preset: ViewPreset;
  onPreset: (preset: ViewPreset) => void;
  layers: SceneLayers;
  onLayers: (layers: SceneLayers) => void;
  picking?: boolean;
  onPicking?: (value: boolean) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="scene-toolbar">
      <div className="scene-toolbar__group">
        <span className="scene-toolbar__label">C-ARM</span>
        {PRESET_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`scene-toolbar__preset ${preset === key ? 'is-active' : ''}`}
            onClick={() => onPreset(key)}
            title={`${VIEW_PRESETS[key].label} 视角`}
          >
            {VIEW_PRESETS[key].label}
          </button>
        ))}
        <button
          type="button"
          className="scene-toolbar__preset"
          title="复位视角"
          onClick={() => onPreset('ISO')}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div className="scene-toolbar__group scene-toolbar__group--layers">
        <span className="scene-toolbar__label">
          <Layers size={12} /> 图层
        </span>
        {LAYER_LABELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`layer-chip ${layers[key] ? 'is-on' : ''}`}
            onClick={() => onLayers({ ...layers, [key]: !layers[key] })}
            title={layers[key] ? `隐藏${label}` : `显示${label}`}
          >
            {layers[key] ? <Eye size={12} /> : <EyeOff size={12} />}
            {label}
          </button>
        ))}
      </div>
      {onPicking ? (
        <button
          type="button"
          className={`scene-toolbar__pick ${picking ? 'is-active' : ''}`}
          onClick={() => onPicking(!picking)}
          title="在 3D 血管上点击选择目标"
        >
          <Crosshair size={14} />
          {picking ? '点击血管选目标' : '选择目标'}
        </button>
      ) : null}
      {extra}
    </div>
  );
}
