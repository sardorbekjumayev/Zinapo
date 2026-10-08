import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { AppConfig, CONFIG } from '../config/configuration';

/**
 * INV-06 — the only place in the codebase that touches a PINFL in the clear.
 *
 * A PINFL never leaves this service: callers hand in a string and get back a
 * hash and a sealed blob. Nothing here returns the digits, not partially and
 * not to the owner. Services exchange `child.id`.
 *
 * Shape of an Uzbek PINFL (14 digits):
 *
 *   C DD MM YY NNNNN K
 *   │ │  │  │  │     └─ check digit
 *   │ │  │  │  └─────── serial
 *   │ └──┴──┴────────── date of birth
 *   └────────────────── century + sex:
 *                       1/2 → 1800s, 3/4 → 1900s, 5/6 → 2000s
 *                       odd = male, even = female
 */
@Injectable()
export class PinflService {
  private readonly hashSalt: Buffer;
  private readonly encKey: Buffer;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.hashSalt = Buffer.from(config.pinflHashSalt, 'utf8');
    // AES-256 needs exactly 32 bytes; derive them so any key length works and
    // the operator is never asked to produce an exact byte count by hand.
    this.encKey = createHash('sha256').update(config.pinflEncKey, 'utf8').digest();
  }

  /**
   * Structural validation only: 14 digits, a century/sex digit in 1–6, and a
   * birth date that is a real calendar date.
   *
   * There is deliberately NO check-digit test. The official modulo is not
   * published in a form we can verify, and a guessed checksum would reject real
   * families at the one screen they cannot work around. The real duplicate
   * defence is `child.pinfl_hash UNIQUE` plus the ownership-dispute flow
   * (task.md § 8.2), not arithmetic. See task.md § 14, open question 7.
   */
  static isWellFormed(pinfl: string): boolean {
    return /^[1-6]\d{13}$/.test(pinfl) && PinflService.encodedDob(pinfl) !== null;
  }

  /**
   * The date of birth encoded in the PINFL, or null if those digits are not a
   * real date. task.md § 8.2: a mismatch against the entered DOB is a hard
   * stop, so this has to be exact rather than lenient.
   */
  static encodedDob(pinfl: string): Date | null {
    if (!/^[1-6]\d{13}$/.test(pinfl)) return null;

    const century = Number(pinfl[0]);
    const day = Number(pinfl.slice(1, 3));
    const month = Number(pinfl.slice(3, 5));
    const year = Number(pinfl.slice(5, 7));
    const base = century <= 2 ? 1800 : century <= 4 ? 1900 : 2000;
    const fullYear = base + year;

    const date = new Date(Date.UTC(fullYear, month - 1, day));
    // Rejects 31 February and friends: Date rolls them over, so the round trip
    // only matches for a real calendar date.
    if (
      date.getUTCFullYear() !== fullYear ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  /** `true` when the PINFL's own digits agree with the entered date of birth. */
  static dobMatches(pinfl: string, dob: Date | string): boolean {
    const encoded = PinflService.encodedDob(pinfl);
    if (!encoded) return false;
    const entered = typeof dob === 'string' ? dob.slice(0, 10) : dob.toISOString().slice(0, 10);
    return encoded.toISOString().slice(0, 10) === entered;
  }

  /**
   * The lookup key stored in `child.pinfl_hash`.
   *
   * Keyed, not plain SHA-256: the PINFL space is small enough (a few billion
   * plausible values) that an unkeyed digest would be a reversible identifier.
   * With the salt held outside the database, a stolen dump yields nothing.
   */
  hash(pinfl: string): Buffer {
    return createHmac('sha256', this.hashSalt).update(pinfl, 'utf8').digest();
  }

  /**
   * The sealed value stored in `child.pinfl_enc`, read back only by the
   * outcomes matcher. Layout: `iv(12) || tag(16) || ciphertext`.
   */
  seal(pinfl: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const body = Buffer.concat([cipher.update(pinfl, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  /**
   * Opens a sealed PINFL. The ONLY caller is admission-outcome matching
   * (task.md § 8.5), which compares inside the service and returns `child.id`.
   * Nothing here may be put in a response, a log or an audit payload.
   */
  open(sealed: Buffer): string {
    const iv = sealed.subarray(0, 12);
    const tag = sealed.subarray(12, 28);
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8');
  }
}
