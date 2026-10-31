import {openLibrary,listBooks,getBook,getChapter,getPosition,savePosition,updateBookOpen,removeBook,storeParsedBook,parseBookFile,exportLibrary,restoreLibrary} from './library.js';
import {convertChinese} from './converter.js';

const $ = id => document.getElementById(id);
const defaults={direction:'horizontal',script:'original',fontSize:20,lineSpacing:1.25,bold:false,theme:'paper',follow:true,rate:1,voiceURI:'',voiceName:''};
const settings={...defaults,...JSON.parse(localStorage.getItem('lihuaSettings')||'{}')};
const state={book:null,chapter:null,chapterIndex:0,pages:[],pageIndex:0,paragraphs:[],readingOffset:0,speechOffset:0,controls:false,busy:false,loadToken:0,activeParagraph:-1,voices:[],tts:{status:'idle',token:0,chapter:0,offset:0,chunk:null,sleepDeadline:0,waitingForStart:false}};
const synthesis='speechSynthesis' in window ? window.speechSynthesis:null;
let toastTimeout,resizeTimer,saveTimer;

function notify(message,delay=3300){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),delay);}
function persistSettings(){localStorage.setItem('lihuaSettings',JSON.stringify(settings));}
function applyTheme(){ $('app').className=`app theme-${settings.theme}`;document.querySelector('meta[name="theme-color"]').setAttribute('content',settings.theme==='dark'?'#1d2028':settings.theme==='sepia'?'#eddec7':'#f8f3ec');}
function bookSubtitle(book){return `${book.format} · ${book.chapterCount} 個章節`;}
function textEl(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=text;return el;}
function syncReaderControls(){
  $('readerControls').hidden=!state.controls;$('controlsBackdrop').hidden=!state.controls;
  $('playBtn').textContent=state.tts.waitingForStart?'↻ 重試朗讀':state.tts.status==='playing'?'Ⅱ 暫停':state.tts.status==='paused'?'▶ 繼續':'▶ 朗讀';
  $('headphoneBtn').textContent=state.tts.waitingForStart?'⏳':state.tts.status==='playing'?'⏸':'🎧';
  $('headphoneBtn').title=state.tts.waitingForStart?'語音啟動中；若無聲可再點一次重試':state.tts.status==='playing'?'暫停朗讀':'開始／繼續朗讀';
  $('boldBtn').classList.toggle('selected',settings.bold);
  $('followBtn').classList.toggle('selected',settings.follow);
  $('followBtn').textContent=`跟隨朗讀：${settings.follow?'開':'關'}`;
  $('directionBtn').textContent=settings.direction==='horizontal'?'橫排 → 直排':'直排 → 橫排';
  $('scriptBtn').textContent=({original:'原文',traditional:'繁體',simplified:'簡體'})[settings.script];
  $('fontSizeText').textContent=String(settings.fontSize);
  $('spacingRange').value=String(settings.lineSpacing);$('spacingValue').textContent=settings.lineSpacing.toFixed(2)+'×';
  $('prevChapter').textContent='上一章';$('nextChapter').textContent='下一章';
  // Vertical mode chapter navigation mirrors right-to-left page-turn direction.
  $('prevChapter').style.order=settings.direction==='vertical'?'2':'0';
  $('playBtn').style.order='1';$('nextChapter').style.order=settings.direction==='vertical'?'0':'2';
  $('readingDirectionLabel').textContent=settings.direction==='vertical'?'直排閱讀':'橫排閱讀';
}
function setControls(visible){state.controls=visible;syncReaderControls();}
function showSheet(title,build){$('sheetTitle').textContent=title;$('sheetContent').replaceChildren();build($('sheetContent'));$('overlay').hidden=false;}
function closeSheet(){$('overlay').hidden=true;}
function sheetButton(parent,label,fn){const btn=textEl('button','sheet-cta',label);btn.onclick=fn;parent.append(btn);return btn;}
function makeSettingRow(parent,label,description,control){const row=document.createElement('div');row.className='setting-row';const names=document.createElement('div');names.append(textEl('span','',label));if(description)names.append(textEl('small','',description));row.append(names,control);parent.append(row);return row;}
function makeSelect(options,value,change){const select=document.createElement('select');options.forEach(([v,t])=>{const opt=document.createElement('option');opt.value=v;opt.textContent=t;select.append(opt);});select.value=value;select.onchange=()=>change(select.value);return select;}
function makeCheckbox(value,change){const input=document.createElement('input');input.type='checkbox';input.checked=value;input.onchange=()=>change(input.checked);return input;}
function makeRange(min,max,step,value,change){const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=value;input.oninput=()=>change(Number(input.value));return input;}
async function refreshShelf(){
  const books=await listBooks();const grid=$('shelfGrid');grid.replaceChildren();$('shelfEmpty').hidden=books.length!==0;$('bookCount').textContent=`${books.length} 本小說`;
  for(const book of books){
    const card=document.createElement('article');card.className='book-card';
    const tile=document.createElement('button');tile.className='cover-tile';tile.setAttribute('aria-label',`閱讀 ${book.title}`);tile.onclick=()=>openBook(book.id);
    if(book.cover){const im=document.createElement('img');im.src=book.cover;im.alt=book.title+' 封面';tile.append(im);}
    else tile.append(textEl('div','placeholder-cover',book.title.slice(0,11)));
    const row=document.createElement('div');row.className='card-meta';const name=textEl('div','card-title',book.title);name.title=book.title;
    const more=textEl('button','more-book','⋯');more.setAttribute('aria-label',book.title+' 選項');more.onclick=()=>showBookActions(book);
    row.append(name,more);card.append(tile,row,textEl('div','book-sub',bookSubtitle(book)));grid.append(card);
  }
}
function showBookActions(book){showSheet(book.title,root=>{
  root.append(textEl('p','inline-hint',bookSubtitle(book)));
  sheetButton(root,'開啟閱讀',()=>{closeSheet();openBook(book.id);});
  sheetButton(root,'刪除這本書',async()=>{if(!confirm(`確定刪除「${book.title}」以及閱讀進度？`))return;await removeBook(book.id);closeSheet();refreshShelf();notify('已刪除小說');});
});}
async function importFiles(files){
  if(!files?.length)return;
  $('importBtn').disabled=true;$('importShelfBtn').disabled=true;
  let done=0;let errors=[];
  for(const file of files){
    notify(`匯入中：${file.name}`,20000);
    try{
      if(file.size>90*1024*1024)throw Error('檔案超過 90 MB，請使用較小的檔案');
      const parsed=await parseBookFile(file);
      await storeParsedBook(parsed);done++;
    }catch(e){console.error(e);errors.push(`${file.name||'未命名檔案'}：${friendlyImportError(e)}`);}
  }
  $('importBtn').disabled=false;$('importShelfBtn').disabled=false;
  try{await refreshShelf();}catch(e){console.error('Refresh shelf',e);errors.push(`書架更新：${friendlyImportError(e)}`);}
  if(errors.length){
    showSheet('小說匯入結果',root=>{
      root.append(textEl('p','inline-hint',`成功 ${done} 本，失敗 ${errors.length} 本。以下是具體原因：`));
      for(const error of errors)root.append(textEl('p','notice',error));
      root.append(textEl('p','inline-hint','如果需要協助，請把上方錯誤文字截圖給我；不需要上傳私人小說內容。'));
    });
    notify(`匯入 ${done} 本成功，${errors.length} 本失敗`,6000);
  }else notify(`已匯入 ${done} 本小說`);
  $('filePicker').value='';
}
function friendlyImportError(e){
  const raw=e?.message||String(e);
  if(e?.name==='QuotaExceededError'||/quota|storage.*full|磁碟空間/i.test(raw))return 'iPhone 儲存空間不足或 Safari 網站儲存配額已滿。請先備份現有書籍並清理空間。';
  if(e?.name==='UnknownError'&&/database|transaction/i.test(raw))return '本機書架資料庫發生錯誤，請關閉 App 後重新開啟再試。';
  return raw;
}

