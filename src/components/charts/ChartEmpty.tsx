/** What a section shows instead of an axis with nothing on it. */
export default function ChartEmpty({ children }: { children: string }) {
	return (
		<p className="m-0 rounded-sm border border-line bg-surface px-4 py-6 text-center text-sm text-muted">{children}</p>
	);
}
