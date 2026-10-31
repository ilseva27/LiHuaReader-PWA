import subprocess,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
chars=''.join(chr(i)+'\n' for i in range(0x3400,0xA000))
parts=[]
for ident in ['Hans-Hant','Hant-Hans']:
 out=subprocess.run(['uconv','-x',ident],input=chars,text=True,capture_output=True,check=True).stdout.splitlines()
 assert len(out)==0xA000-0x3400
 pairs=[(chr(i),target) for i,target in zip(range(0x3400,0xA000),out) if chr(i)!=target]
 parts.append((''.join(a for a,b in pairs),''.join(b for a,b in pairs)))
S2T=[('头发','頭髮'),('发展','發展'),('发现','發現'),('里面','裡面'),('里面','裡面'),('面条','麵條'),('干净','乾淨'),('干杯','乾杯'),('干燥','乾燥'),('皇后','皇后'),('后来','後來'),('背后','背後'),('头发','頭髮'),('理发','理髮'),('理发店','理髮店'),('面包','麵包'),('方便面','方便麵'),('干什么','幹什麼'),('一只','一隻'),('只要','只要'),('手机','手機'),('鼠标','滑鼠'),('计算机','電腦'),('程序','程式'),('软件','軟體'),('网络','網路'),('出租车','計程車'),('公交车','公車'),('视频','影片'),('里面','裡面'),('准备','準備'),('准时','準時'),('标准','標準'),('之后','之後'),('以后','以後'),('最后','最後'),('身后','身後'),('后悔','後悔'),('后天','後天'),('后面','後面'),('这里','這裡'),('那里','那裡'),('哪里','哪裡'),('干嘛','幹嘛'),('干活','幹活')]
T2S=[('頭髮','头发'),('發展','发展'),('發現','发现'),('裡面','里面'),('裏面','里面'),('麵條','面条'),('乾淨','干净'),('乾杯','干杯'),('乾燥','干燥'),('皇后','皇后'),('後來','后来'),('背後','背后'),('理髮','理发'),('麵包','面包'),('方便麵','方便面'),('幹什麼','干什么'),('一隻','一只'),('只要','只要'),('手機','手机'),('滑鼠','鼠标'),('電腦','电脑'),('程式','程序'),('軟體','软件'),('網路','网络'),('計程車','出租车'),('公車','公交车'),('影片','视频'),('準備','准备'),('準時','准时'),('標準','标准'),('之後','之后'),('以後','以后'),('最後','最后'),('身後','身后'),('後悔','后悔'),('後天','后天'),('後面','后面'),('這裡','这里'),('那裡','那里'),('哪裡','哪里'),('幹嘛','干嘛'),('幹活','干活')]
JS='''// Generated from ICU Han conversion data. Character mapping plus common phrase disambiguation.
// Does not perfectly replicate OpenCC regional/phrase-aware dictionaries.
const CHAR_KEYS = [%s,%s];
const CHAR_VALS = [%s,%s];
const PHRASES = [%s,%s];
const MAPS = CHAR_KEYS.map((keys, i) => new Map([...keys].map((k, j) => [k, [...CHAR_VALS[i]][j]])));
const PHRASE_MAP = PHRASES.map(entries => entries.sort((a,b) => b[0].length - a[0].length));
export function convertChinese(input, target = 'original') {
  if (target === 'original' || !input) return String(input || '');
  const direction = target === 'traditional' ? 0 : 1;
  const dict = MAPS[direction]; const phrases = PHRASE_MAP[direction];
  let out = '';
  for (let i = 0; i < input.length;) {
    let match = null;
    for (const [from, to] of phrases) { if (input.startsWith(from,i)) { match = [from,to]; break; } }
    if (match) {out += match[1]; i += match[0].length; continue;}
    const char = String.fromCodePoint(input.codePointAt(i));
    out += dict.get(char) || char; i += char.length;
  }
  return out;
}
'''%(json.dumps(parts[0][0],ensure_ascii=False),json.dumps(parts[1][0],ensure_ascii=False),json.dumps(parts[0][1],ensure_ascii=False),json.dumps(parts[1][1],ensure_ascii=False),json.dumps(S2T,ensure_ascii=False),json.dumps(T2S,ensure_ascii=False))
(root/'converter.js').write_text(JS,encoding='utf-8')
print('converter',len(JS),'chars')
