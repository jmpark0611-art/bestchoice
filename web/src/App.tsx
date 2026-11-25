import { HistoryScreen } from './screens/HistoryScreen';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AboutScreen } from './screens/AboutScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PollScreen } from './screens/PollScreen';
import { VoteScreen } from './screens/VoteScreen';
import { ContentPolicyScreen } from './screens/ContentPolicyScreen';
import { LegalInfoScreen } from './screens/LegalInfoScreen';

export function App() {
  return (
    <Routes>
      <Route path="/history" element={<HistoryScreen />} />
      <Route path="/" element={<HomeScreen />} />
      {/* /p/:id 는 내가 만든 결정, /v/:code 는 친구가 받는 투표 링크 */}
      <Route path="/p/:id" element={<PollScreen />} />
      <Route path="/v/:code" element={<VoteScreen />} />
      <Route path="/about" element={<AboutScreen />} />
      <Route path="/privacy" element={<LegalInfoScreen document="privacy" />} />
      <Route path="/delete-data" element={<LegalInfoScreen document="deletion" />} />
      <Route path="/content-policy" element={<ContentPolicyScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

