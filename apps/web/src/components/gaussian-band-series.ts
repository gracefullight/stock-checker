import {
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  customSeriesDefaultOptions,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from 'lightweight-charts';

// The draw target is fancy-canvas's CanvasRenderingTarget2D; derive it from the
// interface so we don't import 'fancy-canvas' directly (not resolvable in the
// isolated app node_modules).
type DrawTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

/**
 * Custom lightweight-charts series that fills the Gaussian Channel band
 * (between `upper` and `lower`) with a translucent trend color — green where
 * the filter is rising, red where falling. lightweight-charts has no built-in
 * "fill between two lines", so we draw it as a custom series behind the candles.
 */
export interface GaussianBandData extends CustomData<Time> {
  upper: number;
  lower: number;
  green: boolean;
}

export interface GaussianBandSeriesOptions extends CustomSeriesOptions {
  /** rgba() fill for rising (uptrend) bars */
  colorUp: string;
  /** rgba() fill for falling (downtrend) bars */
  colorDown: string;
}

const defaultOptions: GaussianBandSeriesOptions = {
  ...customSeriesDefaultOptions,
  colorUp: 'rgba(0, 200, 5, 0.12)',
  colorDown: 'rgba(255, 68, 68, 0.12)',
};

class GaussianBandRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, GaussianBandData> | null = null;
  private _options: GaussianBandSeriesOptions | null = null;

  update(
    data: PaneRendererCustomData<Time, GaussianBandData>,
    options: GaussianBandSeriesOptions
  ): void {
    this._data = data;
    this._options = options;
  }

  draw(target: DrawTarget, priceToCoordinate: PriceToCoordinateConverter): void {
    const data = this._data;
    const options = this._options;
    if (!data || data.bars.length === 0 || !options) return;

    // biome-ignore lint/correctness/useHookAtTopLevel: useBitmapCoordinateSpace is a fancy-canvas rendering method, not a React hook.
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const bars = data.bars;

      // Fill each contiguous same-trend run as one polygon (upper edge L→R, lower edge R→L).
      let i = 0;
      while (i < bars.length) {
        const runGreen = bars[i].originalData?.green ?? false;
        let j = i;
        while (j + 1 < bars.length && (bars[j + 1].originalData?.green ?? false) === runGreen) {
          j++;
        }

        ctx.beginPath();
        for (let k = i; k <= j; k++) {
          const od = bars[k].originalData;
          if (!od) continue;
          const x = bars[k].x * hr;
          const y = (priceToCoordinate(od.upper) ?? 0) * vr;
          if (k === i) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let k = j; k >= i; k--) {
          const od = bars[k].originalData;
          if (!od) continue;
          const x = bars[k].x * hr;
          const y = (priceToCoordinate(od.lower) ?? 0) * vr;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = runGreen ? options.colorUp : options.colorDown;
        ctx.fill();

        i = j + 1;
      }
    });
  }
}

export class GaussianBandSeries
  implements ICustomSeriesPaneView<Time, GaussianBandData, GaussianBandSeriesOptions>
{
  private _renderer = new GaussianBandRenderer();

  priceValueBuilder(d: GaussianBandData): CustomSeriesPricePlotValues {
    return [d.lower, d.upper];
  }

  isWhitespace(
    d: GaussianBandData | CustomSeriesWhitespaceData<Time>
  ): d is CustomSeriesWhitespaceData<Time> {
    return (d as GaussianBandData).upper === undefined;
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(
    data: PaneRendererCustomData<Time, GaussianBandData>,
    options: GaussianBandSeriesOptions
  ): void {
    this._renderer.update(data, options);
  }

  defaultOptions(): GaussianBandSeriesOptions {
    return defaultOptions;
  }
}