function splitParagraphs(text){
  const result=[];
  const regex=/[^\n]+/g;
  let match;
  while((match=regex.exec(text))!==null){const raw=match[0];const leading=(raw.match(/^\s*/)?.[0].length)||0;const trimmed=raw.trim();if(!trimmed)continue;
    result.push({id:result.length,start:match.index+leading,end:match.index+leading+trimmed.length,text:trimmed});
  }
  if(!result.length)result.push({id:0,start:0,end:0,text:'（空白章節）'});
  return result;
}
function contentForChapter(chapter){return convertChinese(chapter.text,settings.script);}
function readerDimensions(){return $('pageBody').getBoundingClientRect();}
function paragraphNode(part,active=false){const p=document.createElement('p');p.className='paragraph'+(part.continued?' continuation':'')+(part.pIndex===state.activeParagraph && active?' is-active':'');p.dataset.pindex=String(part.pIndex);p.textContent=part.text;return p;}
function updateReadStyles(){
  for(const node of [$('pageBody'),$('measure')]){
    node.classList.toggle('vertical',settings.direction==='vertical');node.classList.toggle('horizontal',settings.direction==='horizontal');
    node.style.fontSize=`${settings.fontSize}px`;node.style.lineHeight=String(settings.lineSpacing);node.style.fontWeight=settings.bold?'700':'400';
    node.style.letterSpacing='0.3px';
  }
}
function measurementOverflows(){
  const m=$('measure');
  return settings.direction==='vertical'?m.scrollWidth>m.clientWidth+1:m.scrollHeight>m.clientHeight+1;
}
function measureFit(partText,empty,continued){
  const m=$('measure');const p=document.createElement('p');p.className='paragraph'+(continued?' continuation':'');m.append(p);
  p.textContent=partText;
  if(!measurementOverflows()){m.removeChild(p);return partText.length;}
  let lo=0,hi=partText.length;
  while(lo<hi){const mid=Math.floor((lo+hi+1)/2);p.textContent=partText.slice(0,mid);if(measurementOverflows())hi=mid-1;else lo=mid;}
  m.removeChild(p);return lo;
}
function makePages(){
  const rect=readerDimensions();const m=$('measure');m.style.width=rect.width+'px';m.style.height=rect.height+'px';
  updateReadStyles();
  const pages=[];const paragraphs=state.paragraphs;
  let pi=0,ci=0,safety=0;
  while(pi<paragraphs.length && safety++<20000){
    const items=[];m.replaceChildren();let iterations=0;
    while(pi<paragraphs.length && iterations++<250){
      const para=paragraphs[pi];
      const tail=para.text.slice(ci);const continued=ci>0;
      const fit=measureFit(tail,items.length===0,continued);
      if(fit>=tail.length){
        const end=para.start+para.text.length;
        items.push({text:tail,pIndex:pi,start:para.start+ci,end,continued});
        m.append(paragraphNode({text:tail,pIndex:pi,continued}));
        pi++;ci=0;
      }else if(fit>0){
        items.push({text:tail.slice(0,fit),pIndex:pi,start:para.start+ci,end:para.start+ci+fit,continued});
        ci+=fit;break;
      }else if(items.length){break;}
      else {
        const count=Math.min(tail.length,1);items.push({text:tail.slice(0,count),pIndex:pi,start:para.start+ci,end:para.start+ci+count,continued});ci+=count;
        if(ci>=para.text.length){pi++;ci=0;}break;
      }
    }
    if(items.length)pages.push({items,start:items[0].start,end:items[items.length-1].end});
    else break;
  }
  m.replaceChildren();
  return pages.length?pages:[{items:[],start:0,end:0}];
}
function pageOfOffset(offset){
  const pages=state.pages;let lo=0,hi=pages.length-1;
  while(lo<=hi){const mid=(lo+hi)>>1;const pg=pages[mid];
    if(offset<pg.start)hi=mid-1;
    else if(offset>=pg.end && mid<pages.length-1)lo=mid+1;
    else return mid;
  }
  return Math.max(0,Math.min(pages.length-1,lo));
}
function renderPage(){
  const page=state.pages[state.pageIndex];const body=$('pageBody');body.replaceChildren();
  for(const item of page?.items||[]){body.append(paragraphNode(item,true));}
  $('readingProgress').textContent=`${state.pageIndex+1}／${state.pages.length} 頁 · 第 ${state.chapterIndex+1}／${state.book?.chapterCount||1} 章`;
  $('chapterTitleText').textContent=state.chapter?.title||'閱讀中';
  $('readerBookTitle').textContent=state.book?.title||'麗華小說';
  $('prevChapter').disabled=state.chapterIndex<=0;
  $('nextChapter').disabled=state.chapterIndex>=(state.book?.chapterCount||1)-1;
}
function scheduleSavePosition(chapter,offset){clearTimeout(saveTimer);const id=state.book?.id;if(!id)return;saveTimer=setTimeout(()=>savePosition(id,chapter,offset).catch(console.error),120);}
async function commitPosition(){clearTimeout(saveTimer);if(!state.book)return;const t=state.tts;
  if(t.status!=='idle')await savePosition(state.book.id,t.chapter,t.offset);
  else await savePosition(state.book.id,state.chapterIndex,state.readingOffset);
}
async function repaginate(targetOffset=state.readingOffset){
  if(!state.chapter)return;
  if(settings.follow && state.tts.status!=='idle' && state.tts.chapter===state.chapterIndex)targetOffset=state.tts.offset;
  const chapterText=contentForChapter(state.chapter);state.paragraphs=splitParagraphs(chapterText);
  state.pages=makePages();state.pageIndex=pageOfOffset(Math.max(0,targetOffset));renderPage();
  syncReaderControls();
}
async function openBook(bookId){
  stopSpeech(false);closeSheet();
  const book=await getBook(bookId);if(!book){notify('找不到小說');return;}
  state.book=book;state.chapter=null;state.pageIndex=0;state.controls=false;state.activeParagraph=-1;
  $('shelfView').hidden=true;$('readerView').hidden=false;applyTheme();syncReaderControls();
  await updateBookOpen(bookId);
  const progress=await getPosition(bookId);
  await loadChapter(progress.chapter||0,Math.max(0,progress.offset||0),{save:false,keepSpeech:true});
}
async function loadChapter(index,offset=0,{save=true,keepSpeech=false}={}){
  if(!state.book)return;
  if(!keepSpeech)stopSpeech();
  index=Math.max(0,Math.min(state.book.chapterCount-1,index));
  const token=++state.loadToken;state.busy=true;
  const chapter=await getChapter(state.book.id,index);if(token!==state.loadToken)return;
  if(!chapter){notify('找不到章節內容');state.busy=false;return;}
  state.chapter=chapter;state.chapterIndex=index;state.readingOffset=Math.min(chapter.text.length,Math.max(0,offset));
  state.speechOffset=state.readingOffset;state.activeParagraph=-1;
  await new Promise(resolve=>requestAnimationFrame(resolve));
  if(token!==state.loadToken)return;
  await repaginate(state.readingOffset);
  state.busy=false;
  if(save)scheduleSavePosition(index,state.readingOffset);
}
function goPage(step,{auto=false}={}){
  if(!state.book||state.busy)return;
  if(!auto && settings.follow && state.tts.status==='playing' && !state.tts.waitingForStart)return;
  const next=state.pageIndex+step;
  // A manual page turn after pause means 'continue from this new page', not the old speech cursor.
  if(!auto && state.tts.status==='paused' && (next>=0&&next<state.pages.length || next<0&&state.chapterIndex>0 || next>=state.pages.length&&state.chapterIndex<state.book.chapterCount-1)){
    stopSpeech(false);
  }
  if(next>=0&&next<state.pages.length){
    state.pageIndex=next;renderPage();
    if(!auto){state.readingOffset=state.pages[next].start;scheduleSavePosition(state.chapterIndex,state.readingOffset);}
  }else if(next<0&&state.chapterIndex>0){
    loadChapter(state.chapterIndex-1,0,{save:false}).then(()=>{state.pageIndex=state.pages.length-1;state.readingOffset=state.pages[state.pageIndex].start;renderPage();scheduleSavePosition(state.chapterIndex,state.readingOffset);});
  }else if(next>=state.pages.length&&state.chapterIndex<state.book.chapterCount-1){loadChapter(state.chapterIndex+1,0);}
}
function followOffset(offset){
  if(!settings.follow||!state.chapter)return;
  const page=pageOfOffset(offset);
  if(page!==state.pageIndex){state.pageIndex=page;renderPage();}
  else for(const p of $('pageBody').querySelectorAll('.paragraph'))p.classList.toggle('is-active',Number(p.dataset.pindex)===state.activeParagraph);
}
function displayFollowHighlight(){const visible=state.pages[state.pageIndex];if(!visible)return;
  for(const [index,item] of visible.items.entries()){
    const el=$('pageBody').children[index];if(el)el.classList.toggle('is-active',item.pIndex===state.activeParagraph);
  }
}
async function returnToShelf(){
  const t=state.tts;
  const bookmark=t.status!=='idle'?{chapter:t.chapter,offset:t.offset}:{chapter:state.chapterIndex,offset:state.readingOffset};
  stopSpeech(false);
  if(state.book)await savePosition(state.book.id,bookmark.chapter,bookmark.offset).catch(console.error);
  state.book=null;state.chapter=null;state.pages=[];state.controls=false;
  closeSheet();$('readerView').hidden=true;$('shelfView').hidden=false;
  await refreshShelf();
}

