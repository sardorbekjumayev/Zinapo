import type { CaseStatus, FamilyDispute } from '@/lib/trust-types';
import type { DisputesMessages } from '@/messages/disputes';

export type Stage = 'open' | 'waiting' | 'decided';

/** The three words a family sees; `dismissed` is a closed case like `resolved`. */
export function stageOf(status: CaseStatus): Stage {
  if (status === 'open') return 'open';
  if (status === 'waiting_owner') return 'waiting';
  return 'decided';
}

export function StageTag({ status, m }: { status: CaseStatus; m: DisputesMessages }) {
  const stage = stageOf(status);
  const tone = stage === 'decided' ? 'fam-tag--ok' : stage === 'waiting' ? 'fam-tag--warn' : 'fam-tag--brand';
  return <span className={`fam-tag ${tone}`}>{m.status[stage]}</span>;
}

/**
 * The outcome in words, phrased for the reader's side of the case (task.md
 * M8-c): "transferred" means opposite things to the claimant and the old owner.
 */
export function outcomeText(d: Pick<FamilyDispute, 'role' | 'outcome' | 'status'>, m: DisputesMessages): string {
  if (stageOf(d.status) !== 'decided' || !d.outcome) return m.outcome.pending;
  const transferred = d.outcome === 'transferred';
  if (d.role === 'claimant') return transferred ? m.outcome.transferredClaimant : m.outcome.keptClaimant;
  return transferred ? m.outcome.transferredOwner : m.outcome.keptOwner;
}

export const MAX_STATEMENTS = 10;
export const MAX_LENGTH = 4000;
