import type { StrategySignal, MultiTimeframeData, Regime, ScoreComponents } from '../types';
export declare abstract class BaseStrategy {
    abstract readonly name: string;
    abstract readonly supportedRegimes: Regime[];
    /** Returns a signal if the strategy fires, or null if no setup found */
    abstract analyze(data: MultiTimeframeData, regime: Regime): StrategySignal | null;
    protected isRegimeSupported(regime: Regime): boolean;
    protected zeroComponents(): ScoreComponents;
    protected totalScore(c: ScoreComponents): number;
}
//# sourceMappingURL=base.d.ts.map