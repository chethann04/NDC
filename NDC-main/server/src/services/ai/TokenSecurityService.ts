import crypto from 'crypto';
import prisma from '../../config/prisma';

export interface GeneratedToken {
  rawToken: string;
  tokenHash: string;
}

export interface TokenValidationCriteria {
  expectedUserId?: string;
  expectedDepartmentId?: string;
  expectedClearanceId?: string;
  expectedDueInstanceId?: string;
  expectedTaskId?: string;
  expectedStepId?: string;
  expectedFencingToken?: number;
  expectedAction?: string;
  expectedUsn?: string;
  expectedAmount?: number;
}

export class TokenSecurityService {
  /**
   * Deterministically computes a SHA-256 hash of a raw token.
   * Rejects empty or non-string tokens.
   */
  public static hashToken(rawToken: string): string {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new Error('TokenSecurityService: Cannot hash an empty or invalid token.');
    }
    const clean = rawToken.trim();
    if (clean.length === 0) {
      throw new Error('TokenSecurityService: Token cannot be empty or whitespace.');
    }
    return crypto.createHash('sha256').update(clean).digest('hex');
  }

  /**
   * Generates a cryptographically secure random token (256 bits entropy)
   * and its SHA-256 hash.
   * The rawToken must be returned to the client and NEVER persisted in DB.
   * The tokenHash is the only identifier saved in persistent storage.
   */
  public static generateToken(): GeneratedToken {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    return { rawToken, tokenHash };
  }

  /**
   * Masks a token or hash for safe telemetry without leaking secrets.
   */
  public static mask(tokenOrHash?: string | null): string {
    if (!tokenOrHash || typeof tokenOrHash !== 'string') return '[REDACTED]';
    if (tokenOrHash.length <= 8) return '***';
    return `${tokenOrHash.substring(0, 4)}...${tokenOrHash.substring(tokenOrHash.length - 4)}`;
  }

  /**
   * Finds an unconsumed, non-expired confirmation token by its raw token value.
   * Performs SHA-256 hash before lookup.
   */
  public static async findTokenByRaw(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    return prisma.aiConfirmationToken.findFirst({
      where: {
        tokenHash
      }
    });
  }

  /**
   * Atomically consumes a confirmation token using its raw token string.
   * 1. Hashes incoming raw token.
   * 2. Executes atomic CAS update (consumed: false -> consumed: true).
   * 3. Validates ownership, scope, expiry, dueInstanceId, fencingToken.
   * 4. If any validation fails, reverts the atomic consumption to avoid burning token on client errors.
   */
  public static async atomicConsume(
    rawToken: string,
    criteria?: TokenValidationCriteria
  ) {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    // 1. Atomic Compare-And-Set
    const updateResult = await prisma.aiConfirmationToken.updateMany({
      where: {
        tokenHash,
        consumed: false,
        expiresAt: { gt: now }
      },
      data: {
        consumed: true,
        consumedAt: now
      }
    });

    if (updateResult.count === 0) {
      const existing = await prisma.aiConfirmationToken.findFirst({
        where: { tokenHash }
      });

      if (!existing) {
        throw new Error('Invalid or non-existent confirmation token.');
      }
      if (existing.consumed) {
        const p = (existing.payload as any) || {};
        if (p.cancelled) {
          throw new Error('This confirmation token has been cancelled and cannot be executed.');
        }
        if (p.lifecycleStatus === 'SUPERSEDED') {
          throw new Error('This confirmation token was superseded by a newer action and cannot be executed.');
        }
        throw new Error('This confirmation token has already been confirmed and executed.');
      }
      if (existing.expiresAt <= now) {
        throw new Error('This confirmation token has expired. Please stage the operation again.');
      }
      throw new Error('Confirmation token is not available for execution.');
    }

    // 2. Fetch fresh record for post-consumption validation
    const confirmation = await prisma.aiConfirmationToken.findFirst({
      where: { tokenHash }
    });

    if (!confirmation) {
      throw new Error('Failed to retrieve consumed token record.');
    }

    const payload = (confirmation.payload as any) || {};

    // 3. Strict Validation Checklist
    try {
      if (criteria) {
        // User Ownership Binding
        if (criteria.expectedUserId && confirmation.userId !== criteria.expectedUserId) {
          throw new Error('Unauthorized: This confirmation token was generated for a different user account.');
        }

        // Clearance Scope Binding
        if (criteria.expectedClearanceId && confirmation.clearanceId && confirmation.clearanceId !== criteria.expectedClearanceId) {
          throw new Error('Security mismatch: Target clearance does not match the staged confirmation token.');
        }

        // Due Instance Binding (Recurring due lifecycle guarantee)
        if (criteria.expectedDueInstanceId) {
          const stagedDueInstance = confirmation.dueInstanceId || payload.dueInstanceId;
          if (stagedDueInstance && stagedDueInstance !== criteria.expectedDueInstanceId) {
            throw new Error(`Lifecycle mismatch: Token targets due instance [${stagedDueInstance}], expected [${criteria.expectedDueInstanceId}].`);
          }
        }

        // Task & Step Binding
        if (criteria.expectedTaskId && confirmation.taskId && confirmation.taskId !== criteria.expectedTaskId) {
          throw new Error('Task binding mismatch: Token is bound to an unrelated task.');
        }
        if (criteria.expectedStepId && confirmation.stepId && confirmation.stepId !== criteria.expectedStepId) {
          throw new Error('Step binding mismatch: Token is bound to an unrelated step.');
        }

        // Fencing Token Binding
        if (criteria.expectedFencingToken !== undefined && confirmation.fencingToken !== null && confirmation.fencingToken !== undefined) {
          if (confirmation.fencingToken !== criteria.expectedFencingToken) {
            throw new Error(`Fencing token mismatch: Token fence [${confirmation.fencingToken}] does not match worker fence [${criteria.expectedFencingToken}].`);
          }
        }

        // Action type validation
        if (criteria.expectedAction && confirmation.action !== criteria.expectedAction) {
          throw new Error(`Parameter mismatch: Expected action [${confirmation.action}], but received [${criteria.expectedAction}].`);
        }

        // USN validation
        if (criteria.expectedUsn && payload.usn) {
          if (String(payload.usn).toUpperCase() !== String(criteria.expectedUsn).toUpperCase()) {
            throw new Error(`Parameter mismatch: Expected USN [${payload.usn}], but received [${criteria.expectedUsn}].`);
          }
        }

        // Amount validation
        if (criteria.expectedAmount !== undefined && confirmation.action === 'MARK_DUE') {
          if (Number(payload.amount) !== Number(criteria.expectedAmount)) {
            throw new Error(`Parameter mismatch: Expected amount [₹${payload.amount}], but received [₹${criteria.expectedAmount}].`);
          }
        }
      }

      return confirmation;
    } catch (valErr: any) {
      // Revert consumption on validation failure (client input mismatch)
      await prisma.aiConfirmationToken.update({
        where: { id: confirmation.id },
        data: { consumed: false, consumedAt: null }
      });
      throw valErr;
    }
  }
}

