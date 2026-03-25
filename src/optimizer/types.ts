/**
 * Type definitions for the Parameter Optimizer Agent
 */

export interface PerformanceData {
  hasEnoughData: boolean;
  tradeCount: number;
  daysBack: number;
  dateRange: {
    start: string;
    end: string;
  };
  overallStats: {
    winRate: number;
    profitFactor: number;
    totalPnL: number;
    avgTrade: number;
  };
  strategyStats: Record<string, StrategyStats>;
  currentConfig: Record<string, any>;
  rawTrades: any[];
}

export interface StrategyStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
  avgRR: number;
  byRegime: Record<string, RegimeStats>;
}

export interface RegimeStats {
  trades: number;
  winRate: number;
  pnl: number;
}

export interface OptimizationAnalysis {
  confidence: number;
  recommendedAction: 'OPTIMIZE_PARAMETERS' | 'NO_CHANGE' | 'PAUSE_STRATEGY' | 'INCREASE_SIZE';
  summary: {
    title: string;
    description: string;
    shortDescription: string;
  };
  parameterChanges: ParameterChange[];
  expectedImpact: string;
  riskAssessment: string;
  alternateActions?: Array<{
    action: string;
    reason: string;
  }>;
}

export interface ParameterChange {
  file: string;
  parameter: string;
  currentValue: any;
  newValue: any;
  reasoning: string;
}

export interface ProposedChanges {
  files: Record<string, FileChange>;
  summary: {
    title: string;
    description: string;
    shortDescription: string;
  };
}

export interface FileChange {
  type: 'json' | 'typescript' | 'javascript';
  description: string;
  patch?: any;
  search?: string;
  replace?: string;
}
