/* eslint-disable react/only-export-components -- generated wrappers; fast refresh is not needed for these */
import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';

/**
 * Pages and windows that only open after a click, loaded the first time they're needed so the
 * first visit downloads less. Each wrapper has the same name and props as the real component.
 */
function deferred<P extends object>(load: () => Promise<ComponentType<P>>, fallback: React.ReactNode = null) {
  const Lazy = lazy(async () => ({ default: await load() }));
  return function Deferred(props: P) {
    return <Suspense fallback={fallback}><Lazy {...(props as ComponentProps<typeof Lazy>)} /></Suspense>;
  };
}

const pageLoading = <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">Loading…</div>;

export const BuildsPage = deferred(() => import('./components/BuildsPage').then((m) => m.BuildsPage), pageLoading);
export const Guide = deferred(() => import('./components/Guide').then((m) => m.Guide));
export const ProfileModal = deferred(() => import('./components/ProfileModal').then((m) => m.ProfileModal));
export const ModerationModal = deferred(() => import('./components/ModerationModal').then((m) => m.ModerationModal));
export const SearchModal = deferred(() => import('./components/SearchModal').then((m) => m.SearchModal));
export const ShareBuildModal = deferred(() => import('./components/ShareBuildModal').then((m) => m.ShareBuildModal));
export const ImportModal = deferred(() => import('./components/ImportModal').then((m) => m.ImportModal));
export const AuthModal = deferred(() => import('./components/AuthModal').then((m) => m.AuthModal));
export const UnitsModal = deferred(() => import('./components/UnitsPicker').then((m) => m.UnitsModal));
export const AuthAction = deferred(() => import('./components/AuthAction').then((m) => m.default));
export const SuggestPackModal = deferred(() => import('./components/SuggestPackModal').then((m) => m.SuggestPackModal));
