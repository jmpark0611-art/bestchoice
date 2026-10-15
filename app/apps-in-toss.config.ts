import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 콘솔에 등록된 appName. 대소문자까지 정확히 일치해야 함.
  appName: 'bestchoice',
  brand: {
    primaryColor: '#3182F6',
  },
  permissions: [],
  webBundleDir: 'dist',
});
