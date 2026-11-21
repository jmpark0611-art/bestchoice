import {act,fireEvent,render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Routes,Route,useNavigate} from 'react-router-dom';
import {VoteScreen} from './VoteScreen';
const api=vi.hoisted(()=>({getSharedPoll:vi.fn(),vote:vi.fn()}));
vi.mock('../lib/api',()=>api);
const base={id:null,a:'선택A',b:'선택B',note:null,isOwner:false,myVote:null,shareCode:null,did:null,createdAt:'2026-11-17',pick:'a',reason:'숨길 이유',votes:{a:19,b:8}};
beforeEach(()=>vi.resetAllMocks());
it('no vote hides AI and totals even if response contains them',async()=>{
 api.getSharedPoll.mockResolvedValue(base);
 render(<MemoryRouter initialEntries={['/v/first']}><Routes><Route path='/v/:code' element={<VoteScreen/>}/></Routes></MemoryRouter>);
 await screen.findByRole('button',{name:/선택A/});
 expect(screen.queryByText('지니의 선택')).not.toBeInTheDocument();
 expect(screen.queryByText('숨길 이유')).not.toBeInTheDocument();
 expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('hides previous AI result and totals immediately when vote code changes',async()=>{
 api.getSharedPoll.mockResolvedValueOnce({...base,myVote:'a'}).mockImplementationOnce(()=>new Promise(()=>{}));
 function Next(){const nav=useNavigate();return <button onClick={()=>nav('/v/second')}>다른 투표</button>;}
 render(<MemoryRouter initialEntries={['/v/first']}><Next/><Routes><Route path='/v/:code' element={<VoteScreen/>}/></Routes></MemoryRouter>);
 await screen.findByText('지니의 선택');await userEvent.setup().click(screen.getByText('다른 투표'));
 expect(api.getSharedPoll).toHaveBeenLastCalledWith('second');
 expect(screen.queryByText('숨길 이유')).not.toBeInTheDocument();
 expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

function SwitchVote(){const nav=useNavigate();return <button onClick={()=>nav('/v/second')}>다른 투표</button>;}
function mount(){return render(<MemoryRouter initialEntries={['/v/first']}><SwitchVote/><Routes><Route path='/v/:code' element={<VoteScreen/>}/></Routes></MemoryRouter>);}
it('late load cannot replace the current vote',async()=>{
 let finish!:(v:typeof base)=>void;
 api.getSharedPoll.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValueOnce({...base,a:'새 선택'});
 mount();await userEvent.setup().click(screen.getByText('다른 투표'));await screen.findByRole('button',{name:/새 선택/});
 await act(async()=>finish(base));expect(screen.getByRole('button',{name:/새 선택/})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/선택A/})).not.toBeInTheDocument();
});
it('rapid votes send once and a late old vote cannot reveal results on another ballot',async()=>{
 let finish!:(v:object)=>void;
 api.getSharedPoll.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,a:'새 선택'});
 api.vote.mockImplementation(()=>new Promise(r=>{finish=r;}));mount();
 const button=await screen.findByRole('button',{name:/선택A/});fireEvent.click(button);fireEvent.click(button);expect(api.vote).toHaveBeenCalledTimes(1);
 await userEvent.setup().click(screen.getByText('다른 투표'));await screen.findByRole('button',{name:/새 선택/});
 await act(async()=>finish({...base,myVote:'a'}));expect(screen.queryByText('지니의 선택')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:/새 선택/})).toBeEnabled();
});
it('late old vote failure cannot show an error in another ballot',async()=>{
 let reject!:(e:Error)=>void;
 api.getSharedPoll.mockResolvedValueOnce(base).mockResolvedValueOnce({...base,a:'새 선택'});api.vote.mockImplementation(()=>new Promise((_r,j)=>{reject=j;}));mount();
 fireEvent.click(await screen.findByRole('button',{name:/선택A/}));await userEvent.setup().click(screen.getByText('다른 투표'));await screen.findByRole('button',{name:/새 선택/});
 await act(async()=>reject(new Error('old error')));expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('failed vote offers read-only recovery without an automatic second vote',async()=>{
 api.getSharedPoll.mockResolvedValueOnce({...base,pick:undefined,reason:undefined,votes:undefined}).mockResolvedValueOnce({...base,myVote:'a'});
 api.vote.mockRejectedValue({code:'TIMEOUT'});
 render(<MemoryRouter initialEntries={['/v/first']}><Routes><Route path='/v/:code' element={<VoteScreen/>}/></Routes></MemoryRouter>);
 const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:/선택A/}));
 await user.click(await screen.findByRole('button',{name:'내 투표 상태 다시 확인'}));
 await screen.findByText('지니의 선택');expect(api.vote).toHaveBeenCalledTimes(1);expect(api.getSharedPoll).toHaveBeenCalledTimes(2);
});
