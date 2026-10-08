import { HttpException, HttpStatus } from '@nestjs/common';

/** 410 — the code's 120 s window passed. The request itself may still be alive. */
export class CodeExpiredException extends HttpException {
  constructor() {
    super({ error: 'CODE_EXPIRED' }, HttpStatus.GONE);
  }
}

/** 410 — the whole 10-minute login request is gone. */
export class RequestExpiredException extends HttpException {
  constructor() {
    super({ error: 'REQUEST_EXPIRED' }, HttpStatus.GONE);
  }
}

/** 423 — five wrong attempts. */
export class LockedException extends HttpException {
  constructor() {
    super({ error: 'LOCKED' }, HttpStatus.LOCKED);
  }
}

/** 429 */
export class RateLimitedException extends HttpException {
  constructor(retryAfter: number) {
    super({ error: 'RATE_LIMITED', retryAfter }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
