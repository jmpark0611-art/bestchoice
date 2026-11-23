import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // 글꼴 조각(작은 woff2 수십 개)이 CSS에 base64로 들어가면 첫 화면이 느려진다. 파일로 두고 쓰인 글자만 받게 한다
  build: { assetsInlineLimit: 0 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});

