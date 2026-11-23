import { Link } from 'react-router-dom';
import { Brand, Screen } from '../components/ui';
import { SHARED_CONTENT_RULES } from '../lib/contentPolicy';

export function ContentPolicyScreen() {
  return <Screen>
    <Brand />
    <h2>공유 콘텐츠 이용정책</h2>
    <p>친구에게 질문을 공유할 때는 아래 정책에 동의해 주세요. 개인적인 결정 요청과 공유는 각각 선택할 수 있어요.</p>
    <h3>공유할 수 없는 내용</h3>
    <ul className="help">{SHARED_CONTENT_RULES.map(rule => <li key={rule}>{rule}</li>)}</ul>
    <h3>질문 신고와 작성자 차단</h3>
    <p>공유 질문의 선택지나 상황에 문제가 있으면 투표하기 전에도 ‘질문 신고’에서 사유와 보낼 내용을 확인하고 신고할 수 있어요. AI 답변의 문제는 투표 후 ‘AI 답변 신고’로 알려 주세요.</p>
    <p>‘이 작성자 차단’을 선택하면 현재 익명 세션에서 그 작성자의 공유 질문을 숨겨요. 같은 링크에서 차단을 해제하거나 이용 안내에서 작성자 차단을 모두 해제할 수 있어요. 다른 기기나 새 익명 세션에는 차단이 이어지지 않을 수 있어요.</p>
    <h3>신고 처리</h3>
    <p>신고 사유·설명과 대상 질문의 식별 정보는 운영자가 문제를 확인하는 데 사용해요. 서버 접수 번호가 표시되어야 접수가 확인된 것이에요. 기기에만 저장한 회고와 다른 초안은 신고에 포함하지 않아요.</p>
    <p>운영자는 신고와 정책 위반을 검토해 공유 중단, 질문 삭제 또는 이용 제한 등의 조치를 할 수 있어요. 신고만으로 위반이 확정되거나 자동 삭제되지는 않아요.</p>
    <p className="small">운영: 에스제이컴퍼니 · 대표 박지민 · 문의 jmpark0611@gmail.com</p>
    <Link to="/about">이용 안내와 기록 관리</Link>
    <Link to="/" className="btn ghost">홈으로</Link>
  </Screen>;
}
