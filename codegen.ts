import type { CodegenConfig } from '@graphql-codegen/cli';

// Types for the WarcraftLogs API are generated from the schema, not hand-written: the API surface is
// large, it changes, and a typo in a hand-rolled interface is a bug that only shows up against live
// data. The schema is vendored at schema/wcl.graphql (introspected from the classic endpoint) so
// codegen and CI never need network access or an API token.
//
// Regenerate with `npm run codegen`. To refresh the schema itself, re-introspect the API and replace
// schema/wcl.graphql — that is the only step that costs API points.
const config: CodegenConfig = {
	schema: 'schema/wcl.graphql',
	// Operations live beside the client. Adding a new query there and re-running codegen is all it
	// takes to get its result type.
	documents: ['src/lib/wcl/**/*.graphql'],
	ignoreNoDocuments: true,
	generates: {
		'src/generated/wcl-schema.ts': {
			plugins: ['typescript'],
			config: {
				enumsAsTypes: true,
				skipTypename: true,
				// The API models these as JSON blobs; downstream code narrows them itself.
				scalars: { JSON: 'unknown' },
				immutableTypes: false,
				avoidOptionals: false,
			},
		},
		'src/generated/wcl-operations.ts': {
			preset: 'import-types',
			presetConfig: { typesPath: './wcl-schema' },
			plugins: ['typescript-operations'],
			config: { skipTypename: true, scalars: { JSON: 'unknown' } },
		},
	},
};

export default config;
