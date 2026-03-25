// Optimizer module exports
export { runOptimizationAgent } from './agent';
export { createOptimizationPR } from './github';
export { buildAnalysisPrompt, buildParameterPrompt, formatProposedChanges } from './prompts';
export type {
  PerformanceData,
  StrategyStats,
  RegimeStats,
  OptimizationAnalysis,
  ParameterChange,
  ProposedChanges,
  FileChange,
} from './types';
