import { describe, it, expect } from 'vitest';
import { classifyPaths, needsApproval } from '../src/engine/self-improve';

describe('classifyPaths', () => {
  it('allowlists strategy, prompt, and dashboard files', () => {
    const { allowlisted, gated } = classifyPaths([
      'src/engine/scout.ts',
      'src/services/ai/prompts/trade-decision.ts',
      'dashboard/src/components/Foo.tsx',
      'tests/scout.test.ts',
      'playbook/strategy.md',
    ]);
    expect(gated).toEqual([]);
    expect(allowlisted).toHaveLength(5);
  });

  it('gates risk, execution, env, hard limits, deploy, and package.json', () => {
    const { gated } = classifyPaths([
      'src/config/hard-limits.ts',
      'src/engine/risk-manager.ts',
      'src/engine/execution.ts',
      'src/config/env.ts',
      'src/engine/self-improve.ts',
      'deploy/deploy.ps1',
      'package.json',
      'src/services/ai/client.ts',
    ]);
    expect(gated).toHaveLength(8);
  });

  it('normalises Windows separators', () => {
    expect(classifyPaths(['src\\engine\\scout.ts']).allowlisted).toEqual(['src/engine/scout.ts']);
  });
});

describe('needsApproval', () => {
  it('auto-approves allowlisted-only diffs in paper mode', () => {
    expect(needsApproval(['src/engine/scout.ts', 'tests/x.test.ts'], true).required).toBe(false);
  });

  it('requires approval for any gated file', () => {
    const r = needsApproval(['src/engine/scout.ts', 'src/engine/risk-manager.ts'], true);
    expect(r.required).toBe(true);
    expect(r.reason).toMatch(/risk-manager/);
  });

  it('requires approval for everything once live', () => {
    expect(needsApproval(['src/engine/scout.ts'], false).required).toBe(true);
  });

  it('requires approval for empty diffs', () => {
    expect(needsApproval([], true).required).toBe(true);
  });
});
