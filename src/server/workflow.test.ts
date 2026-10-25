import { describe, expect, it, vi } from 'vitest';
import type { Caller } from './authentication';
import {
  decideWorkflow, equalWorkflowJson, isWorkflowCommand, workflowText, WorkflowService, type WorkflowPersistence, type WorkflowState,
} from './workflow';

const issueId = '00000000-0000-4000-8000-000000000001';
const state: WorkflowState = {
  actor: { id: 'person', name: 'Fictional Support' },
  membership: { team_id: null, roles: ['volunteer', 'specialist', 'jury'], is_admin: false },
  session: { id: 'session', intake_open: true, categories: ['Backend'] },
  archived: false, teams: ['team'], issue: { id: issueId, team_id: 'team', owner: 'person', status: 'escalated', revision: 0 },
  resolution: { id: 'resolution' }, award: null,
};

describe('shared workflow compatibility edges', () => {
  it('uses PostgreSQL space trimming and code-point length, including astral characters', () => {
    expect(workflowText('  \ttext\n  ')).toBe('\ttext\n');
    expect(isWorkflowCommand({ type: 'submit', category: 'Backend', description: '😀'.repeat(2000) })).toBe(true);
    expect(isWorkflowCommand({ type: 'submit', category: 'Backend', description: '😀'.repeat(2001) })).toBe(false);
    expect(isWorkflowCommand({ type: 'submit', category: 'Backend', description: '   ' })).toBe(false);
    expect(isWorkflowCommand({ type: 'submit', category: 'Backend', description: '\t' })).toBe(true);
  });
  it('rejects award minutes that are not whole numbers in range', () => {
    const award = (minutes: unknown) => isWorkflowCommand({
      type: 'award', issue_id: issueId, revision: 0, minutes, explanation: 'Fixture' });
    expect(award(0)).toBe(true);
    expect(award(5.0)).toBe(true);
    for (const minutes of [2.5, 0.1, -1, NaN, Infinity, 2147483648, '5', null, undefined]) {
      expect(award(minutes), String(minutes)).toBe(false);
    }
  });
  it('rejects a NUL character anywhere in workflow text before reading the database', async () => {
    const store = { read: vi.fn(), commit: vi.fn() } satisfies WorkflowPersistence;
    const service = new WorkflowService(store);
    const caller = { accountId: 'person' } as Caller;
    const requestId = '00000000-0000-4000-8000-0000000000a1';
    const sessionId = '00000000-0000-4000-8000-0000000000b1';
    const target = { issue_id: issueId, revision: 0 };
    const commands = (text: string) => [
      { type: 'submit' as const, category: 'Backend', description: text },
      { type: 'message' as const, ...target, text, visibility: 'public' as const },
      { type: 'resolve' as const, ...target, summary: text },
      { type: 'reopen' as const, ...target, reason: text },
      { type: 'award' as const, ...target, minutes: 1, explanation: text },
    ];
    for (const text of ['\u0000Fixture', 'Fix\u0000ture', 'Fixture\u0000', '\u0000']) {
      for (const command of commands(text)) {
        expect(isWorkflowCommand(command)).toBe(false);
        expect(await service.execute(caller, sessionId, requestId, command)).toEqual({ outcome: 'rejected', reason: 'input' });
      }
    }
    expect(store.read).not.toHaveBeenCalled();
  });
  it('keeps other control characters valid because replies can use tabs and new lines', () => {
    expect(isWorkflowCommand({ type: 'message', issue_id: issueId, revision: 0, text: 'a\tb\nc\u0001', visibility: 'public' })).toBe(true);
  });
  it('ignores a contestant team override even when the unused value is not a UUID', () => {
    const command = { type: 'submit' as const, category: 'Backend', description: 'Fixture', team_id: 'unused-browser-value' };
    expect(isWorkflowCommand(command)).toBe(true);
    expect(decideWorkflow({ ...state, membership: { team_id: 'team', roles: [], is_admin: false } }, command))
      .toMatchObject({ teamId: 'team' });
    expect(decideWorkflow(state, command)).toEqual({ outcome: 'rejected', reason: 'input' });
  });
  it('lets any staff member, and only staff, submit for a chosen team', () => {
    const command = { type: 'submit' as const, category: 'Backend', description: 'Fixture', team_id: 'team' };
    for (const membership of [
      { team_id: null, roles: ['jury' as const], is_admin: false },
      { team_id: null, roles: [], is_admin: true },
    ]) {
      expect(decideWorkflow({ ...state, membership }, command)).toMatchObject({ type: 'submit', teamId: 'team' });
    }
    expect(decideWorkflow({ ...state, membership: { team_id: null, roles: [], is_admin: false } }, command))
      .toEqual({ outcome: 'rejected', reason: 'access' });
  });
  it('compares receipts as JSON values while preserving original whitespace', () => {
    expect(equalWorkflowJson({ type: 'message', text: ' text ', extra: { a: 1, b: 2 } },
      { extra: { b: 2, a: 1 }, text: ' text ', type: 'message' })).toBe(true);
    expect(equalWorkflowJson({ text: ' text ' }, { text: 'text' })).toBe(false);
  });
  it('combines capabilities without permitting self-handoff', () => {
    expect(decideWorkflow(state, { type: 'accept', issue_id: issueId, revision: 0 })).toEqual({ outcome: 'rejected', reason: 'state' });
    const resolved = decideWorkflow(state, { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Restored' });
    expect(resolved).toMatchObject({ resolution: { summary: 'Restored' }, issue: { status: 'resolved' } });
    const awarded = decideWorkflow({ ...state, issue: { ...state.issue!, status: 'resolved' } },
      { type: 'award', issue_id: issueId, revision: 0, minutes: 0, explanation: 'No additional time' });
    expect(awarded).toMatchObject({ award: { minutes: 0, resolutionId: 'resolution' } });
  });
  it('describes a reopened award confirmation without changing the owner or timer', () => {
    const decision = decideWorkflow({ ...state, issue: { ...state.issue!, status: 'claimed' }, award: { id: 'award', applied_at: null } },
      { type: 'apply', issue_id: issueId, revision: 0 });
    expect(decision).toMatchObject({ apply: { awardId: 'award' } });
    expect(decision).not.toHaveProperty('issue');
  });
  it('lets an admin resolve an assigned issue that another person owns', () => {
    const admin = { ...state, actor: { id: 'admin', name: 'Fictional Admin' },
      membership: { team_id: null, roles: [], is_admin: true } };
    for (const status of ['claimed', 'escalated'] as const) {
      const decision = decideWorkflow({ ...admin, issue: { ...state.issue!, status } },
        { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Restored' });
      expect(decision).toMatchObject({ issue: { status: 'resolved' }, resolution: { summary: 'Restored' } });
      expect(decision).not.toHaveProperty('issue.owner');
    }
    expect(decideWorkflow({ ...admin, issue: { ...state.issue!, status: 'open', owner: null } },
      { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Restored' })).toEqual({ outcome: 'rejected', reason: 'state' });
    expect(decideWorkflow({ ...state, actor: { id: 'other', name: 'Other Support' } },
      { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Restored' })).toEqual({ outcome: 'rejected', reason: 'state' });
  });
  it('lets an admin without a support or jury role reply and write internal notes, but not claim, hand off, or reopen', () => {
    const admin = { ...state, actor: { id: 'admin', name: 'Fictional Admin' },
      membership: { team_id: null, roles: [], is_admin: true } };
    const at = (status: 'open' | 'claimed' | 'escalated' | 'resolved', owner: string | null) =>
      ({ ...admin, issue: { ...state.issue!, status, owner } });
    const target = { issue_id: issueId, revision: 0 };
    for (const visibility of ['public', 'internal'] as const) {
      expect(decideWorkflow(at('open', null), { type: 'message', ...target, text: ' On my way ', visibility }))
        .toMatchObject({ type: 'message', history: { text: 'On my way', visibility } });
      expect(decideWorkflow(at('resolved', 'person'), { type: 'message', ...target, text: 'Late', visibility }))
        .toEqual({ outcome: 'rejected', reason: 'state' });
    }
    expect(decideWorkflow(at('open', null), { type: 'claim', ...target })).toEqual({ outcome: 'rejected', reason: 'state' });
    expect(decideWorkflow(at('claimed', 'admin'), { type: 'escalate', ...target })).toEqual({ outcome: 'rejected', reason: 'state' });
    expect(decideWorkflow(at('escalated', 'person'), { type: 'accept', ...target })).toEqual({ outcome: 'rejected', reason: 'state' });
    expect(decideWorkflow(at('resolved', 'person'), { type: 'reopen', ...target, reason: 'Again' }))
      .toEqual({ outcome: 'rejected', reason: 'state' });
  });
});
