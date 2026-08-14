/**
 * A block standing in for something that has not arrived yet.
 *
 * Decorative by definition, and hidden from the accessibility tree because of it: a reader who
 * cannot see the page gains nothing from being told there are five grey rectangles, and the one
 * thing worth announcing — that a fetch is running — is already announced once, politely, by
 * `FetchProgress`. Eight self-describing placeholders would be eight interruptions saying it again.
 *
 * It carries no animation of its own, deliberately. A placeholder is almost always several of these
 * together, and a dozen bars each starting their own two-second cycle at the moment they happened to
 * mount is precisely the slot machine this is meant to replace. The pulse therefore belongs on the
 * single element that groups them, which is the caller's to place — `motion-safe:animate-pulse`, so
 * that a reader who asked for less motion gets a still box rather than a fast one.
 *
 * `className` carries the size, because that is the only thing that differs between uses and
 * Tailwind needs the value written out literally to emit it.
 */
export default function Skeleton({ className = '' }: { className?: string }) {
	return <div aria-hidden="true" className={`rounded-sm bg-raised ${className}`} />;
}
