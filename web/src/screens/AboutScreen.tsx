import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Screen } from '../components/ui';
import { clearDecisionReflections, reflectionErrorMessage } from '../lib/decisionReflections';
import { resetDefaultCriterion } from '../lib/decisionPreferences';
import { clearQuestionAuthorBlocks } from '../lib/api';
import { codeOf, errorMessage } from '../lib/errors';
import {
  clearDecisionDrafts, clearReflectionDrafts, draftErrorMessage,
  getDraftAutosaveEnabled, setDraftAutosaveEnabled,
} from '../lib/decisionDrafts';

/** 지인 시험용 웹 버전의 이용 안내. 정식 출시 전에 개인정보처리방침·이용약관 전문으로 바꾼다 */
export function AboutScreen() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftSetting, setDraftSetting] = useState(() => getDraftAutosaveEnabled());
  const [clearingBlocks, setClearingBlocks] = useState(false);
  const blockClearPending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const clearBlocks = async () => {
    if (blockClearPending.current || !window.confirm('현재 익명 세션에서 차단한 작성자를 모두 해제할까요? 해당 작성자의 공유 질문을 다시 볼 수 있어요.')) return;
    blockClearPending.current = true;setClearingBlocks(true);setNotice(null);setError(null);
    try {
      await clearQuestionAuthorBlocks();
      if (active.current) setNotice('작성자 차단을 모두 해제했어요.');
    } catch (cause) { if (active.current) setError(errorMessage(codeOf(cause))); }
    finally { blockClearPending.current = false;if (active.current) setClearingBlocks(false); }
  };
  const clearReflections = () => {
    if (!window.confirm('이 기기에 저장한 만족도와 회고, 작성 중인 회고 초안을 모두 지울까요? 되돌릴 수 없어요.')) return;
    const result = clearDecisionReflections();
    const drafts = clearReflectionDrafts();
    setNotice(null); setError(null);
    if (result.ok && drafts.ok) setNotice('이 기기의 회고와 회고 초안을 모두 지웠어요.');
    else setError([
      result.ok ? '저장한 회고는 지웠어요.' : reflectionErrorMessage(result.error),
      drafts.ok ? '회고 초안은 지웠어요.' : `회고 초안 삭제를 확인하지 못했어요. ${draftErrorMessage(drafts.error)}`,
    ].join(' '));
  };
  const changeAutosave = (enabled: boolean) => {
    if (!enabled && !window.confirm('초안 자동 저장을 끄고 이 기기의 결정·회고 초안을 모두 지울까요? 이미 저장한 회고와 서버 결정은 그대로예요.')) return;
    setNotice(null); setError(null);
    const result = setDraftAutosaveEnabled(enabled);
    if (!result.ok) { setError(draftErrorMessage(result.error)); return; }
    setDraftSetting({ ok: true, value: enabled });
    setNotice(enabled ? '다음에 입력하는 내용부터 초안을 자동 저장해요.' : '초안 자동 저장을 끄고 이 기기의 초안을 지웠어요.');
  };
  const clearDrafts = () => {
    if (!window.confirm('이 기기의 결정·회고 초안을 모두 지울까요? 이미 저장한 회고와 서버 결정은 그대로예요.')) return;
    setNotice(null); setError(null);
    const result = clearDecisionDrafts();
    if (!result.ok) { setError(draftErrorMessage(result.error)); return; }
    setDraftSetting(getDraftAutosaveEnabled());
    setNotice('이 기기의 초안을 모두 지웠어요.');
  };
  const clearPreference = () => {
    const result = resetDefaultCriterion();
    setNotice(null); setError(null);
    if (result.ok) setNotice('기본 기준을 지웠어요.');
    else setError('기본 기준을 지우지 못했어요. 기기의 저장 공간 설정을 확인해 주세요.');
  };
  return (
    <Screen>
      <Brand />
      <h2 id="about-title">이용 안내</h2>
      <section className="legal-entry" aria-labelledby="legal-entry-title">
        <h3 id="legal-entry-title">개인정보와 삭제 안내</h3>
        <p>어떤 정보가 남는지, 직접 지우려면 어떻게 하는지 확인하세요.</p>
        <nav className="legal-links" aria-label="개인정보와 삭제 안내">
          <Link to="/privacy" className="btn ghost">개인정보처리방침</Link>
          <Link to="/delete-data" className="btn ghost">데이터 삭제 안내</Link>
        </nav>
      </section>
      <ul className="help">
        <li>적은 두 선택지, 고른 기준과 상황 한 줄은 결론을 만들기 위해 외부 AI 서비스(OpenAI)로 전송돼요. 빠른 결정에서는 상황 한 줄을 생략해요.</li>
        <li>이름, 연락처, 계좌·건강 정보 같은 민감한 개인정보는 적지 마세요.</li>
        <li>투표 링크를 받은 사람은 두 선택지, 기준과 상황 한 줄을 볼 수 있어요. AI의 선택과 투표 수는 투표한 뒤에 보여요. 누가 어디에 투표했는지는 저장하지만 이름은 수집하지 않아요.</li>
        <li>결론은 판단을 돕는 참고용이에요. 의료·법률·투자처럼 중요한 결정은 전문가와 확인하세요.</li>
        <li>결정 기록은 만든 날부터 달력 기준 2개월이 지난 뒤 매일 한국시간 03:10의 정기 정리 작업에서 삭제돼요.</li>
        <li>AI 결과에 문제가 있으면 결과 화면의 ‘AI 답변 신고’에서 이유와 보낼 내용을 확인할 수 있어요. 접수할 때에는 해당 결정의 식별자와 신고 사유·설명이 전달돼요. 운영자는 문제를 확인하기 위해 해당 결정의 선택지·상황·AI 결과를 볼 수 있어요. 서버가 접수 번호를 돌려준 경우에만 접수 완료로 안내해요.</li>
        <li>공유 질문은 ‘질문 신고’로 신고하고 ‘이 작성자 차단’으로 숨길 수 있어요. 차단하면 현재 이용 상태에서 해당 작성자의 공유 질문을 숨기는 방식이에요. 다른 기기나 새 이용 상태에는 이어지지 않을 수 있어요. 완료 안내가 표시됐는지 확인해 주세요.</li>
        <li>운영: 에스제이컴퍼니 · 대표 박지민 · 문의 jmpark0611@gmail.com</li>
      </ul>
      <Link to="/content-policy">공유 콘텐츠 이용정책</Link>
      <section className="sharebox" aria-label="공유 질문 차단 관리">
        <h3>차단한 작성자</h3>
        <p className="small">차단한 질문의 링크에서 한 명씩, 여기에서는 모두 해제를 요청할 수 있어요. 해제 완료 안내를 확인하세요. 질문·투표·신고 기록을 지우는 기능은 아니에요.</p>
        <button type="button" className="btn ghost" disabled={clearingBlocks} onClick={() => void clearBlocks()}>
          {clearingBlocks ? '차단 해제 중…' : '작성자 차단 모두 해제'}
        </button>
      </section>
      <section className="sharebox" aria-label="이 기기의 기록 관리">
        <h3>이 기기에 저장하는 내용</h3>
        <p className="small">기본 기준은 직접 저장할 때만 기억해요. 다음 결정에서 미리 선택되며 언제든 바꿀 수 있어요.</p>
        <p className="small">만족도와 회고는 기기의 앱·브라우저 저장 공간에서 관리해요. 앱 서버·친구·AI에게 보내거나, 회고로 취향을 자동 추정하지 않아요. 앱에서 기기 간 동기화를 제공하지 않으며 앱·브라우저 데이터를 지우면 사라질 수 있어요.</p>
        <p className="small">회고는 최근 100개까지, 마지막 저장일부터 60일 동안 표시해요. 기간이 지난 회고는 앱에서 회고를 확인하거나 저장할 때 정리해요.</p>
        <h3>입력 중인 초안</h3>
        <p className="small">초안 자동 저장은 기본으로 켜져 있어요. 입력 중인 결정 1개와 실제 선택별 회고 초안 최대 25개를 이 기기에 보관해요. 다시 열면 이어쓰기·버리기를 직접 선택하며, 복원만으로 AI에게 요청하거나 서버에 회고를 보내지 않아요.</p>
        <p className="small">마지막 수정 후 24시간 동안 이어 쓸 수 있어요. 기간이 지난 초안은 다음에 앱에서 초안을 확인하거나 저장할 때 정리해요. 자동 저장을 끄면 이 기기의 초안을 함께 지워요.</p>
        {draftSetting.ok ? <label className="setting-toggle">
          <input type="checkbox" checked={draftSetting.value} onChange={event => changeAutosave(event.target.checked)} />
          <span>초안 자동 저장</span>
        </label> : <div>
          <p className="error" role="alert">{draftErrorMessage(draftSetting.error)}</p>
          <button type="button" className="btn ghost" onClick={() => changeAutosave(false)}>초안 자동 저장 끄고 초기화</button>
        </div>}
        <button type="button" className="btn ghost" onClick={clearDrafts}>이 기기의 초안 모두 지우기</button>
        <button type="button" className="btn ghost" onClick={clearPreference}>기본 기준 지우기</button>
        <button type="button" className="btn ghost" onClick={clearReflections}>이 기기의 회고 모두 지우기</button>
        {notice && <p className="small" role="status">{notice}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <div className="grow" />
      <Link to="/" className="btn ghost">
        돌아가기
      </Link>
    </Screen>
  );
}

