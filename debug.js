(() => {
 const nativeFetch=window.fetch.bind(window), archived=!!(window.LAYOUT_ARCHIVE || window.LAYOUT_STATIC);
 const inlineDebug=!window.LAYOUT_STATIC && new URLSearchParams(location.search).has('debug');
 let raw,items,audios={},style=localStorage.getItem('task-mark-style')||'symbols';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 window.fetch=async (url,options)=>{
  const response=await nativeFetch(url,options);
  if((String(url)==='/api/board'||String(url).endsWith('/board.json'))&&!options?.method){raw=await response.clone().json();const b=structuredClone(raw),hidden=new Set(inlineDebug?[]:b.debug_hidden||[]);
   b.preview_groups?.forEach(g=>g.items=g.items.filter(e=>!hidden.has(e.id)));
   b.panes?.forEach(g=>g.items=g.items.filter(e=>!hidden.has(e.id)));b.preview_groups=b.preview_groups?.filter(g=>g.items.length);b.panes=b.panes?.filter(g=>g.items.length);
   b.longform=b.longform?.filter(e=>!hidden.has(e.id||e.item?.id));
   return new Response(JSON.stringify(b),{headers:{'Content-Type':'application/json'}});
  }return response;
 };
 const names={RefA2VA:['◉ + ♫ → ▷ ♫','01 · Voice reference','借声音生成','参考声音：借鉴音色，生成新的语音与视频'],Ref2VA:['◉ → ▷ ♫','02 · Image only','从图片生成','无需输入音频：生成语音与视频'],RefA2V:['◉ + ♪ → ▷','03 · Audio driven','按录音驱动','原始录音：按输入语音驱动视频']};
 function decorate(){
  if(inlineDebug&&!archived)inlineControls();
  document.querySelectorAll('[data-task-choice]').forEach((el,i)=>{const task=raw?.preview_groups?.[i]?.task,info=names[task];if(!info)return;let tag=el.querySelector('.task-mark');if(!tag){tag=document.createElement('b');tag.className='task-mark';el.prepend(tag);}const text=info[style==='numbers'?1:style==='plain'?2:0];if(tag.textContent!==text)tag.textContent=text;tag.style.color=['#326b58','#9b652c','#5e62a1'][i];});
  document.querySelectorAll('#section-pane-compare-one-reference .layout-compare-panel').forEach(card=>{if(card.parentElement.querySelector('.input-audio-compare'))return;const item=items?.find(i=>i.id===card.dataset.item),entry=audios[card.dataset.item];if(!item)return;const box=document.createElement('div');box.className='input-audio-compare';if(item.task==='Ref2VA'){box.innerHTML='<span class="input-audio-label">Voice described in prompt</span>';}else if(entry){const label=item.task==='RefA2V'?'Driving speech':'Voice reference';box.dataset.audioSrc=window.LAYOUT_STATIC?(window.LAYOUT_URLS[entry.url]||entry.url):entry.url;box.innerHTML=`<span class="input-audio-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4"/></svg>${label}</span><div class="input-audio-controls"><button type="button" data-input-audio-toggle aria-label="Play ${label}">▶</button><input type="range" min="0" max="1000" value="0" aria-label="Seek ${label}" data-input-audio-seek><small data-input-audio-time>0:00 / --:--</small><audio preload="none"></audio></div>`;}else{box.innerHTML='<span class="input-audio-label">Audio unavailable</span>';}card.after(box);});

 }

 let selectionQueue=Promise.resolve(),choiceSerial=0;
 function addChoice(parent,id,after=false){
  if(!parent||!id)return;let bar=after?[...parent.parentElement.children].find(el=>el.classList.contains('inline-choice')&&el.dataset.owner===parent.dataset.choiceOwner):parent.querySelector(':scope > .inline-choice');
  if(after&&!parent.dataset.choiceOwner){parent.dataset.choiceOwner='owner-'+(++choiceSerial);bar=null;}
  if(!bar?.classList.contains('inline-choice')){bar=document.createElement('div');bar.className='inline-choice';if(after)bar.dataset.owner=parent.dataset.choiceOwner;after?parent.after(bar):parent.append(bar);}
  const hidden=(raw?.debug_hidden||[]).includes(id),key=id+':'+hidden;if(bar.dataset.key===key)return;bar.dataset.key=key;
  bar.innerHTML=`<span>${esc(id)}</span><button data-decide="${esc(id)}" data-retain="yes" aria-pressed="${!hidden}">✓ 保留</button><button data-decide="${esc(id)}" data-retain="no" aria-pressed="${hidden}">✕ 不要</button><small>${hidden?'已排除 · 筛选模式仍可查看':'展示中'}</small>`;
 }
 function inlineControls(){
  addChoice(document.querySelector('.task-deck'),document.querySelector('.deck-card.is-current')?.dataset.item,true);
  addChoice(document.querySelector('.task-gallery-info'),document.querySelector('.task-gallery-card.is-active')?.dataset.item,true);
  document.querySelectorAll('.layout-card[data-drop-item]').forEach(el=>addChoice(el,el.dataset.dropItem));
  document.querySelectorAll('.layout-compare-panel').forEach(el=>addChoice(el,el.dataset.item,true));
  const selected=document.querySelector('[data-long-choice][aria-pressed="true"]'),entry=raw?.longform?.[Number(selected?.dataset.longChoice)];
  addChoice(document.querySelector('.longform-screen'),entry?.id||entry?.item?.id,true);
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-decide]');if(!b)return;e.preventDefault();e.stopPropagation();const id=b.dataset.decide,retain=b.dataset.retain==='yes',bar=b.closest('.inline-choice');bar.querySelector('small').textContent='保存中…';
  selectionQueue=selectionQueue.then(async()=>{
   const latest=await(await nativeFetch('/api/board')).json(),hidden=new Set(latest.debug_hidden||[]);retain?hidden.delete(id):hidden.add(id);latest.debug_hidden=[...hidden];
   const result=await nativeFetch('/api/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(latest)});
   if(!result.ok)throw Error('保存失败 '+result.status);raw=await result.json();bar.dataset.key='';inlineControls();
  }).catch(err=>{bar.querySelector('small').textContent=err.message+'，请重试';});
 });
 document.addEventListener('click',e=>{const b=e.target.closest('button[data-audio-src]');if(!b)return;const a=b.nextElementSibling;if(!a.paused){a.pause();return;}if(!a.hasAttribute('src'))a.src=b.dataset.audioSrc;a.play().catch(()=>{});});
 const clock=seconds=>Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'--:--';
 document.addEventListener('click',e=>{const b=e.target.closest('[data-input-audio-toggle]');if(!b)return;const box=b.closest('.input-audio-compare'),audio=box.querySelector('audio');if(!audio.paused){audio.pause();return;}if(!audio.hasAttribute('src'))audio.src=box.dataset.audioSrc;audio.play().catch(()=>{});});
 document.addEventListener('input',e=>{if(!e.target.matches('[data-input-audio-seek]'))return;const audio=e.target.closest('.input-audio-compare').querySelector('audio');if(Number.isFinite(audio.duration))audio.currentTime=audio.duration*Number(e.target.value)/1000;});
 ['play','pause','timeupdate','durationchange','ended'].forEach(type=>document.addEventListener(type,e=>{const audio=e.target;if(!audio.matches?.('.input-audio-compare audio'))return;const box=audio.closest('.input-audio-compare'),button=box.querySelector('[data-input-audio-toggle]');button.textContent=audio.paused?'▶':'❚❚';button.setAttribute('aria-label',`${audio.paused?'Play':'Pause'} ${box.querySelector('.input-audio-label').textContent}`);box.querySelector('[data-input-audio-seek]').value=Number.isFinite(audio.duration)&&audio.duration?Math.round(audio.currentTime/audio.duration*1000):0;box.querySelector('[data-input-audio-time]').textContent=`${clock(audio.currentTime)} / ${clock(audio.duration)}`;},true));
 const panel=document.createElement('dialog');panel.className='debug-panel';
 async function open(){
  raw=await (await nativeFetch('/api/board')).json();items=items||await (await nativeFetch('/_layout/items.json')).json();const hidden=new Set(raw.debug_hidden||[]),ids=new Set(),rows=[];
  [...raw.preview_groups.flatMap(g=>g.items),...raw.panes.flatMap(g=>g.items),...raw.longform].forEach(e=>{const id=e.id||e.item?.id;if(!id||ids.has(id))return;ids.add(id);const item=items.find(x=>x.id===id),poster=e.poster||item?.poster;rows.push(`<label class="debug-row"><input type="checkbox" data-keep="${esc(id)}" ${hidden.has(id)?'':'checked'}><img src="${esc(poster)}" loading="lazy"><span>${esc(e.title||id)}<small>${esc(e.collection==='extended'?'长视频':e.collection==='languages'?'多语言':item?.task)} · ${Math.round((e.duration||item?.duration||0)/60)} min</small></span><button type="button" data-inspect="${esc(id)}">预览</button></label>`);});
  panel.innerHTML=`<header><h2>Debug · 素材筛选</h2><button data-close-debug>关闭</button></header><p>勾选保留，取消勾选隐藏。原始文件不会删除，随时可以恢复。</p><label>任务标识方案 <select data-mark-style><option value="symbols">A · 输入输出符号</option><option value="numbers">B · 编号 + 简称</option><option value="plain">C · 中文用途</option></select></label><div class="debug-preview"></div><div class="debug-list">${rows.join('')}</div><footer><button data-save-debug ${archived?'disabled':''}>保存筛选并刷新</button><span data-debug-status></span></footer>`;
  panel.querySelector('select').value=style;panel.showModal();
 }
 document.addEventListener('click',async e=>{
  if(e.target.closest('[data-debug-open]')){const u=new URL(location.href);inlineDebug?u.searchParams.delete('debug'):u.searchParams.set('debug','1');location.href=u.href;}
  if(e.target.closest('[data-close-debug]')){panel.querySelectorAll('video').forEach(v=>v.pause());panel.close();}
  const inspect=e.target.closest('[data-inspect]');if(inspect){e.preventDefault();const id=inspect.dataset.inspect,d=raw.longform.find(x=>x.id===id),i=items.find(x=>x.id===id);panel.querySelector('.debug-preview').innerHTML=`<video controls autoplay src="${esc(d?.src||i?.weights[i.default_weight])}"></video>`;}
  if(e.target.closest('[data-save-debug]')){const hide=[...panel.querySelectorAll('[data-keep]:not(:checked)')].map(e=>e.dataset.keep);const allHidden=xs=>xs.every(e=>hide.includes(e.id||e.item?.id));if(raw.preview_groups.some(g=>allHidden(g.items))||raw.panes.filter(p=>p.id.startsWith('pane-action-')).some(g=>allHidden(g.items))||['extended','languages'].some(c=>allHidden(raw.longform.filter(e=>e.collection===c)))){panel.querySelector('[data-debug-status]').textContent='每个任务和长视频分区至少保留一条。';return;}
   const latest=await(await nativeFetch('/api/board')).json();latest.debug_hidden=hide;const result=await nativeFetch('/api/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(latest)});if(result.ok)location.reload();else panel.querySelector('[data-debug-status]').textContent='保存失败，请重试。';}
 });
 document.addEventListener('change',e=>{if(e.target.matches('[data-mark-style]')){style=e.target.value;localStorage.setItem('task-mark-style',style);decorate();}});
 document.addEventListener('DOMContentLoaded',async()=>{
  if(new URLSearchParams(location.search).has('record'))document.body.classList.add('recording');document.body.append(panel);const button=document.createElement('button');button.dataset.debugOpen='';button.className='debug-launch';button.textContent=inlineDebug?'结束筛选':'Debug · Filter videos';if(!archived)document.body.append(button);
  items=await(await nativeFetch(window.LAYOUT_STATIC?'data/items.json':window.LAYOUT_ARCHIVE?window.LAYOUT_ARCHIVE+'/items.json':'/_layout/items.json')).json();try{audios=await(await nativeFetch(window.LAYOUT_STATIC?'data/task-audio.json':'/assets/task-audio-r008.json')).json();}catch{}
  new MutationObserver(()=>decorate()).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});decorate();
 });
})();
