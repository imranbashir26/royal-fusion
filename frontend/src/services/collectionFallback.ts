import type { Collection } from '../types'

export function collectionFallback(isProduction: boolean, bundledCollections: Collection[]): Collection[] {
  return isProduction ? [] : bundledCollections
}

export function prototypeCollectionFallback(
  isProduction: boolean,
  prototypeCollections: Collection[] | undefined,
  bundledCollections: Collection[],
): Collection[] {
  return isProduction ? [] : prototypeCollections ?? bundledCollections
}
