import {Capacitor} from '@capacitor/core';
import {publicShareOrigin,voteUrl} from './shareUrl';
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:vi.fn(()=>false)}}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('retains browser origin',()=>{vi.stubEnv('VITE_PUBLIC_APP_URL','');expect(voteUrl('a/b')).toBe(window.location.origin+'/v/a%2Fb');});
it('blocks unconfigured native share',()=>{vi.stubEnv('VITE_PUBLIC_APP_URL','');vi.mocked(Capacitor.isNativePlatform).mockReturnValueOnce(true);expect(publicShareOrigin()).toBeNull();});
it.each(['http://example.com','https://localhost','https://127.0.0.1','https://test.invalid','https://example.com/path','https://user@example.com'])('rejects unsafe %s',url=>{vi.stubEnv('VITE_PUBLIC_APP_URL',url);expect(publicShareOrigin()).toBeNull();});
it('accepts explicit public HTTPS origin',()=>{vi.stubEnv('VITE_PUBLIC_APP_URL','https://example.com');expect(voteUrl('abc')).toBe('https://example.com/v/abc');});
