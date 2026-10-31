from pathlib import Path
from playwright.sync_api import sync_playwright
base=Path(__file__).resolve().parents[1]
html=(base/'index.html').read_text().replace('<script src="./vendor/jszip.min.js"></script>','').replace('<script type="module" src="./app.js"></script>','')
css=(base/'styles.css').read_text()
app=(base/'app.js').read_text()
app=app.replace("import {openLibrary,listBooks,getBook,getChapter,getPosition,savePosition,updateBookOpen,removeBook,storeParsedBook,parseBookFile,exportLibrary,restoreLibrary} from './library.js';",'')
app=app.replace("import {convertChinese} from './converter.js';", "const convertChinese=(text,script)=>text;")
app=app.replace('initialize();','')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
 for mode in ['horizontal','vertical']:
  page=b.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
  page.on('pageerror',lambda e: print('ERROR',e))
  page.set_content(html.replace('</head>',f'<style>{css}</style></head>'))
  page.add_script_tag(content='''Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{}}});''')
  page.add_script_tag(content=app)
  info=page.evaluate('''async (direction) => {
   settings.direction=direction;state.book={id:'test',title:'示範測試小說',chapterCount:2};
   state.chapter={title:'第一章 新的故事',text:'夜色漸深，街道上的人潮終於散去。窗邊那盞小小的燈，卻仍然亮著。\\n\\n她坐在書桌前，手裡握著一封許久未曾拆開的信。信封的邊角已經泛黃，字跡卻清晰如初。\\n\\n「原來你一直記得。」她低聲說。\\n\\n窗外，晚風輕輕吹過樹梢，帶來雨後清新的氣息。她翻開信紙，開始讀那個被時間收藏的故事。\\n\\n有些相遇，並不需要轟轟烈烈；只是某個平凡的午後，兩個人恰好走在同一條路上。\\n\\n她想起那一天，陽光暖暖地落在石階上，像今天這封信一樣溫柔。'};
   document.getElementById('shelfView').hidden=true;
   document.getElementById('readerView').hidden=false;
   updateReadStyles();await repaginate(0);syncReaderControls();
   const x=document.getElementById('pageBody');
   return {pages:state.pages.length, items:state.pages.map(p=>p.items.map(x=>x.text.length)), first:state.pages[0].items[0].text, scrollW:x.scrollWidth,clientW:x.clientWidth,scrollH:x.scrollHeight,clientH:x.clientHeight};
  }''',mode)
  print(mode,info)
  page.screenshot(path='/mnt/data/lihua_'+mode+'_test.png')
  page.close()
 b.close()
