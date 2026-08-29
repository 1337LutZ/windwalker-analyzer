import { useTranslation } from 'react-i18next';

import type { JudgmentCause } from '~/lib/types';

/**
 * The badge that says whose a judgment is: Player, Rotation, Fight, Log, Raid or Talent build.
 *
 * **Beside the words rather than inside them**, which is the whole design. A tag written into the copy
 * would be a category nothing could guard, nothing could colour and nothing could ever count; the
 * engine publishes `JudgmentCause` per row and this is the one place that turns it into a word. The
 * same division `ChartKey` keeps against a raw class passed in by a caller.
 *
 * **Two tones and not six.** Only `player` is a fault the reader can practise away, so only `player`
 * takes the fault colour; the other five are all "not yours to drill" and share the muted chip. A
 * palette entry per tag would be six colours claiming six severities, when what the tag states is
 * authorship. The row's own band still says whether the fault was charged.
 *
 * The text is never the only carrier: the tag is a word, so a reader who cannot separate the two tones
 * loses nothing.
 */
export default function CauseTag({ cause }: { cause: JudgmentCause }) {
	const { t } = useTranslation('report');
	const tone = cause === 'player' ? 'border-miss/50 bg-miss/10 text-ink' : 'border-line bg-surface text-ink-2';
	return (
		<span
			className={`mr-2 inline-block shrink-0 rounded-sm border px-1.5 py-[2px] font-mono text-xs font-medium tracking-[0.06em] whitespace-nowrap ${tone}`}
		>
			{t(`cause.${cause}.label`)}
		</span>
	);
}
