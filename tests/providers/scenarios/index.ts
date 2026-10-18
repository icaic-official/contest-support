import { accountCreation, authentication, revocation } from './authentication';
import { imageLimits, imageRevocation, images } from './images';
import { liveUpdates, reconnectRecovery } from './live-updates';
import { accessSeparation, idempotency, lifecycle } from './workflows';
import type { ScenarioContext } from '../contracts';

export const scenarios = {
  'authentication and temporary-password gate': authentication,
  'workflow lifecycle and persisted history': lifecycle,
  'team, session, and staff-note separation': accessSeparation,
  'lost responses, request retries, and concurrent claims': idempotency,
  'image reservations, visibility, and removal': images,
  'image access after membership revocation': imageRevocation,
  'live invalidation and subscription cleanup': liveUpdates,
  'membership removal and password reset': revocation,
  'account creation, temporary access, combined roles, and lost responses': accountCreation,
  'image file, count, combined size, and changed-limit boundaries': imageLimits,
  'transport interruption and missed-change recovery': reconnectRecovery,
} satisfies Record<string, (context: ScenarioContext) => Promise<void>>;

export type ScenarioName = keyof typeof scenarios;
