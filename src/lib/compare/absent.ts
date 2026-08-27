// Why a button is missing from one of the two logs.
//
// **"Not pressed" is only true when the button was there to press.** It was the one thing an absent
// row said, and on the compare page it was wrong three ways out of four: a talent the other player
// took instead, a racial their character cannot have, and a log that carried no talent list to answer
// from at all. A monk who chose Dampen Harm was reported as a monk who declined to press Diffuse
// Magic, which is not a reading of that pull — it is the report inventing a decision.
//
// The talent case needs no declaration anywhere. Two logs' own talent lists settle it between them: an
// id in one and not the other was not taken. A racial has no list to be missing from, so those are
// declared on the ability — see `Ability.gatedBy`.

/** What the absence of a button on one side actually means. */
export type Absence =
	/** The other log's talent list holds it and this one's does not. */
	| 'notTalented'
	/** A racial or a profession button. This character could not have had it whatever they chose. */
	| 'cannotHave'
	/** They had it and it never went out. The only case the old wording was right about. */
	| 'notPressed'
	/** No talent list to read, so the report cannot tell the first case from the third. */
	| 'unknown';

export interface AbsenceInput {
	/** Every id this button logs a cast under, from `Ability.castIds`. Empty when unmodelled. */
	castIds: readonly number[];
	/** `Ability.gatedBy`, when the model declares one. */
	gatedBy?: 'race' | 'profession';
	/** The talent ids of the log the row is missing from. Null when it carried none, undefined when
	 *  the capture predates the field. */
	mine: readonly number[] | null | undefined;
	/** The talent ids of the log that does have the row, read the same three ways. */
	theirs: readonly number[] | null | undefined;
}

/**
 * The four-way answer, in the order the evidence settles it.
 *
 * **Gating first, because it is a fact about the character rather than about the pull.** A Draenei's
 * Gift of the Naaru is absent from an orc's log for a reason no talent list will ever mention, and
 * asking the lists first would answer "cannot say" on a question that has an answer.
 *
 * Then the talent lists, and both have to be readable: a missing id proves nothing unless the list it
 * is missing from was actually read, and unless the other log's list shows the button was a talent to
 * begin with. Without both, the honest answer is that the report cannot say — never `notPressed`,
 * which would be the same guess in a quieter voice.
 */
export function absenceOf({ castIds, gatedBy, mine, theirs }: AbsenceInput): Absence {
	if (gatedBy !== undefined) return 'cannotHave';
	// `null` is a log with no `combatantinfo`; `undefined` is a capture from before the field existed.
	// Neither can be read as an empty list, so neither can support a claim about what was taken.
	if (mine === undefined || mine === null || theirs === undefined || theirs === null) return 'unknown';
	// A button the other log did not take either is not a talent they chose over this one — it is a
	// button neither of them talented, and the absence says nothing about the choice.
	if (!castIds.some((id) => theirs.includes(id))) return 'notPressed';
	return castIds.some((id) => mine.includes(id)) ? 'notPressed' : 'notTalented';
}
