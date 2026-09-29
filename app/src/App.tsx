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

export function AppRoutes() {
  useNativeBack();
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      {/* 콘솔 주요 기능 딥링크: intoss://Bestchoice/input, intoss://Bestchoice/history */}
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
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const start = useCallback(() => {
    setState('loading');
    ensureSession()
      .then(() => setState('ready'))
      .catch(() => setState('error'));
  }, []);
  useEffect(start, [start]);

  if (state === 'loading') return <LoadingView message="준비하고 있어요" />;
  if (state === 'error') return <ErrorView code="NETWORK" onRetry={start} />;
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
