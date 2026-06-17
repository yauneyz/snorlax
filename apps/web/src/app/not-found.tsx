import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found">
      <h1>404</h1>
      <p>That page does not exist.</p>
      <Link href="/">Go home</Link>
    </main>
  );
}
