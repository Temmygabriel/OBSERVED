import Link from 'next/link';

/**
 * Footer. The "Demo states" links exist so every screen the design spec
 * requires — including Paused and Excluded — is reachable and verifiable
 * without a worker running. Each one is clearly labelled as a sample on the
 * page itself.
 */
export function Footer() {
  return (
    <footer className="footer">
      <div className="shell stack stack--tight">
        <p style={{ margin: 0 }}>
          Observed does not have an opinion until it has paid for evidence.
        </p>

        <div className="footer__links">
          <Link href="/status">Status</Link>
          <Link href="/history">History</Link>
          <Link href="/review/sample">Sample: inspecting</Link>
          <Link href="/review/sample-held">Sample: review held</Link>
          <Link href="/review/sample-paused">Sample: paused</Link>
          <Link href="/review/sample-excluded">Sample: excluded</Link>
        </div>

        <p className="mono muted" style={{ margin: 0 }}>
          Every sample page above is labelled as a sample. None of it is
          presented as a real observation.
        </p>
      </div>
    </footer>
  );
}
