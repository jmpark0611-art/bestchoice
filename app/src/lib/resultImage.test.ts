import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysis } from '../test/fixtures';
import { AXIS_LABELS, recommendationLabel } from './contract';
import { createResultImage, dataUrlBase64, RESULT_IMAGE_HEIGHT, RESULT_IMAGE_WIDTH } from './resultImage';

describe('createResultImage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('앱 이름, 추천 결과, 6가지 기준만 담은 JPEG 카드를 만든다', async () => {
    const written: string[] = [];
    const gradient = { addColorStop: vi.fn() };
    const context = {
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      arc: vi.fn(),
      createLinearGradient: vi.fn(() => gradient),
      fillText: vi.fn((text: string) => written.push(text)),
      measureText: vi.fn((text: string) => ({ width: text.length * 30 })),
      set fillStyle(_: string | CanvasGradient) {},
      set font(_: string) {},
      set textBaseline(_: CanvasTextBaseline) {},
      set textAlign(_: CanvasTextAlign) {},
      set shadowColor(_: string) {},
      set shadowBlur(_: number) {},
      set shadowOffsetY(_: number) {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(context);
    vi.spyOn(canvas, 'toDataURL').mockReturnValue('data:image/jpeg;base64,abc123');
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);

    const result = await createResultImage(analysis);

    expect(canvas.width).toBe(RESULT_IMAGE_WIDTH);
    expect(canvas.height).toBe(RESULT_IMAGE_HEIGHT);
    expect(result).toBe('data:image/jpeg;base64,abc123');
    expect(written).toContain('✨ 결정해지니Genie');
    expect(written).toContain(recommendationLabel(analysis));
    for (const label of Object.values(AXIS_LABELS)) expect(written).toContain(label);
    expect(written.join(' ')).not.toContain('고민 원문');
    expect(written.join(' ')).not.toContain('선택 메모');
  });

  it('File.saveBase64에 전달할 순수 base64를 분리한다', () => {
    expect(dataUrlBase64('data:image/jpeg;base64,abc123')).toBe('abc123');
    expect(() => dataUrlBase64('abc123')).toThrow('INVALID_DATA_URL');
  });
});
