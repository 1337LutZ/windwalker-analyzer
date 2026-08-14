# Contributing

## Running it

```sh
npm install
npm run dev      # http://localhost:4321
npm run check    # astro check + tsc --noEmit + oxlint + oxfmt --check
npm test         # vitest
npm run format   # oxfmt, writing in place
```

Linting and formatting are [oxlint](https://oxc.rs) and oxfmt — one Rust binary each, no ESLint and
no Prettier. Both are declared dependencies and are run through `npm run`, so the version CI uses is
the version in the lockfile.

`npm run check` and `npm test` are what CI runs on a pull request, so run both before opening one.
Tests are plain vitest over pure functions: `src/**/*.test.ts`, or anything under `src/**/__tests__/`.
They never hit the network — an analysis takes a `FightDataset`, so a fixture is enough.

## Where things live

- `src/lib/types.ts` is the contract shared by the client, the engine and the UI. Add to it; do not
  reshape what is already there without changing all three.
- `src/lib/analysis/` is deliberately spec-agnostic: cooldown drift, interval and uptime maths, aura
  windows, stack tracking. **No spell ids belong here.**
- **The spec definition** — the object implementing `SpecDefinition` — is where every spell id,
  cooldown, buff duration and rotation rule lives, and it is what you edit to correct a number or to
  add a second spec. It wires the primitives above to Windwalker's ids and returns an `Analysis`.
- `src/components/` renders an `Analysis` and nothing else. No analysis logic in a component.
- `src/generated/` is output: `npm run codegen` derives it from the vendored `schema/wcl.graphql`.
  Change the query, rerun codegen, commit both — never hand-edit the generated files.

Two constraints are not negotiable, because the whole privacy claim rests on them: nothing may add a
backend or a build-time secret, and nothing may introduce a network destination other than
`warcraftlogs.com` (the deployed page's CSP would block it anyway). Code under `src/lib/` and
`src/components/` runs in a browser — no `node:` imports, no `process.env`.

## Do not "simplify" the traps

Combat logs are not tidy, and a fair amount of the engine exists to survive that. Wherever the code
looks redundant, roundabout or paranoid, there is a comment naming the log behaviour that forced it —
Classic reporting `specID` as 0, a refresh that arrives as `applybuff` rather than `refreshbuff`, a
debuff whose last `removedebuff` never arrives because the boss died first, a channel that emits no
`cast` at all.

Those comments are load-bearing. A branch that reads as dead code is usually the branch that keeps
one report in twenty from producing confidently wrong numbers. If you believe a trap is obsolete,
prove it: add a test over a real report that fails with the guard removed, then delete the guard and
its comment in the same commit. "This looked unnecessary" is not a reason.

## Style

Tabs, LF, and the settings in `.editorconfig`. Comments explain _why_ — never restate what the line
already says. Colours come from the semantic tokens in `src/styles/global.css`; the palette was
contrast- and colour-vision-validated, so new hex values do not go in by eye.
