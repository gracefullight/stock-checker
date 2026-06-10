import { DEFAULT_QUALITY_PIPELINE_CONFIG } from '@stock-checker/core/src/constants';
import type { PipelineConfig } from '@stock-checker/core/src/types';

/** The playground-editable subset of PipelineConfig, seeded from the live config. */
export interface PlaygroundParams {
  strategy: PipelineConfig['strategy'];
  buyThreshold: number;
  sellThreshold: number;
  minGapDays: number;
  confluenceMinActive: number;
  qualityGateEnabled: boolean;
  ibsMax: number;
  rsMin: number;
}

export const DEFAULT_PLAYGROUND_PARAMS: PlaygroundParams = {
  strategy: DEFAULT_QUALITY_PIPELINE_CONFIG.strategy,
  buyThreshold: DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds.buy,
  sellThreshold: DEFAULT_QUALITY_PIPELINE_CONFIG.thresholds.sell,
  minGapDays: DEFAULT_QUALITY_PIPELINE_CONFIG.clusterFilter.minGapDays,
  confluenceMinActive: DEFAULT_QUALITY_PIPELINE_CONFIG.confluence.minActive,
  qualityGateEnabled: DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.enabled,
  ibsMax: DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.ibsMax,
  rsMin: DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.rsMin,
};

export function buildPipelineConfig(params: PlaygroundParams): PipelineConfig {
  return {
    ...DEFAULT_QUALITY_PIPELINE_CONFIG,
    strategy: params.strategy,
    thresholds: { buy: params.buyThreshold, sell: params.sellThreshold },
    clusterFilter: {
      ...DEFAULT_QUALITY_PIPELINE_CONFIG.clusterFilter,
      minGapDays: params.minGapDays,
    },
    confluence: {
      ...DEFAULT_QUALITY_PIPELINE_CONFIG.confluence,
      minActive: params.confluenceMinActive,
    },
    qualityGate: {
      ...DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate,
      enabled: params.qualityGateEnabled,
      ibsMax: params.ibsMax,
      rsMin: params.rsMin,
    },
  };
}
