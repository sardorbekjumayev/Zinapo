import { BadRequestException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';

/**
 * The errors the add-child flow can produce, as named codes the client maps to
 * copy (`{ error: 'CODE', message, details? }`, task.md § 6.1).
 *
 * The two that matter most are not failures at all. A duplicate PINFL and a
 * fifth child both return 409 with a case id: the parent has not done anything
 * wrong, and the screen says "a person is looking at this" rather than "error".
 */

export class PinflMalformedException extends BadRequestException {
  constructor() {
    super({
      error: 'PINFL_MALFORMED',
      message: 'The PINFL must be 14 digits and contain a real date of birth.',
    });
  }
}

/** task.md § 8.2: a DOB that disagrees with the PINFL is a hard stop. */
export class PinflDobMismatchException extends BadRequestException {
  constructor() {
    super({
      error: 'PINFL_DOB_MISMATCH',
      message: 'The date of birth does not match the one encoded in the PINFL.',
    });
  }
}

/**
 * This child already has an owner. We do NOT say who — that would leak a
 * stranger's family to anyone holding a PINFL. The current owner is notified
 * and trust & safety takes it from here.
 */
export class ChildAlreadyRegisteredException extends ConflictException {
  constructor(caseId: string) {
    super({
      error: 'CHILD_ALREADY_REGISTERED',
      message: 'This child already has a profile. We have asked its owner to confirm.',
      details: { caseId, reference: `D-${caseId.replace(/-/g, '').slice(0, 8).toUpperCase()}` },
    });
  }
}

/** task.md § 3: max 4 children, then manual review — not a refusal. */
export class FifthChildReviewException extends HttpException {
  constructor(caseId: string, phone: string) {
    super(
      {
        error: 'FIFTH_CHILD_REVIEW',
        message: 'A fifth child needs a quick manual check. We will come back to you.',
        // `phone` is the caller's own number, masked — where the answer goes.
        details: { caseId, reference: `R-${caseId.replace(/-/g, '').slice(0, 8).toUpperCase()}`, phone },
      },
      HttpStatus.ACCEPTED,
    );
  }
}

export class ConsentRequiredException extends BadRequestException {
  constructor() {
    super({
      error: 'CONSENT_REQUIRED',
      message: 'Consent to data processing is required to create a profile.',
    });
  }
}

export class InviteInvalidException extends BadRequestException {
  constructor(reason: 'not_found' | 'expired' | 'used' | 'wrong_phone') {
    super({ error: 'INVITE_INVALID', message: 'This invitation cannot be used.', details: { reason } });
  }
}

export class NotTheOwnerException extends HttpException {
  constructor() {
    // 404, not 403: task.md § 4 — never reveal that a child exists to someone
    // without a relationship to them.
    super({ error: 'NOT_FOUND' }, HttpStatus.NOT_FOUND);
  }
}

/**
 * task.md § 3: "Create a child profile" is an owner's action, or the first
 * action of someone with no role yet (onboarding). A co-guardian, an educator
 * or a staff member acting as such may not — see task.md note M2-c.
 */
export class ChildCreateForbiddenException extends HttpException {
  constructor() {
    super({ error: 'CHILD_CREATE_FORBIDDEN' }, HttpStatus.FORBIDDEN);
  }
}

/** The PINFL belongs to a child this person already co-guards. No dispute needed. */
export class ChildAlreadyLinkedException extends ConflictException {
  constructor() {
    super({
      error: 'CHILD_ALREADY_LINKED',
      message: 'You already have access to this child as a co-guardian.',
    });
  }
}

export class AlreadyGuardianException extends ConflictException {
  constructor() {
    super({ error: 'ALREADY_GUARDIAN', message: 'This person already has access to the child.' });
  }
}

export class NotACoGuardianException extends BadRequestException {
  constructor() {
    super({
      error: 'NOT_A_CO_GUARDIAN',
      message: 'Ownership can only be transferred to a current co-guardian.',
    });
  }
}

export class TransferPendingException extends ConflictException {
  constructor() {
    super({
      error: 'TRANSFER_PENDING',
      message: 'An ownership offer is already waiting for an answer. Cancel it first.',
    });
  }
}

export class PhoneInvalidException extends BadRequestException {
  constructor() {
    super({ error: 'PHONE_INVALID', message: 'Enter an Uzbek phone number.' });
  }
}

export class LinkStateException extends ConflictException {
  constructor(reason: 'not_requested' | 'not_active' | 'not_revoked' | 'expired' | 'conflict') {
    super({
      error: 'LINK_STATE',
      message: 'This access cannot be changed from its current state.',
      details: { reason },
    });
  }
}

export class ValidUntilInvalidException extends BadRequestException {
  constructor() {
    super({
      error: 'VALID_UNTIL_INVALID',
      message: 'Access must end after today and no later than the end of the season.',
    });
  }
}

export class AnonymisationPendingException extends ConflictException {
  constructor() {
    super({ error: 'ANONYMISATION_PENDING', message: 'Deletion has been requested for this child.' });
  }
}
