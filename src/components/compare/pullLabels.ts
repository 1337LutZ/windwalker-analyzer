/**
 * What to call each pull, given that the two can genuinely be called the same thing.
 *
 * **Found by looking at the rendered page**, which is the half a suite over two fixtures with
 * distinct names could not have caught. Comparing the two committed pulls that share an identity put
 * one name on both sides of every figure: the legend read the same thing twice, the two tally tiles
 * were indistinguishable, and a row saying it could not measure something "for Player (10)" named
 * neither pull in particular.
 *
 * **Three steps, because there are three ways two pulls can collide**, and each needs the next fact
 * along to separate them:
 *
 *   1. Different players. The names alone, and this is nearly every comparison.
 *   2. **Same name, different reports.** Anonymous reports number their players per report, so
 *      `a:6MhZ…` and `a:YBQz…` both hold a `Player (10)` and the two are not the same person. The
 *      report code separates them, and it is the string the reader typed in themselves.
 *   3. **Same name, same report.** One player's two attempts at one boss — pull 10 against pull 30 of
 *      `a:YBQzrcgVJnAj7NMP`, which is exactly what the committed `mixed` and `poor` fixtures are.
 *      Nothing above the fight can tell those apart, and the compare page pins both pulls to one
 *      encounter, so the boss cannot either. The fight id is WarcraftLogs' own numbering and is the
 *      number the reader already saw in the picker they chose from.
 *
 * Only where they collide, so the common case stays short: a label carrying a report code on every
 * comparison would be noise on all but a handful of them.
 */

/** The three fields a label can be made of, so both a `PullFraming` and an `Analysis` satisfy it. */
interface Named {
	player: string;
	code: string;
	fightID: number;
}

export function pullLabels(a: Named, b: Named): { a: string; b: string } {
	if (a.player !== b.player) return { a: a.player, b: b.player };
	if (a.code !== b.code) return { a: `${a.player} · ${a.code}`, b: `${b.player} · ${b.code}` };
	return { a: `${a.player} · pull ${a.fightID}`, b: `${b.player} · pull ${b.fightID}` };
}
