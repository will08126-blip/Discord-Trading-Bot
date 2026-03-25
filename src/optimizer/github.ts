import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { OptimizationAnalysis, ProposedChanges, PerformanceData } from './types';

interface PRCreationParams {
  analysis: OptimizationAnalysis;
  changes: ProposedChanges;
  performance: PerformanceData;
}

/**
 * Create a GitHub Pull Request with the proposed optimization changes
 */
export async function createOptimizationPR(params: PRCreationParams): Promise<string> {
  const { analysis, changes, performance } = params;
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const branchName = `bot/optimize-${timestamp}`;
  const baseBranch = 'main';
  
  try {
    logger.info(`[GitHub] Creating branch: ${branchName}`);
    
    // Step 1: Ensure we're in the repo and on base branch
    execSync('git checkout main', { cwd: process.cwd(), stdio: 'pipe' });
    execSync('git pull origin main', { cwd: process.cwd(), stdio: 'pipe' });
    
    // Step 2: Create and checkout new branch
    execSync(`git checkout -b ${branchName}`, { cwd: process.cwd(), stdio: 'pipe' });
    
    // Step 3: Apply changes
    logger.info('[GitHub] Applying code changes...');
    for (const [filePath, changeData] of Object.entries(changes.files)) {
      await applyFileChange(filePath, changeData as any);
    }
    
    // Step 4: Commit changes
    execSync('git add -A', { cwd: process.cwd(), stdio: 'pipe' });
    const commitMessage = buildCommitMessage(analysis);
    execSync(`git commit -m "${commitMessage}"`, { cwd: process.cwd(), stdio: 'pipe' });
    
    // Step 5: Push branch
    logger.info('[GitHub] Pushing branch...');
    execSync(`git push -u origin ${branchName}`, { cwd: process.cwd(), stdio: 'pipe' });
    
    // Step 6: Create PR via gh CLI
    logger.info('[GitHub] Creating Pull Request...');
    const prTitle = `[BOT] Auto-optimization: ${analysis.summary.title}`;
    const prBody = buildPRBody(analysis, performance);
    
    const prUrl = execSync(
      `gh pr create --title "${prTitle}" --body "${prBody}" --base ${baseBranch}`,
      { cwd: process.cwd(), encoding: 'utf-8' }
    ).trim();
    
    logger.info(`[GitHub] PR created successfully: ${prUrl}`);
    return prUrl;
    
  } catch (error) {
    // Attempt cleanup on failure
    try {
      execSync('git checkout main', { cwd: process.cwd(), stdio: 'pipe' });
      execSync(`git branch -D ${branchName}`, { cwd: process.cwd(), stdio: 'pipe' });
    } catch {
      // Ignore cleanup errors
    }
    
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[GitHub] Failed to create PR:', msg);
    throw new Error(`PR creation failed: ${msg}`);
  }
}

/**
 * Apply a single file change based on its type
 */
async function applyFileChange(filePath: string, change: any): Promise<void> {
  const fullPath = path.join(process.cwd(), filePath);
  
  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  switch (change.type) {
    case 'json':
      if (fs.existsSync(fullPath)) {
        const existing = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        const merged = { ...existing, ...change.patch };
        fs.writeFileSync(fullPath, JSON.stringify(merged, null, 2));
      } else {
        fs.writeFileSync(fullPath, JSON.stringify(change.patch, null, 2));
      }
      break;
      
    case 'typescript':
    case 'javascript':
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Cannot modify non-existent file: ${filePath}`);
      }
      let content = fs.readFileSync(fullPath, 'utf-8');
      if (!content.includes(change.search)) {
        throw new Error(`Search pattern not found in ${filePath}. Pattern: ${change.search.slice(0, 100)}...`);
      }
      content = content.replace(change.search, change.replace);
      fs.writeFileSync(fullPath, content);
      break;
      
    default:
      throw new Error(`Unknown change type: ${change.type}`);
  }
  
  logger.info(`[GitHub] Applied change to: ${filePath}`);
}

/**
 * Build a concise commit message
 */
function buildCommitMessage(analysis: OptimizationAnalysis): string {
  const changeCount = analysis.parameterChanges.length;
  const summary = analysis.summary.shortDescription || 'parameter optimizations';
  return `[BOT] Optimize: ${summary}\n\n- ${changeCount} parameter(s) adjusted\n- Confidence: ${analysis.confidence}/10\n- Expected impact: ${analysis.expectedImpact}`;
}

/**
 * Build detailed PR body with markdown formatting
 */
function buildPRBody(analysis: OptimizationAnalysis, performance: PerformanceData): string {
  const sections: string[] = [];
  
  // Header
  sections.push(`## 🤖 Automated Trading Bot Optimization`);
  sections.push('');
  sections.push(`**Analysis Date:** ${new Date().toISOString()}`);
  sections.push(`**Confidence Level:** ${analysis.confidence}/10`);
  sections.push(`**Expected Impact:** ${analysis.expectedImpact}`);
  sections.push('');
  
  // Summary
  sections.push(`### Summary`);
  sections.push(analysis.summary.description);
  sections.push('');
  
  // Performance Overview
  sections.push(`### 📊 Performance Overview (Last ${performance.daysBack} Days)`);
  sections.push('');
  sections.push(`| Metric | Value |`);
  sections.push(`|--------|-------|`);
  sections.push(`| Total Trades | ${performance.tradeCount} |`);
  sections.push(`| Win Rate | ${(performance.overallStats.winRate * 100).toFixed(1)}% |`);
  sections.push(`| Profit Factor | ${performance.overallStats.profitFactor.toFixed(2)} |`);
  sections.push(`| Total P&L | $${performance.overallStats.totalPnL.toFixed(2)} |`);
  sections.push(`| Avg Trade | $${performance.overallStats.avgTrade.toFixed(2)} |`);
  sections.push('');
  
  // Strategy Breakdown
  sections.push(`### 📈 Strategy Performance`);
  sections.push('');
  sections.push(`| Strategy | Trades | Win Rate | P&L |`);
  sections.push(`|----------|--------|----------|-----|`);
  
  for (const [strategy, stats] of Object.entries(performance.strategyStats)) {
    sections.push(`| ${strategy} | ${stats.trades} | ${(stats.winRate * 100).toFixed(1)}% | $${stats.totalPnL.toFixed(2)} |`);
  }
  sections.push('');
  
  // Proposed Changes
  sections.push(`### 🔧 Proposed Changes`);
  sections.push('');
  
  for (let i = 0; i < analysis.parameterChanges.length; i++) {
    const change = analysis.parameterChanges[i];
    sections.push(`#### ${i + 1}. ${change.parameter}`);
    sections.push(`- **File:** \`${change.file}\``);
    sections.push(`- **Current:** \`${JSON.stringify(change.currentValue)}\``);
    sections.push(`- **Proposed:** \`${JSON.stringify(change.newValue)}\``);
    sections.push(`- **Reasoning:** ${change.reasoning}`);
    sections.push('');
  }
  
  // Risk Assessment
  sections.push(`### ⚠️ Risk Assessment`);
  sections.push(analysis.riskAssessment);
  sections.push('');
  
  // Rollback Instructions
  sections.push(`### 🔄 Rollback`);
  sections.push('If issues occur, revert this PR:');
  sections.push('```bash');
  sections.push('git revert HEAD');
  sections.push('git push origin main');
  sections.push('```');
  sections.push('');
  sections.push('---');
  sections.push('*This PR was automatically generated by the AI Parameter Optimizer Agent.*');
  
  return sections.join('\n');
}
