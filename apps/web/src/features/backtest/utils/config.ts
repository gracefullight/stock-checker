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

export function playgroundParamsFromConfig(config: PipelineConfig): PlaygroundParams {
  const qualityGate = config.qualityGate ?? DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate;
  return {
    strategy: config.strategy,
    buyThreshold: config.thresholds.buy,
    sellThreshold: config.thresholds.sell,
    minGapDays:
      config.clusterFilter?.minGapDays ?? DEFAULT_QUALITY_PIPELINE_CONFIG.clusterFilter.minGapDays,
    confluenceMinActive:
      config.confluence?.minActive ?? DEFAULT_QUALITY_PIPELINE_CONFIG.confluence.minActive,
    qualityGateEnabled: qualityGate.enabled,
    ibsMax: qualityGate.ibsMax ?? DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.ibsMax,
    rsMin: qualityGate.rsMin ?? DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate.rsMin,
  };
}

export const DEFAULT_PLAYGROUND_PARAMS = playgroundParamsFromConfig(
  DEFAULT_QUALITY_PIPELINE_CONFIG
);

export function buildPipelineConfig(
  params: PlaygroundParams,
  baseConfig: PipelineConfig = DEFAULT_QUALITY_PIPELINE_CONFIG
): PipelineConfig {
  const config = structuredClone(baseConfig);
  return {
    ...config,
    strategy: params.strategy,
    thresholds: { buy: params.buyThreshold, sell: params.sellThreshold },
    clusterFilter: {
      ...(config.clusterFilter ?? DEFAULT_QUALITY_PIPELINE_CONFIG.clusterFilter),
      minGapDays: params.minGapDays,
    },
    confluence: {
      ...(config.confluence ?? DEFAULT_QUALITY_PIPELINE_CONFIG.confluence),
      minActive: params.confluenceMinActive,
    },
    qualityGate: {
      ...(config.qualityGate ?? DEFAULT_QUALITY_PIPELINE_CONFIG.qualityGate),
      enabled: params.qualityGateEnabled,
      ibsMax: params.ibsMax,
      rsMin: params.rsMin,
    },
  };
}
