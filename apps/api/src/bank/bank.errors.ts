import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Item-bank errors as named codes (`{ error, message, details }`, task.md § 6.1).
 * Staff routes answer 403 for a missing role (StaffRoleGuard); these are about
 * the state of the bank, not about who is asking.
 */

export class BankNotFoundException extends NotFoundException {
  constructor(what = 'NOT_FOUND') {
    super({ error: what });
  }
}

export class TaxonomyConflictException extends ConflictException {
  constructor(reason: 'exists' | 'in_use' | 'grade_range' | 'topic_unknown' | 'cluster_mismatch') {
    super({ error: 'TAXONOMY_CONFLICT', message: 'This taxonomy change is not possible.', details: { reason } });
  }
}

/** The item is not in a state that allows this action. */
export class ItemStateException extends ConflictException {
  constructor(reason: string, details: Record<string, unknown> = {}) {
    super({ error: 'ITEM_STATE', message: 'The item cannot do that in its current state.', details: { reason, ...details } });
  }
}

/** Submit refused: the fields that still need attention (design/12, "Fix before submitting"). */
export class ItemIncompleteException extends BadRequestException {
  constructor(fields: string[]) {
    super({ error: 'ITEM_INCOMPLETE', message: 'Some fields need attention before review.', details: { fields } });
  }
}

export class ItemInvalidException extends BadRequestException {
  constructor(reason: string) {
    super({ error: 'ITEM_INVALID', message: 'This item cannot be saved like that.', details: { reason } });
  }
}

export class ReviewStateException extends ConflictException {
  constructor(reason: 'own_item' | 'not_in_review' | 'decided' | 'not_solved' | 'already_solved' | 'disagreed' | 'note_required') {
    super({ error: 'REVIEW_STATE', message: 'This review step is not possible now.', details: { reason } });
  }
}

export class FormStateException extends ConflictException {
  constructor(reason: string, details: Record<string, unknown> = {}) {
    super({ error: 'FORM_STATE', message: 'The form cannot do that now.', details: { reason, ...details } });
  }
}

export class SlotInvalidException extends BadRequestException {
  constructor(reason: string) {
    super({ error: 'SLOT_INVALID', message: 'That item cannot fill this position.', details: { reason } });
  }
}

export class MediaInvalidException extends BadRequestException {
  constructor(reason: 'type' | 'size' | 'empty' | 'kind') {
    super({ error: 'MEDIA_INVALID', message: 'This file cannot be used.', details: { reason } });
  }
}
