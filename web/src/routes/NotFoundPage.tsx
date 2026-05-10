import { Link } from 'react-router';
import { ArrowLeft, FileX } from '../components/icons.ts';
import { EmptyState } from '../components/EmptyState.tsx';

export function NotFoundPage() {
  return (
    <main className="page">
      <EmptyState
        icon={FileX}
        title="Page not found"
        description="The URL doesn't match any route in the app."
        action={
          <Link className="btn primary" to="/">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to start
          </Link>
        }
      />
    </main>
  );
}
