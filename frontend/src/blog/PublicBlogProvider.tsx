/* eslint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import type { BlogArticle, BlogListInput, BlogListResponse } from '../../../shared/contracts/blogV1'
import { PublicBlogError, validatePublicBlogConfiguration, type BlogFailure, type PublicBlogClient } from '../services/publicBlogsApi'

/** No environment/URL switch: the application entry point supplies no integration. */
export interface BlogIntegration { readonly enabled: true; readonly client: PublicBlogClient }
export type BlogLoadState<T> = { status: 'idle' | 'loading' | 'ready' | 'empty' | BlogFailure; data?: T }
export type BlogRouteState = BlogLoadState<BlogArticle>
interface BlogContext {
  enabled: boolean
  client?: PublicBlogClient
  routeKey: string
  pathname: string
  metadata: BlogRouteState
  publishMetadata: (path: string, state: BlogRouteState) => void
}
const disabled: BlogContext = { enabled: false, routeKey: '', pathname: '', metadata: { status: 'idle' }, publishMetadata: () => {} }
const Context = createContext<BlogContext>(disabled)

export function PublicBlogProvider({ integration, children }: { integration?: BlogIntegration; children: ReactNode }) {
  const location = useLocation()
  const client = integration?.enabled === true ? integration.client : undefined
  if (integration && (!client || typeof client.list !== 'function' || typeof client.getBySlug !== 'function')) throw new TypeError('Blog configuration is invalid.')
  if (client) validatePublicBlogConfiguration(client.configuration)
  const [route, setRoute] = useState<{ key: string; client?: PublicBlogClient; metadata: BlogRouteState }>({ key: location.key, client, metadata: { status: 'loading' } })
  // Reset before rendering descendants, so history navigation cannot briefly reuse old article metadata.
  if (route.key !== location.key || route.client !== client) setRoute({ key: location.key, client, metadata: { status: 'loading' } })
  const publishMetadata = useCallback((path: string, metadata: BlogRouteState) => {
    if (path !== location.pathname) return
    setRoute(previous => previous.key === location.key && previous.client === client ? { ...previous, metadata } : previous)
  }, [location.key, location.pathname, client])
  const value = useMemo<BlogContext>(() => ({ enabled: Boolean(client), client, routeKey: location.key, pathname: location.pathname,
    metadata: route.key === location.key && route.client === client ? route.metadata : { status: 'loading' }, publishMetadata,
  }), [client, location.key, location.pathname, route, publishMetadata])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export const usePublicBlogIntegration = () => useContext(Context)

function useRequest<T>(load: (signal: AbortSignal) => Promise<T>, active: boolean, routeKey: string,
  publish: (state: BlogLoadState<T>) => void, empty: (value: T) => boolean) {
  const [snapshot, setSnapshot] = useState<{ routeKey: string; load: typeof load; revision: number; state: BlogLoadState<T> }>()
  const [revision, setRevision] = useState(0)
  const sequence = useRef(0)
  const revalidate = useCallback(() => { publish({ status: 'loading' }); setRevision(value => value + 1) }, [publish])
  useEffect(() => {
    if (!active) return
    const current = ++sequence.current, controller = new AbortController()
    const update = (next: BlogLoadState<T>) => {
      if (!controller.signal.aborted && current === sequence.current) { setSnapshot({ routeKey, load, revision, state: next }); publish(next) }
    }
    update({ status: 'loading' })
    void load(controller.signal).then(data => update({ status: empty(data) ? 'empty' : 'ready', data })).catch(error => {
      update({ status: error instanceof PublicBlogError ? error.kind : 'unavailable' })
    })
    return () => controller.abort()
  }, [active, load, routeKey, revision, publish, empty])
  const state: BlogLoadState<T> = !active ? { status: 'idle' }
    : snapshot?.routeKey === routeKey && snapshot.load === load && snapshot.revision === revision ? snapshot.state : { status: 'loading' }
  return { state, revalidate }
}
const listEmpty = (response: BlogListResponse) => !response.data.length
const neverEmpty = () => false
export function usePublicBlogList(input: BlogListInput, scope: 'listing' | 'preview' | 'related' = 'listing') {
  const { client, pathname, routeKey, publishMetadata } = usePublicBlogIntegration()
  const { page, pageSize } = input
  const load = useCallback((signal: AbortSignal) => {
    if (!client) return Promise.reject(new PublicBlogError('unavailable'))
    return client.list({ page, pageSize }, signal)
  }, [client, page, pageSize])
  const publish = useCallback((state: BlogLoadState<BlogListResponse>) => {
    if (scope === 'listing') publishMetadata('/blogs', { status: state.status })
  }, [scope, publishMetadata])
  return useRequest(load, Boolean(client) && (scope === 'listing' ? pathname === '/blogs' : scope === 'preview' ? pathname === '/' : pathname.startsWith('/blogs/')), routeKey, publish, listEmpty)
}
export function usePublicBlogArticle(slug: string) {
  const { client, pathname, routeKey, publishMetadata } = usePublicBlogIntegration()
  let currentSlug = ''
  try { if (/^\/blogs\/[^/]+$/.test(pathname)) currentSlug = decodeURIComponent(pathname.slice(7)) } catch { /* Invalid path never becomes a canonical. */ }
  const load = useCallback(async (signal: AbortSignal) => {
    if (!client) throw new PublicBlogError('unavailable')
    return (await client.getBySlug(slug, signal)).data
  }, [client, slug])
  const publish = useCallback((state: BlogLoadState<BlogArticle>) => publishMetadata(pathname, state), [pathname, publishMetadata])
  return useRequest(load, Boolean(client) && pathname.startsWith('/blogs/') && (currentSlug === slug || !currentSlug), routeKey, publish, neverEmpty)
}
