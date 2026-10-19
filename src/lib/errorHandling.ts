/**
 * Comprehensive error handling utilities for consistent, robust error management
 * Prevents unhandled promise rejections, freezing UI, and silent failures
 */

export interface ErrorState {
  message: string;
  timestamp: number;
  isRetrying?: boolean;
  retryCount?: number;
}

/**
 * Execute async work with guaranteed error handling and loading state management
 * Prevents unhandled promise rejections and UI freezing
 */
export async function executeAsyncWork<T>(
  work: () => Promise<T>,
  options: {
    onSuccess: (result: T) => void;
    onError: (error: string) => void;
    onFinally?: () => void;
    timeout?: number; // Default 15 seconds
  }
): Promise<void> {
  const timeoutMs = options.timeout ?? 15000;
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) =>
      (timeoutHandle = globalThis.setTimeout(
        () => reject(new Error(`Request timed out after ${timeoutMs / 1000} seconds.`)),
        timeoutMs
      ))
    );

    // Race between work and timeout
    const result = await Promise.race([work(), timeoutPromise]);
    options.onSuccess(result);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
    options.onError(errorMessage);
  } finally {
    if (timeoutHandle !== undefined) globalThis.clearTimeout(timeoutHandle);
    options.onFinally?.();
  }
}

/**
 * Execute async work with automatic retry on transient failures (503, 504, timeouts)
 */
export async function executeWithRetry<T>(
  work: () => Promise<T>,
  options: {
    onSuccess: (result: T) => void;
    onError: (error: string) => void;
    onRetry?: (attemptNumber: number) => void;
    onFinally?: () => void;
    maxAttempts?: number; // Default 3
    timeout?: number; // Default 15 seconds
  }
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 3;
  const timeoutMs = options.timeout ?? 15000;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1 && options.onRetry) {
        options.onRetry(attempt);
      }

      // Execute with timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        globalThis.setTimeout(
          () => reject(new Error(`Request timed out after ${timeoutMs / 1000} seconds.`)),
          timeoutMs
        )
      );

      const result = await Promise.race([work(), timeoutPromise]);
      options.onSuccess(result);
      options.onFinally?.();
      return; // Success, exit retry loop
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isTransientError =
        lastError.message.includes('503') ||
        lastError.message.includes('504') ||
        lastError.message.includes('timeout') ||
        lastError.message.includes('Failed to fetch') ||
        lastError.message.includes('Network request failed');

      const shouldRetry = attempt < maxAttempts && isTransientError;

      if (!shouldRetry) {
        // Final failure, not retrying
        const errorMessage = lastError.message || 'Request failed. Please try again.';
        options.onError(errorMessage);
        options.onFinally?.();
        return;
      }

      // Wait before retry with exponential backoff
      const delayMs = Math.min(500 * Math.pow(2, attempt - 1), 5000);
      await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }

  // Should not reach here, but handle just in case
  options.onError(lastError?.message || 'Request failed after multiple retries.');
  options.onFinally?.();
}

/**
 * Safely handle a promise with guaranteed error/finally execution
 * Use this for void promises that fire-and-forget
 */
export function safePromise<T>(
  promise: Promise<T>,
  options: {
    onSuccess?: (result: T) => void;
    onError?: (error: string) => void;
    onFinally?: () => void;
  } = {}
): void {
  void promise
    .then((result) => {
      options.onSuccess?.(result);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'An error occurred.';
      options.onError?.(message);
    })
    .finally(() => {
      options.onFinally?.();
    });
}

/**
 * Convert ApiError or network error to user-friendly message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('403')) {
      return 'You do not have permission to perform this action.';
    }
    if (error.message.includes('404')) {
      return 'The requested resource was not found.';
    }
    if (error.message.includes('503') || error.message.includes('service unavailable')) {
      return 'The service is temporarily unavailable. Please try again in a moment.';
    }
    if (error.message.includes('504') || error.message.includes('gateway timeout')) {
      return 'The request took too long. Please try again.';
    }
    if (error.message.includes('timeout')) {
      return 'The request timed out. Please check your connection and try again.';
    }
    if (error.message.includes('Failed to fetch') || error.message.includes('Network request failed')) {
      return 'Network connection error. Please check your connection and try again.';
    }
    return error.message;
  }
  return 'An unexpected error occurred. Please try again.';
}
