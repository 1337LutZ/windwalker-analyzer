// One entry in a chart's legend: a swatch and what that colour means.
//
// The swatch classes are written out here rather than passed in, because Tailwind only ships a class
// it can see spelled in full — and because a legend is the only thing standing between a reader and
// a chart whose colours are its verdict.

const SWATCH = {
	brew: 'bg-brew',
	rune: 'bg-rune',
	kick: 'bg-kick',
	miss: 'bg-miss',
	missSoft: 'bg-miss-soft',
} as const;

export type KeyTone = keyof typeof SWATCH;

export default function ChartKey({ tone, children }: { tone: KeyTone; children: string }) {
	return (
		<span className="flex items-center gap-2">
			<i className={`inline-block h-3 w-3 shrink-0 rounded-sm ${SWATCH[tone]}`} aria-hidden="true" />
			{children}
		</span>
	);
}
