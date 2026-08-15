import type { ReactNode } from 'react';

import { labelClass } from './controls';

/** Labels an input and keeps validation feedback wired to the field. */
export default function Field({
	id,
	label,
	error,
	children,
}: {
	id: string;
	label: ReactNode;
	error?: string;
	children: ReactNode;
}) {
	const errorID = `${id}-error`;

	return (
		<div className="flex flex-1 flex-col gap-2">
			<label className={labelClass} htmlFor={id}>
				{label}
			</label>
			{children}
			{error === undefined ? null : (
				<p id={errorID} role="alert" className="m-0 text-base leading-relaxed text-miss">
					{error}
				</p>
			)}
		</div>
	);
}
