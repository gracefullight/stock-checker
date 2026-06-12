import type { BacktestSignal } from '@/optimization/engine';

export type DiagnosticSignal = BacktestSignal & { ret5d: number; win: boolean };
export type PostFilter = (sig: DiagnosticSignal, allSigs: DiagnosticSignal[]) => boolean;

export const POST_FILTERS: { name: string; filter: PostFilter }[] = [
    { name: 'baseline (no filter)', filter: () => true },
    // Regime filter: exclude uptrend (counterintuitive but data-driven)
    { name: 'regime≠uptrend', filter: (s) => s.regime !== 'uptrend' },
    // Anti-perfect confluence: confR=1.0 might mean free-fall
    { name: 'confR<1.0', filter: (s) => s.confluenceRatio < 1.0 },
    // Combined
    {
      name: 'regime≠uptrend + confR<1.0',
      filter: (s) => s.regime !== 'uptrend' && s.confluenceRatio < 1.0,
    },
    // Score cap: extremely high scores may indicate crashes
    { name: 'score<400', filter: (s) => s.score < 400 },
    { name: 'score<390', filter: (s) => s.score < 390 },
    // Consecutive skip: if same ticker had BUY within 5 days, skip
    {
      name: 'no-cluster-5d',
      filter: (s, all) => {
        const prev = all.filter(
          (x) =>
            x.ticker === s.ticker &&
            x.date < s.date &&
            s.date.getTime() - x.date.getTime() < 5 * 86400000
        );
        return prev.length === 0;
      },
    },
    // Consecutive skip 10 days
    {
      name: 'no-cluster-10d',
      filter: (s, all) => {
        const prev = all.filter(
          (x) =>
            x.ticker === s.ticker &&
            x.date < s.date &&
            s.date.getTime() - x.date.getTime() < 10 * 86400000
        );
        return prev.length === 0;
      },
    },
    // Only take if downtrend + no cluster 5d
    {
      name: 'regime≠up + no-clust-5d',
      filter: (s, all) => {
        if (s.regime === 'uptrend') return false;
        const prev = all.filter(
          (x) =>
            x.ticker === s.ticker &&
            x.date < s.date &&
            s.date.getTime() - x.date.getTime() < 5 * 86400000
        );
        return prev.length === 0;
      },
    },
    // Same-day multi-signal check: if ≥3 tickers signal same day, skip
    {
      name: 'no-multi-day(≥3)',
      filter: (s, all) => {
        const sameDay = all.filter((x) => x.date.getTime() === s.date.getTime());
        return sameDay.length < 3;
      },
    },
    // Regime≠uptrend + score<400
    { name: 'regime≠up + score<400', filter: (s) => s.regime !== 'uptrend' && s.score < 400 },
    // ATR-based volatility filter: skip high-volatility (ATR > X% of price)
    { name: 'atr<4%', filter: (s) => (s.atr / s.close) * 100 < 4 },
    { name: 'atr<3.5%', filter: (s) => (s.atr / s.close) * 100 < 3.5 },
    { name: 'atr<3%', filter: (s) => (s.atr / s.close) * 100 < 3 },
    // Volume ratio filter
    { name: 'volR<1.5', filter: (s) => s.volumeRatio < 1.5 },
    { name: 'volR>0.8', filter: (s) => s.volumeRatio > 0.8 },
    // SMA distance: how far below SMA50
    { name: 'sma50dist<-5%', filter: (s) => s.sma50dist < -5 },
    { name: 'sma50dist<-8%', filter: (s) => s.sma50dist < -8 },
    { name: 'sma50dist<-10%', filter: (s) => s.sma50dist < -10 },
    // SMA200 distance
    { name: 'sma200dist>-15%', filter: (s) => s.sma200dist > -15 },
    { name: 'sma200dist>-20%', filter: (s) => s.sma200dist > -20 },
    // RSI filter
    { name: 'rsi<25', filter: (s) => s.rsi < 25 },
    { name: 'rsi<30', filter: (s) => s.rsi < 30 },
    // Score margin above threshold
    { name: 'score≥375', filter: (s) => s.score >= 375 },
    { name: 'score≥378', filter: (s) => s.score >= 378 },
    // --- New strategy filters ---
    // IBS (Internal Bar Strength)
    { name: 'ibs<0.30', filter: (s) => s.ibs < 0.3 },
    { name: 'ibs<0.25', filter: (s) => s.ibs < 0.25 },
    { name: 'ibs<0.20', filter: (s) => s.ibs < 0.2 },
    { name: 'ibs<0.15', filter: (s) => s.ibs < 0.15 },
    // RSI(2) cumulative
    { name: 'rsi2c<20', filter: (s) => s.rsi2cumul < 20 },
    { name: 'rsi2c<15', filter: (s) => s.rsi2cumul < 15 },
    { name: 'rsi2c<10', filter: (s) => s.rsi2cumul < 10 },
    { name: 'rsi2c<5', filter: (s) => s.rsi2cumul < 5 },
    // ATR distance (how stretched from SMA20)
    { name: 'atrD>1.0', filter: (s) => s.atrDistance > 1.0 },
    { name: 'atrD>1.5', filter: (s) => s.atrDistance > 1.5 },
    { name: 'atrD>2.0', filter: (s) => s.atrDistance > 2.0 },
    { name: 'atrD>2.5', filter: (s) => s.atrDistance > 2.5 },
    // Consecutive oversold days
    { name: 'consOD≥2', filter: (s) => s.consecutiveOversold >= 2 },
    { name: 'consOD≥3', filter: (s) => s.consecutiveOversold >= 3 },
    // Volume
    { name: 'volR<2', filter: (s) => s.volumeRatio < 2.0 },
    { name: 'volR<1.5', filter: (s) => s.volumeRatio < 1.5 },
    // --- Combos: top singles ---
    { name: 'ibs<0.25 + atrD>1.5', filter: (s) => s.ibs < 0.25 && s.atrDistance > 1.5 },
    { name: 'ibs<0.25 + volR<2', filter: (s) => s.ibs < 0.25 && s.volumeRatio < 2.0 },
    { name: 'ibs<0.25 + rsi2c<10', filter: (s) => s.ibs < 0.25 && s.rsi2cumul < 10 },
    { name: 'atrD>1.5 + volR<2', filter: (s) => s.atrDistance > 1.5 && s.volumeRatio < 2.0 },
    { name: 'atrD>1.5 + rsi2c<15', filter: (s) => s.atrDistance > 1.5 && s.rsi2cumul < 15 },
    { name: 'atrD>2 + volR<2', filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 2.0 },
    { name: 'atrD>2 + ibs<0.25', filter: (s) => s.atrDistance > 2.0 && s.ibs < 0.25 },
    {
      name: 'ibs<0.25+atrD>1.5+volR<2',
      filter: (s) => s.ibs < 0.25 && s.atrDistance > 1.5 && s.volumeRatio < 2.0,
    },
    {
      name: 'ibs<0.20+atrD>1.5+volR<2',
      filter: (s) => s.ibs < 0.2 && s.atrDistance > 1.5 && s.volumeRatio < 2.0,
    },
    {
      name: 'atrD>2+volR<2+consOD≥2',
      filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2,
    },
    {
      name: 'atrD>1.5+volR<1.5+ibs<0.25',
      filter: (s) => s.atrDistance > 1.5 && s.volumeRatio < 1.5 && s.ibs < 0.25,
    },
    { name: 'atrD>2+volR<1.5', filter: (s) => s.atrDistance > 2.0 && s.volumeRatio < 1.5 },
    {
      name: 'score≥375+atrD>1.5+volR<2',
      filter: (s) => s.score >= 375 && s.atrDistance > 1.5 && s.volumeRatio < 2.0,
    },
    {
      name: 'scr≥375+volR<2+ibs<0.25',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.25,
    },
    {
      name: 'scr≥375+volR<2+ibs<0.30',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.3,
    },
    {
      name: 'scr≥375+volR<2+ibs<0.40',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.4,
    },
    {
      name: 'scr≥375+volR<2+consOD≥2',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2,
    },
    {
      name: 'scr≥375+volR<2+rsi2c<20',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.rsi2cumul < 20,
    },
    {
      name: 'scr≥375+volR<2+rsi2c<15',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.rsi2cumul < 15,
    },
    {
      name: 'all:scr375+vR2+ibs25+atrD1.5',
      filter: (s) => s.score >= 375 && s.volumeRatio < 2.0 && s.ibs < 0.25 && s.atrDistance > 1.5,
    },
    {
      name: 'all:scr375+vR2+consOD2+atrD2',
      filter: (s) =>
        s.score >= 375 && s.volumeRatio < 2.0 && s.consecutiveOversold >= 2 && s.atrDistance > 2.0,
    },
    // --- V4 Momentum-specific filters ---
    { name: 'regime=uptrend', filter: (s) => s.regime === 'uptrend' },
    { name: 'volR>1.5', filter: (s) => s.volumeRatio > 1.5 },
    { name: 'volR>2.0', filter: (s) => s.volumeRatio > 2.0 },
    { name: 'sma50dist>0', filter: (s) => s.sma50dist > 0 },
    { name: 'sma200dist>0', filter: (s) => s.sma200dist > 0 },
    { name: 'rsi>50', filter: (s) => s.rsi > 50 },
    { name: 'rsi>55', filter: (s) => s.rsi > 55 },
    { name: 'ibs>0.5', filter: (s) => s.ibs > 0.5 },
    { name: 'ibs>0.6', filter: (s) => s.ibs > 0.6 },
    { name: 'score≥300', filter: (s) => s.score >= 300 },
    { name: 'score≥320', filter: (s) => s.score >= 320 },
    { name: 'score≥350', filter: (s) => s.score >= 350 },
    { name: 'uptrend+volR>1.5', filter: (s) => s.regime === 'uptrend' && s.volumeRatio > 1.5 },
    { name: 'uptrend+volR>2.0', filter: (s) => s.regime === 'uptrend' && s.volumeRatio > 2.0 },
    {
      name: 'uptrend+sma50>0+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.sma50dist > 0 && s.volumeRatio > 1.5,
    },
    {
      name: 'uptrend+sma200>0+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.sma200dist > 0 && s.volumeRatio > 1.5,
    },
    {
      name: 'uptrend+rsi>50+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.rsi > 50 && s.volumeRatio > 1.5,
    },
    {
      name: 'uptrend+ibs>0.5+volR>1.5',
      filter: (s) => s.regime === 'uptrend' && s.ibs > 0.5 && s.volumeRatio > 1.5,
    },
    {
      name: 'scr≥300+uptrend+volR>1.5',
      filter: (s) => s.score >= 300 && s.regime === 'uptrend' && s.volumeRatio > 1.5,
    },
    {
      name: 'scr≥320+uptrend+volR>1.5',
      filter: (s) => s.score >= 320 && s.regime === 'uptrend' && s.volumeRatio > 1.5,
    },
];
