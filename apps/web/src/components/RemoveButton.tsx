import { useEffect, useRef, useState } from 'react';

const ARM_TIMEOUT_MS = 3000;

export function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!armed) {
      return;
    }

    function handleOutsideClick(event: MouseEvent) {
      if (!buttonRef.current?.contains(event.target as Node)) {
        disarm();
      }
    }

    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [armed]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  function disarm() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmed(false);
  }

  function arm() {
    setArmed(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(disarm, ARM_TIMEOUT_MS);
  }

  function handleClick() {
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    arm();
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`button button-secondary remove-button ${armed ? 'remove-button--armed' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        handleClick();
      }}
      aria-label={armed ? 'Confirm?' : 'Remove'}
    >
      {armed ? 'Confirm?' : 'Remove'}
    </button>
  );
}