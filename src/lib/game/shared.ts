// Shared game objects: the consumables, racials and item effects that belong to no one spec.
//
// A spec merges these into its own lists — `{ abilities: [...SHARED_ABILITIES, ...ABILITIES], auras:
// [...SHARED_AURAS, ...AURAS] }` — so a trinket proc or a flask press is defined once and drawn for
// every spec that wears it. Nothing here is a tier set bonus or a class button: those are the spec's
// own, and anything with a relationship to a spec ability (`consumedBy`, `applies` onto a spec button)
// stays in the spec where the link can resolve.
//
// `createRegistry` validates keys and ids, so a shared entry that collides with a spec entry throws —
// which is exactly the guard that keeps a spec from silently redefining something moved here.

import type { Ability, Aura } from './model';

export const SHARED_ABILITIES: Ability[] = [
	// ------------------------------------------------------------------ racials
	// The racial on-use buttons, shared because any class can be any race. All are off-GCD and never
	// scored (`gate: 'other'`); the two with a buff window declare the aura they put up.
	{
		key: 'blood-fury',
		name: 'Blood Fury',
		// Orc: +spell power / attack power for 15s — `sim/core/racials.go` (RegisterTemporaryStatsOnUseCD).
		castIds: [33697],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
		applies: ['blood-fury'],
	},
	{
		key: 'berserking',
		name: 'Berserking',
		// Troll: +20% cast and attack speed for 10s — `sim/core/racials.go:309`.
		castIds: [26297],
		onGcd: false,
		gate: 'other',
		cooldownMs: 180_000,
		applies: ['berserking'],
	},
	{
		key: 'arcane-torrent',
		name: 'Arcane Torrent',
		// Blood Elf: a resource burst that logs a different id per resource — monk 129597, mana 28730,
		// energy 25046, runic 50613, rage 69179, focus 80483 — `sim/core/racials.go:18`. Instant, no
		// buff window; the ids are here so the press is named on any class.
		castIds: [129597, 28730, 25046, 50613, 69179, 80483],
		onGcd: false,
		gate: 'other',
		cooldownMs: 120_000,
	},

	// --------------------------------------------------------------- the tinker
	{
		key: 'synapse-springs',
		name: 'Synapse Springs',
		// The engineering glove tinker, registered as enchant 4898 in `sim/common/mop/enchants.go:216` —
		// `RegisterTemporaryStatsOnUseCD(…, ActionID{SpellID: 126734})`, a 1-minute cooldown behind the
		// shared offensive-trinket timer. The buff it puts up logs under a different id (96228), which is
		// why the aura is declared apart.
		castIds: [126734],
		onGcd: false,
		gate: 'other',
		onUse: true,
		applies: ['synapse-springs'],
	},

	// ------------------------------------------------------- flasks and elixirs
	// The flask and the battle elixirs that get swapped for it, one technique and not several items.
	// A battle elixir cancels a flask — they share the `FlaskVsBattleElixir` exclusive category — so
	// pressing an elixir trades the flask's stat for the elixir's. All off-GCD, so they cost nothing.
	{
		key: 'flask-of-spring-blossoms',
		name: 'Flask of Spring Blossoms',
		castIds: [105689],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'elixir-of-the-rapids',
		name: 'Elixir of the Rapids',
		castIds: [105684],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'mad-hozen-elixir',
		name: 'Mad Hozen Elixir',
		castIds: [105682],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'monks-elixir',
		name: "Monk's Elixir",
		castIds: [105688],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
	{
		key: 'healthstone',
		name: 'Healthstone',
		// `registerConjuredCD` in `sim/core/consumes.go:372` — conjured item 5512, on the shared conjured
		// timer. It heals and does nothing else, which is why it declares no aura: there is no buff
		// window to draw and the press is the whole event.
		castIds: [6262],
		onGcd: false,
		gate: 'other',
		onUse: true,
	},
];

export const SHARED_AURAS: Aura[] = [
	// -------------------------------------------------------------- racial buffs
	{
		key: 'blood-fury',
		name: 'Blood Fury',
		ids: [33697],
		kind: 'buff',
		durationMs: 15_000,
		appliedBy: 'blood-fury',
	},
	{
		key: 'berserking',
		name: 'Berserking',
		ids: [26297],
		kind: 'buff',
		durationMs: 10_000,
		appliedBy: 'berserking',
	},
	{
		key: 'bloodlust',
		// Named for the effect rather than for any one spell: the log names whichever was cast and the
		// rotation's condition does not care which. `variants` is what says which it actually was.
		name: 'Bloodlust',
		/**
		 * The raid's haste cooldown, whichever class brought it.
		 *
		 * The APL writes this condition as `auraIsInactive(2825, tag: -1)`, and in wowsims a tag of -1
		 * means "any source" rather than "Bloodlust specifically" — the whole shared-exclusion group is
		 * one effect as far as the rotation is concerned. A log names whichever spell was cast, so all
		 * five ids have to be here or a raid with a mage instead of a shaman reads as having no haste
		 * cooldown at all. Names confirmed against the 5.4 client data the sim ships.
		 */
		ids: [2825, 32182, 80353, 90355, 146555],
		variants: {
			2825: 'Bloodlust',
			32182: 'Heroism',
			80353: 'Time Warp',
			90355: 'Primal Rage',
			146555: 'Drums of Rage',
		},
		kind: 'buff',
	},

	// ---------------------------------------------------------- the tinker buff
	{
		key: 'synapse-springs',
		name: 'Synapse Springs',
		// Pressed, so it is a lane that merges onto its own press row. 96228 and not the 126734 the
		// simulator uses for both halves: the tinker's button and the buff it puts up are two different
		// ids in a Classic log. Measured on the reference pulls — 126734 is always the cast and 96228 is
		// always the buff.
		ids: [96228],
		kind: 'buff',
		appliedBy: 'synapse-springs',
	},

	// ------------------------------------------------------ trinkets, meta, cloak
	// The non-tier item effects: gear procs that fire on their own and belong to no spec. Each is a
	// `buff` in the game's sense — none touches the enemy — and the timeline's proc/buff split is made
	// further down, not here.
	{
		key: 'unerring-vision',
		name: 'Unerring Vision of Lei-Shen',
		ids: [138963],
		kind: 'buff',
	},
	{
		key: 'unerring-vision-stacks',
		name: 'Unerring Vision of Lei-Shen (stacking)',
		ids: [138786],
		kind: 'buff',
		maxStacks: 10,
	},
	{
		key: 'breath-of-hydra',
		name: 'Breath of the Hydra',
		ids: [138898],
		kind: 'buff',
	},
	{
		key: 'chayes',
		name: "Cha-Ye's Essence of Brilliance",
		ids: [139133],
		kind: 'buff',
	},
	{
		key: 'wrath-of-darkspear',
		name: 'Wrath of the Darkspear',
		ids: [146184],
		kind: 'buff',
		maxStacks: 10,
	},
	{
		key: 'tempus-repit',
		name: 'Tempus Repit',
		ids: [137590],
		kind: 'buff',
	},
	{
		key: 're-origination',
		name: 'Re-Origination',
		// Rune of Re-Origination converts your two lowest secondary stats into twice as much of your
		// highest, and logs a *different aura per stat gained*. Which one you get depends on what else
		// was up at the proc, so a single fight can mix all three. Mapping confirmed two ways: the DBC
		// effect order and `sim/common/mop/trinkets_phase_3_52.go`.
		ids: [139117, 139120, 139121],
		variants: { 139117: 'Crit', 139120: 'Mastery', 139121: 'Haste' },
		kind: 'buff',
		durationMs: 10_000,
	},
	{
		key: 'vicious',
		name: 'Vicious',
		// Haromm's Talisman, the agility half of the pair of Siege multistrike trinkets —
		// `sim/common/mop/trinkets_phase_4_54.go:363-367`.
		ids: [148903],
		kind: 'buff',
	},
	{
		key: 'ferocity',
		name: 'Ferocity',
		// Sigil of Rampage, the agility cleave trinket — `sim/common/mop/trinkets_phase_4_54.go:739-743`.
		ids: [148896],
		kind: 'buff',
	},
	{
		key: 'capacitance',
		name: 'Capacitance',
		// The Capacitive Primal Diamond (item 95346): stacks to five, then spends the whole stack on a
		// Lightning Strike — `sim/common/mop/metagems.go:69-79`. A counter, not a plain buff.
		ids: [137596],
		kind: 'buff',
		maxStacks: 5,
	},
	{
		key: 'flurry-of-xuen',
		name: 'Flurry of Xuen',
		// The legendary cloak. `sim/common/mop/cloaks_phase_4_54.go:133-136` registers this aura for
		// Fen-Yu, Fury of Xuen (item 102248) — three seconds during which the cloak throws its own
		// strikes, which land under 147891.
		ids: [146194],
		kind: 'buff',
	},
];
