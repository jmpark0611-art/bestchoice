import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analysis } from '../test/fixtures';
import { renderAt } from '../test/render';
import { ResultShareActions } from './ResultShareActions';

const sdk = vi.hoisted(() => ({
  saveBase64: Object.assign(vi.fn(), { isSupported: vi.fn(() => true) }),
  createLink: vi.fn(),
  sendMessage: vi.fn(),
}));
vi.mock('@apps-in-toss/web-framework', () => ({
  File: { saveBase64: sdk.saveBase64 },
  Share: { createLink: sdk.createLink, sendMessage: sdk.sendMessage },
}));
const image = vi.hoisted(() => ({ createResultImage: vi.fn() }));
vi.mock('../lib/resultImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/resultImage')>()),
  createResultImage: image.createResultImage,
}));
const analytics = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('../lib/analytics', () => analytics);

beforeEach(() => {
  vi.clearAllMocks();
  sdk.saveBase64.isSupported.mockReturnValue(true);
  sdk.createLink.mockResolvedValue('https://toss.im/_ul/test');
  sdk.sendMessage.mockResolvedValue(undefined);
  image.createResultImage.mockResolvedValue('data:image/jpeg;base64,preview123');
});

describe('ResultShareActions', () => {
  it('미리보기를 확인하기 전에는 파일을 저장하지 않는다', async () => {
    const user = userEvent.setup();
    renderAt('/', '/', <ResultShareActions analysis={analysis} />);

    await user.click(screen.getByRole('button', { name: '이미지 저장' }));
    expect(await screen.findByRole('dialog', { name: '공유 이미지 미리보기' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,preview123');
    expect(sdk.saveBase64).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '이 이미지 저장' }));
    await waitFor(() =>
      expect(sdk.saveBase64).toHaveBeenCalledWith(
        expect.objectContaining({ data: 'preview123', mimeType: 'image/jpeg', fileName: expect.stringMatching(/\.jpg$/) }),
      ),
    );
    expect(analytics.logEvent).toHaveBeenCalledWith('result_image_saved');
  });

  it('개인 결과 주소가 아닌 앱 홈 링크를 별도 버튼으로 공유한다', async () => {
    const user = userEvent.setup();
    renderAt('/', '/', <ResultShareActions analysis={analysis} />);

    await user.click(screen.getByRole('button', { name: '앱 링크 공유' }));
    await waitFor(() => expect(sdk.createLink).toHaveBeenCalledWith({ path: 'intoss://bestchoice' }));
    expect(sdk.sendMessage).toHaveBeenCalledWith({ message: expect.stringContaining('https://toss.im/_ul/test') });
    expect(analytics.logEvent).toHaveBeenCalledWith('app_link_shared');
  });

  it('File.saveBase64 미지원 환경에서는 이미지 저장 버튼을 숨긴다', () => {
    sdk.saveBase64.isSupported.mockReturnValue(false);
    renderAt('/', '/', <ResultShareActions analysis={analysis} />);
    expect(screen.queryByRole('button', { name: '이미지 저장' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '앱 링크 공유' })).toBeInTheDocument();
  });
});
