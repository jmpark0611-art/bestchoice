import { File, Share } from '@apps-in-toss/web-framework';
import { Button, useToast } from '@toss/tds-mobile';
import { useState } from 'react';
import type { Analysis } from '../lib/contract';
import { logEvent } from '../lib/analytics';
import { createResultImage, dataUrlBase64, RESULT_IMAGE_MIME } from '../lib/resultImage';
import { Card, Gap } from './ui';

const APP_LINK = 'intoss://bestchoice';

export function ResultShareActions({ analysis }: { analysis: Analysis }) {
  const { openToast } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | 'link' | null>(null);
  const canSave = File.saveBase64.isSupported();
  const canShareLink = typeof Share.createLink === 'function' && typeof Share.sendMessage === 'function';

  const makePreview = async () => {
    setBusy('preview');
    try {
      setPreview(await createResultImage(analysis));
    } catch {
      openToast('이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!preview) return;
    setBusy('save');
    try {
      await File.saveBase64({
        data: dataUrlBase64(preview),
        fileName: `결정해지니-결과-${new Date().toISOString().slice(0, 10)}.jpg`,
        mimeType: RESULT_IMAGE_MIME,
      });
      logEvent('result_image_saved');
      openToast('저장하거나 공유할 앱을 선택해 주세요.');
      setPreview(null);
    } catch {
      openToast('이미지를 저장하지 못했어요. 토스 앱을 업데이트한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  const shareLink = async () => {
    setBusy('link');
    try {
      const link = await Share.createLink({ path: APP_LINK });
      await Share.sendMessage({ message: `결정이 어려울 땐 결정해지니Genie에서 6가지 기준으로 정리해 보세요.\n${link}` });
      logEvent('app_link_shared');
    } catch {
      openToast('앱 링크를 공유하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  if (!canSave && !canShareLink) return null;

  return (
    <section className="result-share" aria-label="결과 공유">
      <Card title="결과 간직하기">
        <p className="muted small">고민 원문과 메모는 이미지에 넣지 않아요.</p>
        {preview ? (
          <div className="result-preview" role="dialog" aria-label="공유 이미지 미리보기" aria-modal="false">
            <img src={preview} alt="결정해지니 분석 결과 카드 미리보기" />
            <p className="preview-confirm">이 이미지로 저장할까요?</p>
            <Button display="block" loading={busy === 'save'} disabled={busy !== null} onClick={save}>
              이 이미지 저장
            </Button>
            <Gap size={8} />
            <Button display="block" variant="weak" disabled={busy !== null} onClick={() => setPreview(null)}>
              취소
            </Button>
          </div>
        ) : (
          <div className="share-actions">
            {canSave && (
              <Button display="block" loading={busy === 'preview'} disabled={busy !== null} onClick={makePreview}>
                이미지 저장
              </Button>
            )}
            {canShareLink && (
              <Button display="block" variant="weak" loading={busy === 'link'} disabled={busy !== null} onClick={shareLink}>
                앱 링크 공유
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
