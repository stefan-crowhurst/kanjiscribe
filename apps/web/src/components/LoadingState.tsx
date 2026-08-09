import type { JSX } from 'react';

export function LoadingState({ message }: { message: string }): JSX.Element {
  return (
    <div className="loading-state" role="status" aria-live="polite" aria-busy="true">
      <span className="loading-spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
