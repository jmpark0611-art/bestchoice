import { AXIS_LABELS, CONFIDENCE_LABELS, recommendationLabel, type Analysis } from './contract';

export const RESULT_IMAGE_WIDTH = 1080;
export const RESULT_IMAGE_HEIGHT = 1350;
export const RESULT_IMAGE_MIME = 'image/jpeg';

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
};

const fitText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
};

/** 민감한 고민 원문과 실제 선택 메모를 받지 않고 분석 결과만 카드로 만든다. */
export async function createResultImage(analysis: Analysis): Promise<string> {
  await document.fonts?.load('64px Jua').catch(() => undefined);

  const canvas = document.createElement('canvas');
  canvas.width = RESULT_IMAGE_WIDTH;
  canvas.height = RESULT_IMAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');

  const gradient = ctx.createLinearGradient(0, 0, RESULT_IMAGE_WIDTH, RESULT_IMAGE_HEIGHT);
  gradient.addColorStop(0, '#eff6ff');
  gradient.addColorStop(0.55, '#f8fbff');
  gradient.addColorStop(1, '#fff8ef');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, RESULT_IMAGE_WIDTH, RESULT_IMAGE_HEIGHT);

  ctx.fillStyle = 'rgba(49, 130, 246, 0.12)';
  ctx.beginPath();
  ctx.arc(945, 115, 190, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#3182f6';
  roundRect(ctx, 72, 66, 300, 64, 32);
  ctx.fillStyle = '#ffffff';
  ctx.font = '36px Jua, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('✨ 결정해지니Genie', 102, 100);

  ctx.fillStyle = '#191f28';
  ctx.font = '42px Jua, sans-serif';
  ctx.fillText('결정했어요', 76, 205);
  ctx.font = '72px Jua, sans-serif';
  ctx.fillText(fitText(ctx, recommendationLabel(analysis), 920), 76, 292);

  ctx.fillStyle = '#4e5968';
  ctx.font = '34px sans-serif';
  ctx.fillText(CONFIDENCE_LABELS[analysis.confidence], 78, 370);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(33, 62, 98, 0.10)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, 60, 430, 960, 720, 40);
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = '#191f28';
  ctx.font = '42px Jua, sans-serif';
  ctx.fillText('6가지 기준', 112, 500);

  analysis.axes.forEach((axis, index) => {
    const y = 590 + index * 88;
    ctx.fillStyle = '#333d4b';
    ctx.font = '31px sans-serif';
    ctx.fillText(AXIS_LABELS[axis.key], 112, y);

    ctx.fillStyle = '#e5e8eb';
    roundRect(ctx, 380, y - 12, 470, 24, 12);
    ctx.fillStyle = '#3182f6';
    roundRect(ctx, 380, y - 12, 470 * (axis.score / 5), 24, 12);

    ctx.fillStyle = '#3182f6';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${axis.score}/5`, 936, y);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = '#6b7684';
  ctx.font = '28px sans-serif';
  ctx.fillText('AI가 정리한 판단 보조 결과예요.', 76, 1240);
  ctx.fillStyle = '#8b95a1';
  ctx.font = '25px sans-serif';
  ctx.fillText('중요한 결정은 필요한 경우 전문가와도 확인해 주세요.', 76, 1290);

  return canvas.toDataURL(RESULT_IMAGE_MIME, 0.92);
}

export function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('INVALID_DATA_URL');
  return dataUrl.slice(comma + 1);
}
