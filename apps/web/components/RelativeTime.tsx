'use client';

import { useEffect, useState } from 'react';
import { formatClockUtc, formatRelativeFrom } from '@/lib/format';

/**
 * A timestamp that reads as an absolute UTC clock on the server and upgrades
 * to "2 min ago" once the page is live in the browser.
 *
 * This shape is deliberate. Rendering a relative time during server render
 * would either freeze it at build time (if the page is prerendered) or risk a
 * hydration mismatch (if the client recomputes a different value). Starting
 * from the absolute clock keeps the server and the first client render byte-
 * identical, and the switch happens in an effect where it is safe.
 */
export function RelativeTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const [label, setLabel] = useState(() => formatClockUtc(iso));

  useEffect(() => {
    const update = () => setLabel(formatRelativeFrom(iso, new Date()));
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [iso]);

  return (
    <time dateTime={iso} className={className} title={formatClockUtc(iso)}>
      {label}
    </time>
  );
}
