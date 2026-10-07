import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-serif text-3xl font-semibold">Not found</h1>
      <p className="mt-2 text-muted">That lab or page does not exist.</p>
      <Link href="/" className="mt-6 inline-block text-accent underline underline-offset-2">
        Back to the labs
      </Link>
    </div>
  );
}
