/**
 * Retry utility with exponential backoff
 */

import { logger } from './logger.js';

/**
 * Backoff strategy
 */
export type BackoffStrategy = 'linear' | 'exponential';

/**
 * Retry options
 */
export interface RetryOptions {
  /** Maximum number of attempts */
  maxAttempts: number;

  /** Initial delay in milliseconds */
  delayMs: number;

  /** Backoff strategy */
  backoff?: BackoffStrategy;

  /** Maximum delay in milliseconds (for exponential backoff) */
  maxDelayMs?: number;

  /** Function to determine if error is retryable */
  shouldRetry?: (error: Error) => boolean;

  /** Callback called before each retry */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for next retry
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  backoff: BackoffStrategy,
  maxDelay?: number
): number {
  let delay: number;

  if (backoff === 'exponential') {
    // Exponential: 2^attempt * baseDelay
    delay = Math.pow(2, attempt - 1) * baseDelay;
  } else {
    // Linear: attempt * baseDelay
    delay = attempt * baseDelay;
  }

  // Cap at maxDelay if specified
  if (maxDelay !== undefined) {
    delay = Math.min(delay, maxDelay);
  }

  return delay;
}

/**
 * Retry a function with exponential backoff
 *
 * @param fn - Function to retry
 * @param options - Retry options
 * @returns Result of the function
 * @throws Last error if all attempts fail
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   () => fetchData(),
 *   {
 *     maxAttempts: 3,
 *     delayMs: 1000,
 *     backoff: 'exponential'
 *   }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    delayMs,
    backoff = 'exponential',
    maxDelayMs = 30000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we should retry
      if (!shouldRetry(lastError)) {
        throw lastError;
      }

      // Don't wait after last attempt
      if (attempt === maxAttempts) {
        break;
      }

      const delay = calculateDelay(attempt, delayMs, backoff, maxDelayMs);

      logger.debug(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await sleep(delay);
    }
  }

  // All attempts failed
  throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Retry a function until it succeeds or timeout is reached
 *
 * @param fn - Function to retry
 * @param timeoutMs - Timeout in milliseconds
 * @param delayMs - Delay between attempts
 * @returns Result of the function
 * @throws Error if timeout is reached
 */
export async function retryUntilSuccess<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  delayMs: number = 1000
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (elapsed >= timeoutMs) {
        throw new Error(
          `Timeout after ${timeoutMs}ms: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await sleep(delayMs);
    }
  }
}
