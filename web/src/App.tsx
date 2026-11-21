import { HistoryScreen } from './screens/HistoryScreen';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AboutScreen } from './screens/AboutScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PollScreen } from './screens/PollScreen';
import { VoteScreen } from './screens/VoteScreen';

export function App() {
  return (
    <Routes>
      <Route path="/history" element={<HistoryScreen />} />
      <Route path="/" element={<HomeScreen />} />
      {/* /p/:id 는 내가 만든 결정, /v/:code 는 친구가 받는 투표 링크 */}
      <Route path="/p/:id" element={<PollScreen />} />
      <Route path="/v/:code" element={<VoteScreen />} />
      <Route path="/about" element={<AboutScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