function refreshVoices(){
  if(!synthesis)return;
  state.voices=synthesis.getVoices().filter(v=>/^(zh|cmn)/i.test(v.lang));
}
function chooseVoice(){
  const all=state.voices;
  return all.find(v=>v.voiceURI===settings.voiceURI)||all.find(v=>v.name===settings.voiceName)||all.find(v=>v.lang.toLowerCase()==='zh-tw')||all.find(v=>v.lang.toLowerCase().startsWith('zh'))||null;
}
function makeUtterance(text){const utterance=new SpeechSynthesisUtterance(text);const v=chooseVoice();if(v)utterance.voice=v;utterance.lang=v?.lang||(settings.script==='simplified'?'zh-CN':'zh-TW');utterance.rate=settings.rate;utterance.pitch=1;return utterance;}
function stopSpeech(save=true){
  const t=state.tts;
  if(save && state.book&&t.status!=='idle'){
    savePosition(state.book.id,t.chapter,t.offset).catch(console.error);
    if(t.chapter===state.chapterIndex)state.readingOffset=t.offset;
  }
  t.token++;t.status='idle';t.chunk=null;t.waitingForStart=false;
  if(synthesis)try{synthesis.cancel();}catch{}
  state.activeParagraph=-1;
  if(!state.book)return;
  displayFollowHighlight();syncReaderControls();
}
function pauseSpeech(){if(!synthesis)return;
  try{synthesis.pause();state.tts.status='paused';}catch(e){console.error(e);}
  syncReaderControls();
}
function resumeSpeech(){if(!synthesis)return;
  try{synthesis.resume();state.tts.status='playing';}catch(e){console.error(e);}
  syncReaderControls();
}
function nextTextChunk(chapterText,offset,{quickStart=false}={}){
  const after=chapterText.slice(offset);
  const spaces=after.match(/^\s*/)?.[0].length||0;
  const start=offset+spaces;
  if(start>=chapterText.length)return null;
  const rest=chapterText.slice(start);
  const newline=rest.indexOf('\n');const paragraphText=(newline>=0?rest.slice(0,newline):rest).trimEnd();
  if(!paragraphText)return nextTextChunk(chapterText,start+Math.max(1,newline+1));
  // Preserve original paragraphs. Split only overly long paragraphs to keep iOS speech responsive.
  // On iOS a very long first utterance can remain silent until the voice engine warms up.
  // Start with real novel text (never a spoken test phrase), then continue normally.
  const maximum=quickStart?36:165;
  let count=Math.min(paragraphText.length,maximum);
  if(paragraphText.length>maximum){
    const prefix=paragraphText.slice(0,maximum);
    const minBreak=quickStart?10:65;
    const m=Array.from(prefix.matchAll(/[。！？!?；;，、, ]/g)).filter(x=>x.index>=minBreak).at(-1);
    if(m)count=m.index+1;
  }
  const pIndex=state.paragraphs.findIndex(p=>start>=p.start&&start<p.end);
  return {text:chapterText.slice(start,start+count),start,end:start+count,pIndex};
}
function testIPhoneVoice(){
  if(!synthesis||typeof SpeechSynthesisUtterance==='undefined'){
    notify('此 iPhone 瀏覽器沒有提供網頁語音功能',6500);return;
  }
  refreshVoices();
  try{
    if(synthesis.speaking||synthesis.pending||synthesis.paused)synthesis.cancel();
    // Must speak directly in the button tap, without await / setTimeout, on iOS WebKit.
    const u=makeUtterance('你好，這是麗華小說的中文語音測試。');
    let started=false;
    const check=setTimeout(()=>{if(!started)notify('語音尚未開始：請調高媒體音量，確認 iPhone 中文語音可用，然後再點一次試聽。',8500);},9000);
    u.onstart=()=>{started=true;clearTimeout(check);notify('語音測試開始播放');};
    u.onerror=e=>{clearTimeout(check);notify(`語音測試失敗：${e.error||'未提供原因'}`,6500);};
    u.onend=()=>clearTimeout(check);
    synthesis.speak(u);
  }catch(e){console.error(e);notify('語音測試無法啟動：'+e.message,6500);}
}
function startSpeech(){
  if(!synthesis){notify('此瀏覽器不支援語音朗讀');return;}
  if(!state.book||state.busy)return;
  if(state.tts.status==='playing' && state.tts.waitingForStart){
    // A second user tap is itself a fresh Safari gesture. Retry rather than pausing silent audio.
    stopSpeech(false);
  }else if(state.tts.status==='playing'){pauseSpeech();return;}
  if(state.tts.status==='paused'){
    // When the current page has changed since pause, start from the displayed page.
    if(state.tts.chapter===state.chapterIndex && pageOfOffset(state.tts.offset)===state.pageIndex){resumeSpeech();return;}
    stopSpeech(false);state.readingOffset=state.pages[state.pageIndex]?.start||0;
  }
  refreshVoices();
  try{if(synthesis.speaking||synthesis.pending||synthesis.paused)synthesis.cancel();}catch{}
  state.tts.token++;state.tts.status='playing';state.tts.waitingForStart=true;state.tts.chapter=state.chapterIndex;state.tts.offset=state.readingOffset;
  syncReaderControls();
  // Critical iPhone fix: avoid awaiting IndexedDB before first speechSynthesis.speak().
  // The current chapter is already in memory from loadChapter().
  speakNext(state.tts.token,state.chapter,true);
}
function speakNext(token,loadedChapter=null,quickStart=false){
  const t=state.tts;if(token!==t.token||t.status==='idle'||!state.book)return;
  if(t.sleepDeadline&&Date.now()>=t.sleepDeadline){stopSpeech();notify('睡眠定時已到，朗讀停止');return;}
  const chapter=loadedChapter || (t.chapter===state.chapterIndex?state.chapter:null);
  if(!chapter){
    getChapter(state.book.id,t.chapter).then(ch=>{
      if(token!==t.token||t.status==='idle')return;
      if(!ch){stopSpeech();notify('朗讀失敗：找不到章節內容',6000);return;}
      speakNext(token,ch);
    }).catch(e=>{console.error(e);if(token===t.token){stopSpeech();notify('朗讀讀取失敗：'+e.message,6500);}});
    return;
  }
  const full=contentForChapter(chapter);
  if(t.offset>=full.length){
    if(t.chapter+1>=state.book.chapterCount){stopSpeech();notify('已朗讀完這本小說');return;}
    t.chapter++;t.offset=0;
    const nextChapter=t.chapter;
    const readNext=()=>getChapter(state.book.id,nextChapter).then(ch=>{
      if(token!==t.token||t.status==='idle')return;
      if(!ch){stopSpeech();notify('下一章讀取失敗');return;}
      speakNext(token,ch);
    });
    if(settings.follow){
      loadChapter(nextChapter,0,{save:false,keepSpeech:true}).then(readNext).catch(e=>{console.error(e);if(token===t.token){stopSpeech();notify('載入下一章失敗：'+e.message,6500);}});
    }else readNext().catch(e=>{console.error(e);if(token===t.token){stopSpeech();notify('讀取下一章失敗：'+e.message,6500);}});
    return;
  }
  const chunk=nextTextChunk(full,t.offset,{quickStart});
  if(!chunk){t.offset=full.length;speakNext(token);return;}
  const utterance=makeUtterance(chunk.text);
  t.chunk=chunk;
  let started=false;
  const startupWatchdog=setTimeout(()=>{
    if(token!==t.token||t.status!=='playing'||started)return;
    notify('語音沒有啟動，請再點一次耳機重試；不需要先到設定試聽。',8500);
  },11000);
  utterance.onstart=()=>{
    if(token!==t.token)return;
    started=true;clearTimeout(startupWatchdog);t.waitingForStart=false;syncReaderControls();
    t.offset=chunk.start;state.speechOffset=chunk.start;
    savePosition(state.book.id,t.chapter,chunk.start).catch(console.error);
    if(t.chapter===state.chapterIndex){
      state.activeParagraph=chunk.pIndex;
      if(settings.follow)followOffset(chunk.start);
      displayFollowHighlight();
    }
  };
  utterance.onboundary=e=>{
    if(token!==t.token||typeof e.charIndex!=='number')return;
    const pos=Math.min(chunk.end,chunk.start+e.charIndex);
    t.offset=pos;state.speechOffset=pos;
    // Boundary events may be unavailable on Safari; chunk start/end still persist progress.
    if(t.chapter===state.chapterIndex){
      // Safari fires boundary events during a paragraph; keep its highlight visible.
      const pIndex=state.paragraphs.findIndex(p=>pos>=p.start&&pos<p.end);
      if(pIndex>=0)state.activeParagraph=pIndex;
      if(settings.follow)followOffset(pos);
      displayFollowHighlight();
    }
  };
  utterance.onend=()=>{
    clearTimeout(startupWatchdog);
    if(token!==t.token)return;
    t.waitingForStart=false;
    if(!started){
      // Some iOS versions emit onend without ever starting audible speech. Never skip text.
      t.status='idle';syncReaderControls();
      notify('iPhone 語音未成功啟動，請再點耳機重試；不需要先試聽。',8500);return;
    }
    t.offset=chunk.end;savePosition(state.book.id,t.chapter,t.offset).catch(console.error);
    if(t.status==='playing')speakNext(token);
  };
  utterance.onerror=e=>{
    clearTimeout(startupWatchdog);
    if(token!==t.token)return;
    if(e.error==='interrupted'||e.error==='canceled')return;
    const message=e.error||'未知錯誤';stopSpeech();notify(`朗讀中斷：${message}。iPhone 鎖定螢幕時可能中斷。`,6000);
  };
  try{synthesis.speak(utterance);}catch(e){clearTimeout(startupWatchdog);console.error(e);stopSpeech();notify('無法開始朗讀，請確認 iPhone 語音設定');}
}

