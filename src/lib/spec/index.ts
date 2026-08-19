// The specs this app can analyse. The registry is the only list: a new spec is one entry here plus
// its own module in its own folder beside `windwalker/`.

export * from './registry';
export { analyse, registry, WINDWALKER } from '~/specs/windwalker';
