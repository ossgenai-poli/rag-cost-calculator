"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wraps a value and briefly flashes its background whenever the rendered text
 * changes — so users always see that an edit registered, even when the number
 * moves by a rounding-error amount.
 */
export function FlashValue({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const text = String(children);
  const [flash, setFlash] = useState(false);
  const prev = useRef(text);

  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 600);
      return () => clearTimeout(id);
    }
  }, [text]);

  return (
    <span className={`${className ?? ""} ${flash ? "flash rounded px-1 -mx-1" : ""}`.trim()}>
      {children}
    </span>
  );
}
