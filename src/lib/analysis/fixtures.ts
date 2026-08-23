// Which committed fixtures exist, found rather than listed — the discovery the three aura guards share.
//
// **The hole this closes was in the guard family itself.** Three guards protect the aura model:
// `analysis/__tests__/fixtureCoverage.test.ts` asks which declared aura never fires, each spec's
// `lib/__tests__/drawnAuras.test.ts` asks which firing aura is drawn nowhere, and
// `game/__tests__/undeclaredAuras.test.ts` asks which firing aura nothing declares. The third mode has
// fired for real twice — 61316 Dalaran Brilliance and 16246 Clearcasting — so the family earns its keep.
// But only the first of the three discovered its own input: the coverage guard walked the fixture
// directory, while the drawn-aura guard's `FIXTURES` and the undeclared guard's `PULLS` were literal
// lists of names. So a newly committed fixture was swept by one guard automatically and by the other two
// never, which is precisely the shape of gap this family exists to catch.
//
// **Why discovery and not a shared literal.** A listed set has to be edited by whoever adds the next
// fixture, and that is the same person who would forget — the argument the coverage guard already made
// for itself. A literal also fails silently in the direction that matters: nothing goes red, the new
// pull simply is not looked at.
//
// **Why the two shapes are classified rather than filtered.** Both `__fixtures__` directories hold
// `.json` under one extension and two entirely different types. `specs/elemental/__fixtures__` is four
// raw `FightDataset`s; `specs/windwalker/__fixtures__` is one raw dataset and six captured `Analysis`
// objects, because that spec's capture harness writes `analyse()`'s *output* rather than its input. A
// raw dataset has `events` and an `actor`; a capture has neither, and carries `casts` and an `actorID`
// instead. The guards need different halves — the drawn-aura sweep needs an `Analysis`, the other two
// need raw events — and a discovery pass that let one shape through where the other was wanted would
// hand a guard nothing to sweep. **That is worse than the asymmetry it replaced**: a guard sweeping zero
// fixtures passes, and `undeclaredAuras.test.ts` already carries an explicit non-vacuity test because
// this repository has been bitten by assertions with nothing behind them. So a `.json` that answers to
// neither shape throws by name rather than being dropped, and so does a directory with no `.json` in it
// at all — a wrong path is the accident this catches.
//
// **Why here and not under a `__tests__` folder.** `vitest.config.ts` collects
// `src/**/__tests__/**/*.ts` as suites and its own comment says a helper `.ts` with no suite in it fails
// the run, so a shared helper cannot live there. This is where `docs/conventions.md` sends a reader
// looking for spec-agnostic machinery, and it is the neighbour of `drawnAuras.ts`, which the same three
// guards already share for the same reason. Resolving the fixture root from *this* file's directory is
// half the point: the three callers reached the same two directories by three different relative paths.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Analysis, FightDataset } from '~/lib/types';

/** A raw pull: the analyser's input, as fetched. */
export interface RawFixture {
	/** The file name, extension included — the key the guards' pinned grids are written under. */
	name: string;
	dataset: FightDataset;
}

/** A captured report: the analyser's output, frozen. Carries no `events` and cannot be swept for any. */
export interface CapturedFixture {
	name: string;
	analysis: Analysis;
}

const fixtureRoot = (spec: string): string => resolve(import.meta.dirname, `../../specs/${spec}/__fixtures__`);

/**
 * Both shapes, classified, in file order.
 *
 * Not cached. Two of the three guards read these directories several times over, and the parse is a few
 * megabytes — but a module-level cache would hand the same mutable dataset to every test in a file, and
 * a guard family is the last place to introduce a way for one assertion to change another's input.
 */
function readFixtures(spec: string): { raw: RawFixture[]; captured: CapturedFixture[] } {
	const root = fixtureRoot(spec);
	const files = readdirSync(root)
		.filter((file) => file.endsWith('.json'))
		.sort();
	if (files.length === 0) throw new Error(`no .json fixtures under ${root} — is the spec directory named right?`);

	const raw: RawFixture[] = [];
	const captured: CapturedFixture[] = [];
	for (const name of files) {
		const parsed = JSON.parse(readFileSync(resolve(root, name), 'utf8')) as unknown;
		const candidate = parsed as Partial<FightDataset> & Partial<Analysis>;
		const isRaw = Array.isArray(candidate.events) && candidate.actor !== undefined;
		const isCaptured =
			candidate.events === undefined && Array.isArray(candidate.casts) && candidate.actorID !== undefined;
		// Both, or neither, means the two types have stopped being distinguishable by these fields — at
		// which point every caller is silently getting the wrong half. Loud, and named.
		if (isRaw === isCaptured)
			throw new Error(
				`${spec}/${name} is neither a raw FightDataset (events + actor) nor a captured Analysis (casts + actorID, no events). One of the two shapes changed; the guards that sweep them cannot tell which half this is.`,
			);
		if (isRaw) raw.push({ name, dataset: parsed as FightDataset });
		else captured.push({ name, analysis: parsed as Analysis });
	}
	return { raw, captured };
}

/**
 * Every raw `FightDataset` a spec has committed, in file order.
 *
 * Legitimately non-empty for both specs today, but not asserted here: emptiness is a property of the
 * spec that each caller has to decide is acceptable, and both callers that cannot tolerate it say so
 * with a test of their own rather than trusting this.
 */
export const rawFixtures = (spec: string): RawFixture[] => readFixtures(spec).raw;

/**
 * Every captured `Analysis` a spec has committed, in file order.
 *
 * Empty for the Elemental, which has committed none — so a caller iterating this must not be the only
 * thing standing between a claim and nothing.
 */
export const capturedAnalyses = (spec: string): CapturedFixture[] => readFixtures(spec).captured;

/**
 * One named raw pull, for the assertions that are about a specific pull's own numbers.
 *
 * The findings these guards were written for — Bloodlust's lone removal on `dataset-ironJuggernaut`, the
 * Fire Elemental's on `phased` — are facts about one log and are named as such. Going through discovery
 * rather than a second `readFileSync` is what makes a renamed or re-shaped fixture fail here too, rather
 * than only in the sweep.
 */
export function rawFixture(spec: string, name: string): FightDataset {
	const found = rawFixtures(spec).find((fixture) => fixture.name === name);
	if (found === undefined)
		throw new Error(
			`no raw fixture ${spec}/${name} — the directory holds ${rawFixtures(spec)
				.map((fixture) => fixture.name)
				.join(', ')}`,
		);
	return found.dataset;
}
