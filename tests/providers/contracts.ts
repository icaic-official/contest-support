import type { Backend } from '../../src/backend/contracts';

export type Actor =
  | 'admin'
  | 'otherAdmin'
  | 'contestant'
  | 'otherTeam'
  | 'volunteer'
  | 'specialist'
  | 'jury'
  | 'isolated'
  | 'temporary'
  | 'revoked';

export interface TestAccount {
  id: string;
  username: string;
  password: string;
}

/** All identifiers belong to one disposable run. Credentials remain in memory. */
export interface ScenarioData {
  sessionId: string;
  otherSessionId: string;
  teamId: string;
  accounts: Record<Actor, TestAccount>;
  createdAccounts: Record<'contestant' | 'staff', { name: string; username: string }>;
}

/** Exact account markers are saved before the browser can create an account. */
export function createdAccountMarkers(runId: string): ScenarioData['createdAccounts'] {
  return Object.fromEntries(['contestant', 'staff'].map((actor) => [actor, {
    name: `Provider created ${actor} ${runId}`,
    username: `pc-${runId.slice(0, 12)}-new-${actor}`,
  }])) as ScenarioData['createdAccounts'];
}

/** Providers implement setup and faults. Scenarios use only Backend operations. */
export interface ScenarioContext extends ScenarioData {
  connect(actor?: Actor): Promise<Backend>;
  /** Discard one successful response after the server has committed the command. */
  discardNextWorkflowResponse(backend: Backend): void;
  discardNextAccountResponse(backend: Backend): void;
  setLiveUpdatesPaused(backend: Backend, paused: boolean): Promise<void>;
  close(): Promise<void>;
}
