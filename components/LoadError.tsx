/** A failed load with a way to try again. Used wherever a page fetches its own data. */
export function LoadError({ message, detail, onRetry }: { message: string; detail?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 p-4 text-sm dark:border-red-900">
      <p className="text-red-600">{message}</p>
      {detail && <p className="mt-1 text-xs text-zinc-500">{detail}</p>}
      <button type="button" onClick={onRetry} className="mt-2 font-medium underline">
        Try again
      </button>
    </div>
  );
}
