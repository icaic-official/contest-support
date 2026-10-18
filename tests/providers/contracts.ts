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
}

/** Providers implement setup and faults. Scenarios use only Backend operations. */
export interface ScenarioContext extends ScenarioData {
  connect(actor?: Actor): Promise<Backend>;
  /** Discard one successful response after the server has committed the command. */
  discardNextWorkflowResponse(backend: Backend): void;
  close(): Promise<void>;
}
