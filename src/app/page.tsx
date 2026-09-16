import { redirect } from 'next/navigation';

/** There is no landing page. Signed in, you want your runs; signed out, the middleware says so. */
export default function HomePage() {
  redirect('/runs');
}
