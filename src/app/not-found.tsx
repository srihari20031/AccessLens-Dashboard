import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="stack" style={{ maxWidth: '34rem' }}>
      <h1>Not found</h1>
      <p className="prose">
        There is no run here. It may have been deleted, or it may belong to another account.
      </p>
      <p>
        <Link href="/runs">Back to your runs</Link>
      </p>
    </div>
  );
}
