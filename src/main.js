// 주소 뒤 # 부분에 숨긴 글씨가 들어 있으면 깨기 화면, 없으면 작성 화면.
// (# 뒤는 서버로 보내지지 않으므로 글씨가 서버 기록에 남지 않는다)
import { decode } from './share.js';

const code = location.hash.slice(1);
const data = decode(code);

window.addEventListener('hashchange', () => location.reload());

if (data) {
  document.body.classList.add('mode-play');
  import('./play.js').then((m) => m.startPlay(data));
} else {
  document.body.classList.add('mode-compose');
  if (code) document.getElementById('notice').hidden = false;
  import('./compose.js').then((m) => m.startCompose());
}
