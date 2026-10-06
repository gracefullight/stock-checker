import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants';
import { describe, expect, it } from 'vitest';
import { buildPipelineConfig, playgroundParamsFromConfig } from '@/features/backtest/utils/config';

describe('browser backtest strategy snapshot', () => {
  it('keeps all active runtime settings when the controls are unchanged', () => {
    const active = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    active.thresholds.buy = 215;
    active.institutional.weights.rsSpy = 0.3;
    active.qualityGate.rsMin = 0.75;

    const result = buildPipelineConfig(playgroundParamsFromConfig(active), active);

    expect(result).toEqual(active);
    expect(result).not.toBe(active);
    result.institutional!.weights.rsSpy = 0.4;
    expect(active.institutional.weights.rsSpy).toBe(0.3);
  });

  it('applies research control edits without discarding the remaining active configuration', () => {
    const active = structuredClone(DEFAULT_QUALITY_PIPELINE_CONFIG);
    active.qualityGate.volRMin = 0.9;
    const original = structuredClone(active);
    const params = { ...playgroundParamsFromConfig(active), buyThreshold: 220, ibsMax: 0.25 };

    const result = buildPipelineConfig(params, active);

    expect(result.thresholds.buy).toBe(220);
    expect(result.qualityGate?.ibsMax).toBe(0.25);
    expect(result.qualityGate?.volRMin).toBe(0.9);
    expect(result.indicatorWeights).toEqual(active.indicatorWeights);
    expect(result.institutional).toEqual(active.institutional);
    expect(active).toEqual(original);
  });
});
