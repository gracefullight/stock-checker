import { createHash } from 'node:crypto';
import type { PipelineConfig } from '@/types';

/** Key-order-independent JSON used for every configuration fingerprint. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

/** SHA-256 of the complete pipeline configuration; the same value the validation report records. */
export function strategyConfigFingerprint(config: PipelineConfig): string {
  return createHash('sha256').update(stableJson(config)).digest('hex');
}
