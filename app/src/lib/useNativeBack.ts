import { graniteEvent, Screen } from '@apps-in-toss/web-framework';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * 토스 앱의 시스템 뒤로가기를 앱 내부 라우팅에 연결.
 * - 앱 안에서 이동한 기록이 있으면 이전 화면으로
 * - 첫 화면(딥링크 진입 포함)이면 미니앱 닫기
 * 토스 앱 밖(일반 브라우저)에서는 브리지가 없어 구독이 실패하므로 무시한다.
 */
export function useNativeBack() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = graniteEvent.addEventListener('backEvent', {
        onEvent: () => {
          const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
          if (idx > 0) navigate(-1);
          else void Screen.close();
        },
        onError: () => {},
      });
    } catch {
      unsubscribe = undefined;
    }
    return () => unsubscribe?.();
  }, [navigate, location.key]);
}
