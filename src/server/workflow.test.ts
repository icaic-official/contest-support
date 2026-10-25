import { describe, expect, it } from 'vitest';
import { decideWorkflow, equalWorkflowJson, isWorkflowCommand, workflowText, type WorkflowState } from './workflow';

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
  it('lets an admin resolve an open issue directly and become its owner', () => {
    const open = { ...state.issue!, status: 'open' as const, owner: null };
    const admin = { ...state, actor: { id: 'admin', name: 'Fictional Admin' },
      membership: { team_id: null, roles: [], is_admin: true }, issue: open };
    const command = { type: 'resolve' as const, issue_id: issueId, revision: 0, summary: 'Restored' };
    expect(decideWorkflow(admin, command)).toMatchObject({
      issue: { status: 'resolved', owner: 'admin' }, resolution: { summary: 'Restored' },
    });
    const volunteer = { ...state, membership: { team_id: null, roles: ['volunteer' as const], is_admin: false }, issue: open };
    expect(decideWorkflow(volunteer, command)).toEqual({ outcome: 'rejected', reason: 'state' });
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
    expect(decideWorkflow({ ...state, actor: { id: 'other', name: 'Other Support' } },
      { type: 'resolve', issue_id: issueId, revision: 0, summary: 'Restored' })).toEqual({ outcome: 'rejected', reason: 'state' });
  });
});
