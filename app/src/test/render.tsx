import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

export function renderAt(path: string, routePath: string, element: ReactElement) {
  return render(
    <TDSMobileAITProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="*" element={<div>other-page</div>} />
        </Routes>
      </MemoryRouter>
    </TDSMobileAITProvider>,
  );
}
