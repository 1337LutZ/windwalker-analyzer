// TEMPORARY diagnostic, deleted before the change lands. Confirms the corrected numerator against the
// coordinator's independent figure, and shows which of the two window bugs each second comes from.
import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { engagedWindows } from '~/lib/analysis/engagement';
import { intersect, mergeIntervals, overlapMs, unionMs, type Interval } from '~/lib/analysis/intervals';
import { abilityIdOf, isAuraApply, isAuraRefresh, isAuraRemove, isDamage } from '~/lib/events/guards';
import type { WclEvent } from '~/lib/types';
import { WclClient, fetchFightDataset } from '~/lib/wcl';

const token = process.env['WCL_TOKEN'] ?? '';
const OUT = process.env['PROBE_OUT'] ?? '/tmp/probe.txt';
const RSK = new Set([130_320]);
const GAP_MS = 15_000;

type E = WclEvent & { targetInstance?: number };

describe.skipIf(token === '')('probe', () => {
	it('confirms the corrected numerator', { timeout: 900_000 }, async () => {
		const client = new WclClient({ token });
		const out: string[] = [];
		for (const [code, fightID] of [
			['a:6MhZgjyAknFWrYfK', 10],
			['a:YBQzrcgVJnAj7NMP', 9],
			['a:6MhZgjyAknFWrYfK', 57],
			['a:YBQzrcgVJnAj7NMP', 30],
		] as const) {
			const players = await client.fetchPlayerDetails(code, fightID);
			const ww = players.find((p) => p.playerClass === 'Monk' && p.specs.includes('Windwalker'));
			if (!ww) continue;
			const dataset = await fetchFightDataset(client, { code, fightID, playerName: ww.name });
			const { events, actor, fight } = dataset;
			const t0 = fight.startTime;
			const duration = fight.endTime - t0;

			const debuffEvents = (events as E[]).filter((e) => {
				const id = abilityIdOf(e);
				return id !== null && RSK.has(id) && e.targetID !== undefined;
			});
			const petIDs = new Set(
				(dataset.actors ?? []).filter((x) => (x as { petOwner?: number }).petOwner === actor.id).map((x) => x.id),
			);
			const mine = (id: number | undefined): boolean => id !== undefined && (id === actor.id || petIDs.has(id));
			const damageEvents = events.filter(isDamage).filter((e) => mine(e.sourceID));
			const contact = engagedWindows(
				damageEvents.filter((e) => !(isDamage(e) && e.tick === true)).map((e) => e.timestamp - t0),
				GAP_MS,
			);
			const contactMs = unionMs(contact);

			const build = (instance: boolean, openOnRefresh: boolean) => {
				const open = new Map<string, number>();
				const acc = new Map<string, Interval[]>();
				const push = (k: string, w: Interval) => {
					const l = acc.get(k);
					if (l) l.push(w);
					else acc.set(k, [w]);
				};
				for (const e of debuffEvents) {
					const k = instance ? `${e.targetID}:${e.targetInstance ?? '-'}` : `${e.targetID}`;
					if (isAuraApply(e) || (openOnRefresh && isAuraRefresh(e))) {
						if (!open.has(k)) open.set(k, e.timestamp);
					} else if (isAuraRemove(e)) {
						const s = open.get(k);
						if (s !== undefined) {
							push(k, [s - t0, e.timestamp - t0]);
							open.delete(k);
						}
					}
				}
				for (const [k, s] of open) push(k, [s - t0, duration]);
				const merged = new Map<string, Interval[]>();
				for (const [k, l] of acc) merged.set(k, mergeIntervals(l));
				return merged;
			};

			const hits: Array<{ t: number; id: number; key: string }> = [];
			for (const e of damageEvents as Array<(typeof damageEvents)[number] & { targetInstance?: number }>) {
				if (e.sourceID !== actor.id || e.tick === true || e.targetID === undefined) continue;
				hits.push({ t: e.timestamp - t0, id: e.targetID, key: `${e.targetID}:${e.targetInstance ?? '-'}` });
			}
			hits.sort((a, b) => a.t - b.t);

			const numerator = (w: Map<string, Interval[]>, instance: boolean) => {
				const cache = new Map<string, Interval[]>();
				const on = (k: string): Interval[] => {
					const known = cache.get(k);
					if (known) return known;
					const v = mergeIntervals(intersect(w.get(k) ?? [], contact));
					cache.set(k, v);
					return v;
				};
				let total = 0;
				for (let i = 0; i < hits.length; i++) {
					const h = hits[i];
					if (h === undefined) continue;
					total += overlapMs(h.t, hits[i + 1]?.t ?? duration, on(instance ? h.key : `${h.id}`));
				}
				return total;
			};

			const pct = (ms: number) => `${(ms / 1000).toFixed(1)}s (${((ms / contactMs) * 100).toFixed(1)}%)`;
			out.push(
				`=== ${code.slice(2, 8)}#${fightID} ${fight.name} — contact ${(contactMs / 1000).toFixed(1)}s, ${
					debuffEvents.length
				} debuff events`,
				`  shipped      (id,      apply only)  ${pct(numerator(build(false, false), false))}`,
				`  +instances   (id:inst, apply only)  ${pct(numerator(build(true, false), true))}`,
				`  +refresh     (id,      apply+refr)  ${pct(numerator(build(false, true), false))}`,
				`  both fixed   (id:inst, apply+refr)  ${pct(numerator(build(true, true), true))}`,
			);
		}
		writeFileSync(OUT, out.join('\n'));
	});
});
