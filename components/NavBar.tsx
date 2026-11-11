import Link from "next/link";

export function NavBar() {
  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-4 py-3 text-sm sm:px-8">
        <Link href="/" className="font-semibold">
          Offset
        </Link>
        <Link href="/" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Store
        </Link>
        <Link href="/preferences" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Preferences
        </Link>
      </div>
    </nav>
  );
}
