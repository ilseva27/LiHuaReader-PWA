// Offline book parsing and IndexedDB storage. User books never leave the device.
const DB_NAME = 'LiHuaReaderPWA';
const DB_VERSION = 1;
let databasePromise;

export async function openLibrary() {
  if(databasePromise){
    try{
      const db=await databasePromise;
      db.transaction('books','readonly'); // iOS may close IndexedDB connections in the background.
      return db;
    }catch(e){databasePromise=null;}
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath:'id' });
      if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters', { keyPath:['bookId','index'] });
      if (!db.objectStoreNames.contains('positions')) db.createObjectStore('positions', { keyPath:'bookId' });
    };
    request.onsuccess = () => {
      const db=request.result;
      db.onclose=()=>{databasePromise=null;};
      db.onversionchange=()=>{db.close();databasePromise=null;};
      resolve(db);
    };
    request.onerror = () => {databasePromise=null;reject(request.error);};
  });
  return databasePromise;
}
const wait = req => new Promise((resolve,reject)=> { req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error); });
async function transaction(stores,mode,fn) {
  const db=await openLibrary();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode);
    let result;
    try {result=fn(tx);} catch(e) {tx.abort();reject(e);return;}
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('資料庫寫入取消'));
  });
}
export async function listBooks(){const db=await openLibrary();return wait(db.transaction('books','readonly').objectStore('books').getAll()).then(rows=>rows.sort((a,b)=>(b.lastOpened||b.importedAt)-(a.lastOpened||a.importedAt)));}
export async function getBook(bookId){const db=await openLibrary();return wait(db.transaction('books','readonly').objectStore('books').get(bookId));}
export async function getChapter(bookId,index){const db=await openLibrary();return wait(db.transaction('chapters','readonly').objectStore('chapters').get([bookId,index]));}
export async function getPosition(bookId){const db=await openLibrary();return (await wait(db.transaction('positions','readonly').objectStore('positions').get(bookId))) || {bookId,chapter:0,offset:0};}
export async function savePosition(bookId,chapter,offset){const db=await openLibrary();return wait(db.transaction('positions','readwrite').objectStore('positions').put({bookId,chapter,offset,updatedAt:Date.now()}));}
export async function updateBookOpen(bookId){const b=await getBook(bookId);if(!b)return; b.lastOpened=Date.now();const db=await openLibrary();await wait(db.transaction('books','readwrite').objectStore('books').put(b));}
export async function removeBook(bookId){
  const book=await getBook(bookId);if(!book)return;
  await transaction(['books','chapters','positions'],'readwrite',tx=>{
    tx.objectStore('books').delete(bookId);tx.objectStore('positions').delete(bookId);
    for(let i=0;i<book.chapterCount;i++)tx.objectStore('chapters').delete([bookId,i]);
  });
}
export async function storeParsedBook(parsed) {
  if(!Array.isArray(parsed.chapters)||!parsed.chapters.length)throw new Error('小說沒有可讀取的章節');
  // Imported a book twice? Reuse the original instead of inserting a new random ID.
  // Check the beginning and end chapters, not merely the filename (different books may share titles).
  const existingBooks=await listBooks();
  const firstNew=parsed.chapters[0].text||'';
  const lastNew=parsed.chapters.at(-1).text||'';
  for(const old of existingBooks){
    if(old.title!==(parsed.title||'未命名小說')||old.format!==parsed.format||old.chapterCount!==parsed.chapters.length)continue;
    const first=await getChapter(old.id,0);
    if(first?.text!==firstNew)continue;
    const last=await getChapter(old.id,old.chapterCount-1);
    if(last?.text===lastNew)return {...old,alreadyExists:true};
  }
  const id=globalThis.crypto?.randomUUID?.()||`book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const meta={id,title:parsed.title||'未命名小說',author:parsed.author||'',format:parsed.format,cover:parsed.cover||'',chapterCount:parsed.chapters.length,importedAt:Date.now(),lastOpened:0};
  await transaction(['books','chapters','positions'],'readwrite',tx=>{
    tx.objectStore('books').put(meta);
    parsed.chapters.forEach((ch,index)=>tx.objectStore('chapters').put({bookId:id,index,title:ch.title||`第 ${index+1} 章`,text:ch.text||''}));
    tx.objectStore('positions').put({bookId:id,chapter:0,offset:0,updatedAt:Date.now()});
  });
  return meta;
}
export async function exportLibrary(){
  const books=await listBooks();const out=[];
  for(const b of books){
    const position=await getPosition(b.id);
    const chapters=[];for(let i=0;i<b.chapterCount;i++){const ch=await getChapter(b.id,i);chapters.push({title:ch.title,text:ch.text});}
    out.push({book:b,position,chapters});
  }
  return {app:'麗華小說',version:1,exportedAt:new Date().toISOString(),settings:JSON.parse(localStorage.getItem('lihuaSettings')||'{}'),books:out};
}
export async function restoreLibrary(data){
  if(!data||data.app!=='麗華小說'||!Array.isArray(data.books))throw Error('不是麗華小說的備份檔');
  let count=0;
  for(const item of data.books){
    if(!item.book||!Array.isArray(item.chapters))continue;
    const saved=await storeParsedBook({title:item.book.title,author:item.book.author,format:item.book.format,cover:item.book.cover,chapters:item.chapters});
    const p=item.position||{}; await savePosition(saved.id, Math.max(0,Math.min(saved.chapterCount-1,p.chapter||0)), Math.max(0,p.offset||0));count++;
  }
  if(data.settings && typeof data.settings==='object'){
    const allowed=['direction','script','fontSize','lineSpacing','bold','theme','follow','rate','voiceURI','voiceName'];
    const safe=Object.fromEntries(Object.entries(data.settings).filter(([key])=>allowed.includes(key)));
    localStorage.setItem('lihuaSettings',JSON.stringify(safe));
  }
  return count;
}
export async function parseBookFile(file) {
  const name=file.name||'未命名小說';
  if(/\.epub$/i.test(name)||file.type==='application/epub+zip')return parseEpub(file);
  if(/\.txt$/i.test(name)||file.type==='text/plain'||file.type==='text/utf-8')return parseTxt(file);
  // iOS Files may supply empty / generic MIME types and filenames without extensions.
  const header=new Uint8Array(await file.slice(0,4).arrayBuffer());
  if(header[0]===0x50&&header[1]===0x4b&&header[2]===0x03&&header[3]===0x04)return parseEpub(file);
  if(!file.type||file.type==='application/octet-stream')return parseTxt(file);
  throw Error('目前只支援 TXT 或 EPUB；請確認檔案不是 PDF 或其他格式');
}
function normalText(text){return String(text||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/[\t\u00a0]+/g,' ').replace(/\n[ \t]+/g,'\n').trim();}
function pickTextEncoding(bytes) {
  if(bytes[0]===0xFF && bytes[1]===0xFE)return new TextDecoder('utf-16le').decode(bytes);
  if(bytes[0]===0xFE && bytes[1]===0xFF)return new TextDecoder('utf-16be').decode(bytes);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
  const decodings=['gb18030','big5'];let selected='',lowest=Infinity;
  for(const enc of decodings){
    try{
      const candidate=new TextDecoder(enc).decode(bytes);
      const bad=(candidate.match(/\uFFFD/g)||[]).length;
      const unprintable=(candidate.match(/[\u0000-\u0008\u000E-\u001F]/g)||[]).length;
      const score=bad*10+unprintable*3;
      if(score<lowest){lowest=score;selected=candidate;}
    }catch{}
  }
  return selected||new TextDecoder('utf-8').decode(bytes);
}
function titleFromFilename(name){return name.replace(/\.(txt|epub)$/i,'').replace(/[_]+/g,' ').trim()||'未命名小說';}
function splitLongChapters(chapters){
  const output=[];
  for(const ch of chapters){
    if(ch.text.length<=16000){output.push(ch);continue;}
    let group='',part=1;
    for(const line of ch.text.split('\n')){
      if(group.length+line.length>12000 && group){output.push({title:part===1?ch.title:`${ch.title}（續 ${part}）`,text:group.trim()});part++;group='';}
      if(line.length>16000){let pos=0;while(pos<line.length){const chunk=line.slice(pos,pos+10000);if(group){output.push({title:part===1?ch.title:`${ch.title}（續 ${part}）`,text:group.trim()});part++;group='';}group=chunk;pos+=10000;} }
      else group+=line+'\n';
    }
    if(group.trim())output.push({title:part===1?ch.title:`${ch.title}（續 ${part}）`,text:group.trim()});
  }
  return output;
}
export function chaptersFromTxt(text,title){
  const normalized=normalText(text);if(!normalized)throw Error('TXT 檔案沒有可辨識的文字');
  const lines=normalized.split('\n');const chapters=[];let current={title:'開始閱讀',text:''};
  const chapterRe=/^(?:第[〇零一二三四五六七八九十百千0-9]{1,14}[章回節卷部篇]|chapter\s*\d+|序章|楔子|尾聲|終章|番外)(?:\s*[:：.．、\-－]?\s*.*)?$/i;
  for(const line of lines){
    const clean=line.trim();
    if(clean&&clean.length<65&&chapterRe.test(clean)){
      if(current.text.trim())chapters.push({title:current.title,text:current.text.trim()});
      current={title:clean,text:''};
    }else current.text+=line+'\n';
  }
  if(current.text.trim())chapters.push({title:current.title,text:current.text.trim()});
  if(!chapters.length)chapters.push({title:'全文',text:normalized});
  return splitLongChapters(chapters.map(ch=>({...ch,text:ch.text.replace(/\n{3,}/g,'\n\n')})));
}
async function parseTxt(file){
  const raw=new Uint8Array(await file.arrayBuffer());
  const decoded=pickTextEncoding(raw);
  return {title:titleFromFilename(file.name),format:'TXT',chapters:chaptersFromTxt(decoded,titleFromFilename(file.name))};
}
function pathJoin(base,relative){
  const unescaped=(relative||'').split('#')[0].split('?')[0];
  let pieces;try{pieces=decodeURIComponent(unescaped);}catch{pieces=unescaped;}
  pieces=pieces.replace(/\\/g,'/');
  if(!pieces)return base;
  const parts=(base?base.split('/'):[]).concat(pieces.split('/'));
  const result=[];for(const x of parts){if(!x||x==='.')continue;if(x==='..')result.pop();else result.push(x);}
  return result.join('/');
}
function xmlEl(parent,name){return Array.from(parent?.getElementsByTagName('*')||[]).find(x=>x.localName===name)||null;}
function xmlEls(parent,name){return Array.from(parent?.getElementsByTagName('*')||[]).filter(x=>x.localName===name);}
function epubHtmlText(xhtml){
  const doc=new DOMParser().parseFromString(xhtml,'text/html');
  const body=doc.body;if(!body)return {title:'',text:''};
  for(const bad of body.querySelectorAll('style,script,nav,svg,aside[epub\\:type="footnote"]'))bad.remove();
  const blocks=Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre'));
  const selected=blocks.filter(n=>!blocks.some(x=>x!==n&&x.contains(n)));
  function value(node){let s='';for(const child of node.childNodes){if(child.nodeType===3)s+=child.nodeValue;else if(child.nodeType===1){if(child.tagName.toLowerCase()==='br')s+='\n';else s+=value(child);}}return s.replace(/[ \t\u00a0]+/g,' ').replace(/[ \t]*\n[ \t]*/g,'\n').trim();}
  const chunks=selected.map(value).filter(Boolean);
  if(!chunks.length){const plain=body.textContent?.trim();if(plain)chunks.push(plain.replace(/\s+/g,' '));}
  const heading=selected.find(el=>/^H[1-6]$/.test(el.tagName));
  return {title:heading?value(heading):'',text:chunks.join('\n').replace(/\n{3,}/g,'\n\n')};
}
async function parseEpub(file){
  if(!globalThis.JSZip)throw Error('EPUB 解壓程式未載入，請重新整理網頁');
  let zip;try{zip=await globalThis.JSZip.loadAsync(await file.arrayBuffer());}catch{throw Error('EPUB 壓縮檔讀取失敗');}
  const containerFile=zip.file('META-INF/container.xml');if(!containerFile)throw Error('找不到 EPUB 的 container.xml');
  const containerXml=new DOMParser().parseFromString(await containerFile.async('string'),'application/xml');
  const rootfile=xmlEl(containerXml,'rootfile');const opfPath=rootfile?.getAttribute('full-path');if(!opfPath)throw Error('EPUB 缺少 OPF 位置');
  const opfFile=zip.file(opfPath);if(!opfFile)throw Error('找不到 EPUB 書籍目錄');
  const opf=new DOMParser().parseFromString(await opfFile.async('string'),'application/xml');
  const base=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')):'';
  const meta=xmlEl(opf,'metadata');
  const title=xmlEl(meta,'title')?.textContent?.trim()||titleFromFilename(file.name);
  const author=xmlEl(meta,'creator')?.textContent?.trim()||'';
  const manifest=new Map(xmlEls(opf,'item').map(n=>[n.getAttribute('id'),{href:n.getAttribute('href')||'',type:n.getAttribute('media-type')||'',props:n.getAttribute('properties')||''}]));
  let coverItem=[...manifest.values()].find(it=>it.props.split(' ').includes('cover-image'));
  if(!coverItem){const coverId=xmlEls(meta,'meta').find(n=>n.getAttribute('name')==='cover')?.getAttribute('content');coverItem=manifest.get(coverId);}
  if(!coverItem)coverItem=[...manifest.values()].find(it=>/cover/i.test(it.href)&&/^image\//.test(it.type));
  let cover='';if(coverItem){const entry=zip.file(pathJoin(base,coverItem.href));if(entry){const bytes=await entry.async('base64');const type=coverItem.type||'image/jpeg';if(['image/jpeg','image/png','image/webp','image/gif'].includes(type))cover=`data:${type};base64,${bytes}`;}}
  // EPUB 3 navigation document, when provided, supplies more meaningful TOC titles.
  const navFile=[...manifest.values()].find(it=>it.props.split(' ').includes('nav'));
  const tocNames=new Map();
  if(navFile){
    const navPath=pathJoin(base,navFile.href);const f=zip.file(navPath);
    if(f){const d=new DOMParser().parseFromString(await f.async('string'),'text/html');const nbase=navPath.includes('/')?navPath.slice(0,navPath.lastIndexOf('/')):'';
      for(const a of d.querySelectorAll('nav a')){const href=a.getAttribute('href');const text=a.textContent?.trim();if(href&&text){const k=pathJoin(nbase,href);if(!tocNames.has(k))tocNames.set(k,text);}}
    }
  }
  const spine=xmlEls(opf,'itemref');const chapters=[];
  for(const ref of spine){
    const item=manifest.get(ref.getAttribute('idref'));if(!item)continue;
    if(!/xhtml|html/.test(item.type)&&!/\.(xhtml|html|htm)$/i.test(item.href))continue;
    const path=pathJoin(base,item.href);const entry=zip.file(path);if(!entry)continue;
    const parsed=epubHtmlText(await entry.async('string'));
    if(!parsed.text.trim())continue;
    chapters.push({title:tocNames.get(path)||parsed.title||`第 ${chapters.length+1} 章`,text:parsed.text});
  }
  if(!chapters.length)throw Error('EPUB 沒有可讀取的文字章節');
  return {title,author,format:'EPUB',cover,chapters:splitLongChapters(chapters)};
}
