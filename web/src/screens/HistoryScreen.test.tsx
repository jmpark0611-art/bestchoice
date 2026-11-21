import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {HistoryScreen} from './HistoryScreen';
import {listDecisionHistory,deleteDecision} from '../lib/api';
vi.mock('../lib/api',()=>({listDecisionHistory:vi.fn(),deleteDecision:vi.fn()}));
const row={id:'1',a:'커피',b:'차',pick:'a' as const,did:'b' as const,createdAt:'2026-11-17'};
const mount=()=>render(<MemoryRouter><HistoryScreen/></MemoryRouter>);
beforeEach(()=>{vi.clearAllMocks();vi.mocked(listDecisionHistory).mockResolvedValue([row]);vi.mocked(deleteDecision).mockResolvedValue();});
afterEach(()=>vi.restoreAllMocks());
it('searches loaded records and compares actual selection',async()=>{mount();await screen.findByText('AI와 다른 선택');expect(screen.getByText('지금 불러온 1건 안에서 검색해요.')).toBeInTheDocument();fireEvent.change(screen.getByLabelText('기록 검색'),{target:{value:'없는말'}});expect(screen.getByText('표시할 기록이 없어요.')).toBeInTheDocument();});
it('cancel never deletes; confirmation deletes',async()=>{mount();await screen.findByText('AI와 다른 선택');const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:'커피 vs 차 삭제'}));expect(deleteDecision).not.toHaveBeenCalled();confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'커피 vs 차 삭제'}));await waitFor(()=>expect(screen.queryByText('AI와 다른 선택')).not.toBeInTheDocument());expect(deleteDecision).toHaveBeenCalledTimes(1);});
it('locks repeated deletion and preserves record on failure',async()=>{let reject!:(e:Error)=>void;vi.mocked(deleteDecision).mockImplementation(()=>new Promise((_r,j)=>{reject=j;}));vi.spyOn(window,'confirm').mockReturnValue(true);mount();await screen.findByText('AI와 다른 선택');const button=screen.getByRole('button',{name:'커피 vs 차 삭제'});fireEvent.click(button);fireEvent.click(button);expect(deleteDecision).toHaveBeenCalledTimes(1);reject(new Error('network'));await screen.findByRole('alert');expect(screen.getByText('AI와 다른 선택')).toBeInTheDocument();});
it('loads previous records and filters pending',async()=>{vi.mocked(listDecisionHistory).mockResolvedValueOnce(Array.from({length:30},(_,i)=>({...row,id:String(i)}))).mockResolvedValueOnce([{...row,id:'31',did:null}]);mount();await screen.findByText('지금 불러온 30건 안에서 검색해요.');fireEvent.click(screen.getByText('이전 기록 더 보기'));await screen.findByText('지금 불러온 31건 안에서 검색해요.');expect(listDecisionHistory).toHaveBeenLastCalledWith(30,30);fireEvent.change(screen.getByLabelText('실제 선택 필터'),{target:{value:'pending'}});expect(screen.getAllByText('실제 선택: 아직 고민 중')).toHaveLength(1);});
it('ignores an old list after leaving and returning to history',async()=>{
 let resolve!:(r:typeof row[])=>void;vi.mocked(listDecisionHistory).mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce([{...row,id:'new',a:'새 기록'}]);
 const first=mount();first.unmount();mount();await screen.findByText('새 기록 vs 차');
 resolve([row]);await waitFor(()=>expect(screen.getByText('새 기록 vs 차')).toBeInTheDocument());expect(screen.queryByText('커피 vs 차')).not.toBeInTheDocument();
});