function showToc(){if(!state.book)return;
  showSheet('章節目錄',async root=>{
    const bookId=state.book.id;
    for(let i=0;i<state.book.chapterCount;i++){
      const ch=await getChapter(bookId,i);if(!ch||state.book?.id!==bookId)return;
      const btn=textEl('button','toc-item'+(i===state.chapterIndex?' active':''),ch.title);
      btn.onclick=()=>{closeSheet();setControls(false);loadChapter(i,0);};root.append(btn);
    }
  });
}
function showSettings(){showSheet('閱讀設定',root=>{
  makeSettingRow(root,'閱讀方向','橫排：左上一頁、右下一頁；直排相反',makeSelect([['horizontal','橫排（左至右）'],['vertical','直排（右至左）']],settings.direction,v=>{settings.direction=v;persistSettings();repaginate(state.readingOffset);syncReaderControls();}));
  makeSettingRow(root,'繁簡轉換','保留原始小說內容',makeSelect([['original','原文'],['traditional','繁體'],['simplified','簡體']],settings.script,v=>{settings.script=v;persistSettings();repaginate(state.readingOffset);syncReaderControls();}));
  makeSettingRow(root,'閱讀主題','',makeSelect([['paper','米白'],['sepia','護眼棕'],['dark','深色']],settings.theme,v=>{settings.theme=v;persistSettings();applyTheme();}));
  makeSettingRow(root,'粗體文字','',makeCheckbox(settings.bold,v=>{settings.bold=v;persistSettings();repaginate(state.readingOffset);syncReaderControls();}));
  makeSettingRow(root,'跟隨朗讀','朗讀中鎖定手動翻頁，自動依播放進度翻頁',makeCheckbox(settings.follow,v=>{settings.follow=v;persistSettings();syncReaderControls();}));
  const fontValue=textEl('span','',settings.fontSize+' px');const f=makeRange(15,34,1,settings.fontSize,v=>{settings.fontSize=v;fontValue.textContent=v+' px';persistSettings();repaginate(state.readingOffset);});const fwrap=document.createElement('div');fwrap.style.display='flex';fwrap.style.alignItems='center';fwrap.append(f,fontValue);makeSettingRow(root,'字體大小','即時調整',fwrap);
  const spaceValue=textEl('span','',settings.lineSpacing.toFixed(2)+'×');const s=makeRange(.8,1.8,.05,settings.lineSpacing,v=>{settings.lineSpacing=v;spaceValue.textContent=v.toFixed(2)+'×';persistSettings();repaginate(state.readingOffset);syncReaderControls();});const swrap=document.createElement('div');swrap.style.display='flex';swrap.style.alignItems='center';swrap.append(s,spaceValue);makeSettingRow(root,'行距／列距','即時調整',swrap);
  const rate=makeSelect([['0.75','0.75×'],['0.85','0.85×'],['1','1.0×'],['1.15','1.15×'],['1.3','1.3×'],['1.5','1.5×'],['1.75','1.75×'],['2','2×']],String(settings.rate),v=>{settings.rate=Number(v);persistSettings();notify('語速會從下一段朗讀開始套用');});makeSettingRow(root,'朗讀語速','',rate);
  refreshVoices();
  const voices=state.voices;const voiceOptions=[['','自動選擇 iPhone 中文聲音'],...voices.map(v=>[v.voiceURI,v.name+'（'+v.lang+'）'])];
  if(!voices.length)root.append(textEl('p','inline-hint','目前 Safari 尚未列出中文音色，可先按試聽；若有聲音，仍可使用系統預設語音。'));
  makeSettingRow(root,'iPhone 語音','可用音色取決於 iPhone 的語音設定',makeSelect(voiceOptions,settings.voiceURI,v=>{const voice=voices.find(x=>x.voiceURI===v);settings.voiceURI=v;settings.voiceName=voice?.name||'';persistSettings();}));
  sheetButton(root,'▶ 試聽選擇的聲音',()=>{stopSpeech();testIPhoneVoice();});
  sheetButton(root,'⏱ 睡眠定時',()=>showSleepOptions());
  root.append(textEl('p','notice','iPhone PWA 的語音依賴 Safari Web Speech API。切換 App 或鎖定螢幕後可能中斷，無法保證與 Android 原生背景朗讀相同。'));
});}
function showSleepOptions(){showSheet('睡眠定時',root=>{
  for(const mins of [0,15,30,60])sheetButton(root,mins===0?'關閉定時':`${mins} 分鐘後停止`,()=>{
    state.tts.sleepDeadline=mins?Date.now()+mins*60000:0;closeSheet();notify(mins?`已設定 ${mins} 分鐘後停止朗讀`:'睡眠定時已關閉');
  });
  root.append(textEl('p','inline-hint','定時會在語音片段切換時檢查；iPhone 背景暫停網頁時，計時可能延後。'));
});}
function showScriptOptions(){showSheet('繁簡轉換',root=>{
  for(const [v,label] of [['original','原文（不轉換）'],['traditional','繁體中文'],['simplified','簡體中文']]){
    const b=sheetButton(root,(settings.script===v?'✓ ':'')+label,()=>{settings.script=v;persistSettings();repaginate(state.readingOffset);syncReaderControls();closeSheet();});
  }
  root.append(textEl('p','inline-hint','繁簡轉換在閱讀時進行，不會修改原始書籍；少量特殊字詞可能需要人工校正。'));
});}
function showFullChapterTitle(){showSheet('章節資訊',root=>{root.append(textEl('p','full-title',state.chapter?.title||''));root.append(textEl('p','inline-hint',`第 ${state.chapterIndex+1}／${state.book?.chapterCount||1} 章`));});}
function showBackup(){showSheet('備份與還原',root=>{
  root.append(textEl('p','notice','iPhone PWA 的本機資料有可能被系統清理。建議定期將小說及閱讀進度匯出備份到「檔案」或 iCloud Drive。'));
  sheetButton(root,'⬇ 匯出所有書籍與進度',async()=>{
    try{notify('正在整理備份…',20000);const data=await exportLibrary();const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`LiHuaReader-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);notify('備份檔已產生，請保存到 iPhone「檔案」');
    }catch(e){notify('備份失敗：'+e.message);}
  });
  sheetButton(root,'⬆ 匯入麗華小說備份',()=>{$('backupPicker').click();});
});}
function createSampleBook(){return {title:'月光書簡（示範小說）',format:'TXT',chapters:[
  {title:'第一章　窗前的來信',text:'夜色漸深，街道上的人潮終於散去。窗邊那盞小小的燈，卻仍然亮著。\n\n她坐在書桌前，手裡握著一封許久未曾拆開的信。信封的邊角已經泛黃，字跡卻清晰如初。\n\n「原來你一直記得。」她低聲說。\n\n窗外，晚風輕輕吹過樹梢，帶來雨後清新的氣息。她翻開信紙，開始讀那個被時間收藏的故事。\n\n有些相遇，並不需要轟轟烈烈；只是某個平凡的午後，兩個人恰好走在同一條路上。\n\n她想起那一天，陽光暖暖地落在石階上，像今天這封信一樣溫柔。\n\n故事才剛剛開始。'},
  {title:'第二章　遠方的風',text:'清晨的第一班列車穿過山谷，窗外的風景在薄霧中慢慢甦醒。\n\n她望著遠處的海岸，心裡突然有了一個決定。\n\n「這一次，我想親自去看看。」\n\n行李很輕，除了幾本書，便只剩那封折得整整齊齊的信。\n\n列車繼續向前，新的故事，也正在遠方等著她。'}]};}
function wireEvents(){
  const picker=$('filePicker');$('importBtn').onclick=$('importShelfBtn').onclick=()=>picker.click();picker.onchange=()=>importFiles(Array.from(picker.files));
  $('sampleBtn').onclick=async()=>{const b=await storeParsedBook(createSampleBook());await refreshShelf();openBook(b.id);};
  $('backupBtn').onclick=showBackup;
  $('voiceTestBtn').onclick=testIPhoneVoice;
  $('backupPicker').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const data=JSON.parse(await file.text());const n=await restoreLibrary(data);
    try{Object.assign(settings,JSON.parse(localStorage.getItem('lihuaSettings')||'{}'));applyTheme();syncReaderControls();}catch{}
    closeSheet();await refreshShelf();notify(`已還原 ${n} 本小說`);}catch(err){notify('備份還原失敗：'+err.message);}finally{$('backupPicker').value='';}};
  $('backToShelf').onclick=returnToShelf;$('readerBookTitle').onclick=showFullChapterTitle;
  $('headphoneBtn').onclick=startSpeech;$('tocBtn').onclick=showToc;
  $('tapCenter').onclick=()=>setControls(!state.controls);
  $('tapLeft').onclick=()=>goPage(settings.direction==='vertical'?1:-1);
  $('tapRight').onclick=()=>goPage(settings.direction==='vertical'?-1:1);
  $('controlsBackdrop').onclick=()=>setControls(false);
  $('prevChapter').onclick=()=>loadChapter(state.chapterIndex-1,0);
  $('nextChapter').onclick=()=>loadChapter(state.chapterIndex+1,0);
  $('playBtn').onclick=startSpeech;
  $('fontMinus').onclick=()=>{settings.fontSize=Math.max(15,settings.fontSize-1);persistSettings();repaginate(state.readingOffset);};
  $('fontPlus').onclick=()=>{settings.fontSize=Math.min(34,settings.fontSize+1);persistSettings();repaginate(state.readingOffset);};
  $('boldBtn').onclick=()=>{settings.bold=!settings.bold;persistSettings();repaginate(state.readingOffset);};
  $('spacingRange').oninput=e=>{settings.lineSpacing=Number(e.target.value);persistSettings();repaginate(state.readingOffset);};
  $('directionBtn').onclick=()=>{settings.direction=settings.direction==='vertical'?'horizontal':'vertical';persistSettings();repaginate(state.readingOffset);};
  $('followBtn').onclick=()=>{settings.follow=!settings.follow;persistSettings();syncReaderControls();};
  $('scriptBtn').onclick=showScriptOptions;
  $('chapterTitleBtn').onclick=showFullChapterTitle;
  $('settingsBtn').onclick=showSettings;
  $('closeSheet').onclick=closeSheet;
  $('overlay').onclick=e=>{if(e.target===$('overlay'))closeSheet();};
  window.addEventListener('resize',()=>{if(!state.book)return;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>repaginate(state.readingOffset),160);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)commitPosition().catch(console.error);});
  window.addEventListener('pagehide',()=>{commitPosition().catch(console.error);});
  window.addEventListener('keydown',e=>{if($('overlay').hidden===false)return;if(!state.book)return;
    if(e.key==='Escape')setControls(false);
    if(e.key==='ArrowLeft')goPage(settings.direction==='vertical'?1:-1);
    if(e.key==='ArrowRight')goPage(settings.direction==='vertical'?-1:1);
    if(e.key===' ') {e.preventDefault();startSpeech();}
  });
  if(synthesis){refreshVoices();synthesis.addEventListener?.('voiceschanged',refreshVoices);}
}
async function initialize(){applyTheme();wireEvents();syncReaderControls();
  try{await openLibrary();await refreshShelf();}
  catch(e){console.error(e);notify('無法存取本機書架，請確認 Safari 非私密瀏覽模式',6500);}
  if('serviceWorker' in navigator && /^https?:/.test(location.protocol)){
    navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('Offline setup failed',e));
  }
}
initialize();
