import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorView, LoadingView } from './components/ui';
import { ensureSession } from './lib/supabase';
import { useNativeBack } from './lib/useNativeBack';
import { DecisionScreen } from './screens/DecisionScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { InputScreen } from './screens/InputScreen';
import { PolicyScreen } from './screens/PolicyScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function startupErrorCode(error: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'NETWORK_OFFLINE';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('VITE_SUPABASE_URL') || message.includes('VITE_SUPABASE_PUBLISHABLE_KEY')) return 'CONFIGURATION';
  if (/fetch|network|load failed|timeout/i.test(message)) return 'NETWORK';
  return 'AUTH_UNAVAILABLE';
}

export function AppRoutes() {
  useNativeBack();
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      {/* 콘솔 주요 기능 딥링크: intoss://bestchoice/input, intoss://bestchoice/history */}
      <Route path="/input" element={<InputScreen />} />
      <Route path="/history" element={<HistoryScreen />} />
      <Route path="/decision/:id" element={<DecisionScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/policy/:doc" element={<PolicyScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  const [state, setState] = useState<'loading' | 'ready' | string>('loading');
  const start = useCallback(() => {
    setState('loading');
    ensureSession()
      .then(() => setState('ready'))
      .catch((error) => setState(startupErrorCode(error)));
  }, []);
  useEffect(start, [start]);

  if (state === 'loading') return <LoadingView message="준비하고 있어요" />;
  if (state !== 'ready') return <ErrorView code={state} onRetry={start} />;
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
