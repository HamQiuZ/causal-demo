(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const weightName = weight => {
    if (/^e121g\d+$/i.test(weight)) return weight.replace(/e121g/i, "Exp121 g");
    if (/seko/i.test(weight)) return "Seko";
    return weight || "Weight pending";
  };
  const staticSite = !!window.LAYOUT_STATIC;
  const siteAsset = path => staticSite ? (window.LAYOUT_URLS[path] || path) : path;
  let board, library, byId, ringPosters = {}, optimizedImages = {}, edit = !staticSite && !window.LAYOUT_ARCHIVE && !new URLSearchParams(location.search).has("view"), drawerOpen = true;
  let selected = {}, drag = null, saveQueue = Promise.resolve(), activeCompare = null;
  const originalPrompts = new Map();
  let promptSerial = 0;
  const originalTextView = () => edit || (!staticSite && new URLSearchParams(location.search).has("debug"));
  const containsCJK = text => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
  const displayText = value => {
    const text=String(value??"");
    if(originalTextView()||!containsCJK(text))return text;
    const english=text.replace(/<d>[^<]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}][^<]*<\/d>/gu,"[Original-language speech]")
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu,"[Original-language text]");
    const words=(text.replace(/<[^>]*>/g,"").match(/\b[A-Za-z]{2,}\b/g)||[]);
    return words.length>=5?english:"Prompt in original language";
  };
  const filters = {set: "", task: "", image: "", unused: false};
  const banner = document.createElement("div");
  banner.className = "layout-banner";
  const toolbar = document.createElement("div");
  toolbar.className = "layout-toolbar";
  banner.append(toolbar);
  const drawer = document.createElement("aside");
  drawer.className = "layout-drawer";
  drawer.setAttribute("aria-label", "Demo library");
  const dialog = document.createElement("dialog");
  dialog.className = "layout-dialog";
  const promptDialog = document.createElement("dialog");
  promptDialog.className = "layout-dialog original-prompt-dialog";
  promptDialog.innerHTML = '<div class="layout-dialog-header"><h2>Original prompt</h2><button type="button" data-close-original-prompt>Close ✕</button></div><pre></pre><button type="button" data-copy-original-modal>Copy original prompt</button>';
  document.body.prepend(banner, drawer);
  document.body.append(dialog, promptDialog);
  new ResizeObserver(() => document.documentElement.style.setProperty("--layout-banner-height", `${banner.offsetHeight}px`)).observe(banner);
  const railObserver = new ResizeObserver(entries => entries.forEach(({target}) => {
    target.closest(".layout-rail")?.style.setProperty("--rail-player-height", `${target.offsetHeight}px`);
  }));
  const lazyPosters = new IntersectionObserver(entries=>entries.forEach(({target,isIntersecting})=>{
    if(!isIntersecting)return;
    const url=target.dataset.poster;target.poster=url;
    if(target.matches("[data-long-video]"))target.parentElement.style.setProperty("--long-poster",`url(${JSON.stringify(url)})`);
    delete target.dataset.poster;lazyPosters.unobserve(target);
  }),{rootMargin:"300px"});
  const watchVideoPosters = () => document.querySelectorAll("video[data-poster]").forEach(video=>lazyPosters.observe(video));

  const isInputVideo = media => media instanceof HTMLVideoElement && !edit &&
    !!media.closest("#section-pane-compare-one-reference") && media.matches("[data-compare-video]");
  function unloadMedia(media) {
    media.pause();
    media.classList.remove("is-ready");
    const play=media.parentElement?.querySelector(".layout-play");if(play)play.hidden=false;
    if (media.hasAttribute("src")) { media.removeAttribute("src"); media.load(); }
  }
  function selectAudible(media) {
    if (media.muted) return;
    document.querySelectorAll("audio,video").forEach(other => {
      if (other === media) return;
      if (isInputVideo(other)) other.muted = true;
      else if(other.closest("dialog[open]"))other.pause();else unloadMedia(other);
    });
  }
  document.addEventListener("play", event => {
    const media=event.target;
    if (!(media instanceof HTMLMediaElement)) return;
    if (media.classList.contains("hero-background-video") &&
        [...document.querySelectorAll("audio,video")].some(v=>v!==media&&!v.paused)) { media.pause(); return; }
    if (isInputVideo(media)) {
      if (!media.muted) selectAudible(media);
      return;
    }
    if (media instanceof HTMLAudioElement) {
      document.querySelectorAll("audio,video").forEach(other=>{
        if(other===media)return;
        if(isInputVideo(other))other.muted=true;else if(other.closest("dialog[open]"))other.pause();else unloadMedia(other);
      });
      return;
    }
    document.querySelectorAll("audio,video").forEach(other=>{if(other!==media){if(other.closest("dialog[open]"))other.pause();else unloadMedia(other);}});
  }, true);
  function stopVideos() {
    document.querySelector(".hero-background-video")?.pause();
    if (activeCompare) clearCompare(activeCompare.row);
    document.querySelectorAll("audio[src]").forEach(audio=>{audio.pause();audio.removeAttribute("src");audio.load();});
    document.querySelectorAll("video[src]:not(.hero-background-video)").forEach(video => {
      video.pause();
      video.classList.remove("is-ready");
      video.removeAttribute("src");
      video.load();
      const play = video.parentElement.querySelector(".layout-play");
      if (play) play.hidden = false;
    });
  }
  function save() {
    if (staticSite) return;
    const snapshot = JSON.stringify(board);
    saveQueue = saveQueue.then(async () => {
      const response = await fetch("/api/board", {method: "POST", headers: {"Content-Type": "application/json"}, body: snapshot});
      if (!response.ok) throw Error(`Save failed (${response.status})`);
      const data = await response.json();
      board.updated = data.updated;
      document.querySelectorAll(".layout-save-status").forEach(el => { el.textContent = "Saved"; });
    }).catch(error => {
      document.querySelectorAll(".layout-save-status").forEach(el => { el.textContent = error.message; el.classList.add("layout-error"); });
    });
  }
  const paneById = id => id === "pane-task-gallery" ? taskGalleryPane() : id === "pane-compare-one-reference" ? comparisonPane() : id === "preview-tasks" ? {id, mode:"compare", items:board.preview_groups?.flatMap(g=>g.items) || board.preview || []} : id === "longform-items" ? {id,mode:"compare",items:board.longform.filter(d=>d.item).map(d=>d.item)} : id === "scene-examples" ? scenePane() : board.panes.find(p => p.id === id);
  const taskNames = {RefA2VA:"Reference Image and Reference Audio → Video and Audio", Ref2VA:"Reference Image → Video and Audio", RefA2V:"Reference Image and Audio → Video"};
  const fullTask = text => String(text || "").replace(/RefA2VA|RefA2V|Ref2VA/g, key => taskNames[key]);
  const placements = id => board.panes.filter(p => p.items.some(i => i.id === id));
  const placement = id => placements(id)[0];
  const duration = item => item.duration == null ? "duration unknown" : `${Math.round(item.duration)} s`;
  const caption = (entry, item) => fullTask(entry.caption || item.caption || item.task);
  const imageAsset = url => {
    const optimized = !staticSite && optimizedImages[url];
    return optimized ? (window.LAYOUT_ARCHIVE || "") + optimized.path : url;
  };
  const poster = (entry, item) => imageAsset(item.posters[entry.weight] || item.poster);
  const hasVideo = (entry, item) => !!item.weights[entry.weight];
  const grouped = pane => pane.mode === "rail" && pane.group_by_reference !== false;
  const setName = set => set === "legacy_g700" ? "More examples" : set;
  function tags(entry, item) {
    return entry.caption || item.caption ? `<div class="layout-tags"><span class="layout-tag">${escape(duration(item))}</span></div>` : "";
  }
  function player(entry, item, pane) {
    const available = hasVideo(entry, item);
    return `<div class="layout-player ${escape(item.orientation)}" style="--aspect:${item.width / item.height};--rail-max-width:${78 * item.width / item.height}vh">
      <video controls preload="none" playsinline data-poster="${escape(poster(entry,item))}" data-player="${escape(pane.id)}:${escape(item.id)}"></video>
      ${available ? `<button class="layout-play" data-action="play" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}" aria-label="Play ${escape(caption(entry,item))}">▶</button>` : '<span class="layout-missing">not run yet</span>'}
    </div>`;
  }
  function inspector(pane, entry, item, index) {
    if (!edit) return "";
    const weights = Object.entries(item.weights).map(([weight, url]) =>
      `<option value="${escape(weight)}" ${entry.weight === weight ? "selected" : ""} ${url ? "" : "disabled"}>${escape(weightName(weight))}${url ? "" : " · not run yet"}</option>`).join("");
    const labels = ["", "Keep", "Maybe", "Drop"].map(label => `<option ${entry.label === label ? "selected" : ""}>${escape(label)}</option>`).join("");
    return `<details class="layout-inspector"><summary>Edit ${escape(item.id)} · move / remove</summary>
      <div class="layout-edit">
        <div class="layout-edit-row">
          <label><span>Weight</span><select data-item-field="weight" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}">${weights}</select></label>
          <label><span>Label</span><select data-item-field="label" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}">${labels}</select></label>
          <label><span>Caption</span><input data-item-field="caption" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}" value="${escape(entry.caption)}"></label>
          <label><span>Comment</span><textarea rows="2" data-item-field="comment" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}">${escape(entry.comment)}</textarea></label>
        </div><div class="layout-pane-controls">
          <button data-action="item-up" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}" ${index === 0 ? "disabled" : ""}>↑</button>
          <button data-action="item-down" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}" ${index === pane.items.length - 1 ? "disabled" : ""}>↓</button>
          <button data-action="remove" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}">Remove</button>
        </div>
      </div></details>`;
  }
  function card(pane, entry, index, rail, group = null) {
    const item = byId[entry.id];
    if (!item) return "";
    const inside = rail ? `<button class="layout-rail-card ${selected[pane.id] === entry.id ? "selected" : ""}" data-action="select" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}">
      <img loading="lazy" decoding="async" src="${escape(poster(entry,item))}" alt=""><span><strong>${escape(group ? item.image_id : caption(entry,item))}</strong>${group ? `<small>${group.length} variant${group.length === 1 ? "" : "s"}</small>` : ""}${tags(entry,item)}${hasVideo(entry,item) ? "" : "<small>not run yet</small>"}</span></button>` :
      `${player(entry,item,pane)}<button class="source-prompt-link" data-action="compare-open" data-pane="${escape(pane.id)}" data-item="${escape(item.id)}">View prompts ↗</button>`;
    return `<div class="layout-card" style="--card-aspect:${item.width / item.height}" data-drop-pane="${escape(pane.id)}" data-drop-item="${escape(item.id)}" ${edit ? `draggable="true" data-drag-pane="${escape(pane.id)}" data-drag-item="${escape(item.id)}"` : ""}>${inside}${group ? "" : inspector(pane,entry,item,index)}</div>`;
  }
  function prompts(item) {
    const parts = (item.prompt || "").split(/\nMOTION SEGMENTS\n=+\n/);
    const global = parts[0].replace(/^GLOBAL PROMPT\n=+\n/, "");
    const motion = parts[1] || (item.segments || []).map(s => `[${(s.start_frame / 24).toFixed(2)} s]\n${s.prompt || ""}`).join("\n\n");
    const detail=(title,value)=>{
      value=value||"Not available in this source.";
      const shown=displayText(value),changed=shown!==value,id=changed?`prompt-${++promptSerial}`:"";
      if(changed)originalPrompts.set(id,value);
      return `<details><summary>${title}</summary>${changed&&shown!=="Prompt in original language"?'<small>Original-language text is omitted from this English view.</small>':''}<pre>${escape(shown)}</pre>${changed?`<div class="original-prompt-actions"><button type="button" data-copy-prompt="${id}">Copy original prompt</button><button type="button" data-view-original-prompt="${id}">View original prompt</button></div>`:''}</details>`;
    };
    return `<div class="layout-prompts">${detail("Global prompt",global)}${detail("Motion prompt",motion)}</div>`;
  }
  let promptOverrides={},extraItems=[],longChapters={},promptLoad=null;
  function ensurePrompts(){
    if(!promptLoad){
      const url=staticSite?"data/prompts.json":window.LAYOUT_ARCHIVE?window.LAYOUT_ARCHIVE+"/prompts.json":"/assets/prompts-r022.json";
      promptLoad=fetch(url).then(r=>{if(!r.ok)throw Error("Prompts unavailable");return r.json();}).then(data=>{promptOverrides=data||{};return true;})
        .catch(()=>{promptLoad=null;return false;});
    }
    return promptLoad;
  }
  function taskGalleryPane(){
    const pane=board.panes.find(p=>p.id==='pane-task-gallery');if(!pane)return pane;
    const have=new Set(pane.items.map(e=>e.id)),items=[...pane.items];
    extraItems.filter(i=>!have.has(i.id)&&!board.debug_hidden?.includes(i.id)).forEach((i,k)=>items.splice(Math.min(items.length,2+k*5),0,{id:i.id,weight:i.default_weight,caption:'',label:'',comment:'',width:i.width,height:i.height,reference_url:i.reference_url,input_audio_url:null}));
    return {...pane,items};
  }
  const promptRecord=item=>{
    const o=promptOverrides[item.id];
    const parts=(item.prompt||"").split(/\nMOTION SEGMENTS\n=+\n/);
    let global=parts[0].replace(/^GLOBAL PROMPT\n=+\n/,"").trim();
    let segs=(item.segments||[]).filter(s=>s.prompt||s.line||s.action).map(s=>({t:(s.start_frame||0)/24,text:s.prompt||[s.action,s.line].filter(Boolean).join(" ")}));
    if(!segs.length&&parts[1])segs=parts[1].split(/\n\s*\n/).map(b=>{b=b.trim();const m=b.match(/^\[([\d.]+) s\]\n?([\s\S]*)$/)||b.match(/^\[[^\]]*?([\d.]+)\s*[–-][\d.]+ s\]\n?([\s\S]*)$/);return m?{t:+m[1],text:m[2].trim()}:{t:0,text:b};}).filter(x=>x.text);
    if(o){if(o.global)global=o.global;if(o.motion?.length)segs=o.motion.map(m=>({t:+m.start_s||0,text:m.text||""}));}
    return {global,segs,source:o?.source||"",status:o?.status||(global?"ok":"missing")};
  };
  const fmtPrompt=text=>{
    let h=escape(text);
    h=h.replace(/&lt;d&gt;\s*(?:\[([A-Za-z -]+)\])?\s*([\s\S]*?)&lt;\/d&gt;/g,(_,lang,line)=>`<q class="pt-line">${lang?`<small>${lang}</small>`:''}${line}</q>`);
    h=h.replace(/&lt;(Subject|Picture|Audio|Image)\s*(\d+)&gt;/g,'<span class="pt-ref pt-ref-$1">$1 $2</span>');
    h=h.replace(/\[Shot (\d+)\]/g,'<span class="pt-shot">Shot $1</span>');
    h=h.replace(/\((S\d+)\)/g,'<span class="pt-speaker">$1</span>');
    return h;
  };
  const fmtTime=t=>`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;
  function promptBlock(value){
    const shown=displayText(value);
    if(shown===value)return null;
    const id=`prompt-${++promptSerial}`;originalPrompts.set(id,value);
    return {shown,id};
  }
  function globalHtml(global){
    if(!global)return '<p class="pt-missing">This run was generated without a separate scene prompt.</p>';
    const alt=promptBlock(global);
    if(alt&&alt.shown==="Prompt in original language")return `<div class="pt-original"><p>Written in its original language.</p><div class="original-prompt-actions"><button type="button" data-copy-prompt="${alt.id}">Copy original</button><button type="button" data-view-original-prompt="${alt.id}">View original</button></div></div>`;
    const text=alt?alt.shown:global;
    const rows=text.split(/\n+/).map(l=>l.trim()).filter(l=>l&&!/^=+$|^GLOBAL PROMPT$/.test(l));
    return rows.map(l=>{const m=l.match(/^([A-Za-z][\w ]{1,40}):\s*(.*)$/);return m&&m[2]?`<p class="pt-field"><b>${escape(m[1].replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</b>${fmtPrompt(m[2])}</p>`:m?`<h4 class="pt-group">${escape(m[1].replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}</h4>`:`<p>${fmtPrompt(l)}</p>`;}).join('')+(alt?`<div class="original-prompt-actions"><button type="button" data-copy-prompt="${alt.id}">Copy original</button></div>`:'');
  }
  function promptPanel(entry,item){
    const r=promptRecord(item),copyId=`prompt-${++promptSerial}`;
    originalPrompts.set(copyId,[r.global&&`GLOBAL PROMPT\n${r.global}`,r.segs.length&&`MOTION PROMPTS\n${r.segs.map(s=>`[${s.t.toFixed(2)} s] ${s.text}`).join('\n')}`].filter(Boolean).join('\n\n'));
    const sentences=t=>{const keep=[];const x=t.replace(/<d>[\s\S]*?<\/d>/g,m=>`\u0000${keep.push(m)-1}\u0000`);return x.split(/(?<=[.!?])\s+(?=[\[<A-Z])/).map(z=>z.replace(/\u0000(\d+)\u0000/g,(_,k)=>keep[+k]).trim()).filter(Boolean);};
    const split=r.segs.map(s=>sentences(s.text)),freq=new Map();
    split.forEach(list=>new Set(list).forEach(z=>freq.set(z,(freq.get(z)||0)+1)));
    const shared=r.segs.length>2?[...freq].filter(([z,n])=>n>=Math.ceil(r.segs.length*.6)&&!/<d>/.test(z)).map(([z])=>z):[];
    const sharedSet=new Set(shared);
    r.segs=r.segs.map((s,i)=>({...s,text:shared.length?split[i].filter(z=>!sharedSet.has(z)).join(' '):s.text}));
    const setup=shared.length?`<div class="pt-setup"><b>Every step</b><p>${fmtPrompt(displayText(shared.join(' ')))}</p></div>`:'';
    const segs=r.segs.map((s,i)=>{const alt=promptBlock(s.text);return `<li class="pt-seg" data-seg-t="${s.t}" tabindex="0" role="button" aria-label="Jump to ${fmtTime(s.t)}"><span class="pt-time">${fmtTime(s.t)}</span><div>${alt&&alt.shown==='Prompt in original language'?`<p class="pt-missing">Original-language segment</p>`:`<p>${fmtPrompt(alt?alt.shown:s.text)}</p>`}</div></li>`;}).join('');
    const audio=entry.input_audio_url?`<button type="button" class="pt-chip pt-audio" data-audio-src="${escape(entry.input_audio_url)}">${icon('audio')}${item.task==='RefA2VA'?'Voice reference':'Driving speech'}</button><audio preload="none"></audio>`:item.task==='Ref2VA'?`<span class="pt-chip">${icon('voice')}Voice described in prompt</span>`:'';
    return `<div class="pt-panel task-${escape(item.task)}">
      <div class="pt-meta"><span class="pt-task">${escape(taskSpecs[item.task]?.[0]||fullTask(item.task))}</span><span class="pt-chip">${escape(duration(item))}</span>${audio}<button type="button" class="pt-chip pt-copy" data-copy-prompt="${copyId}">Copy prompts</button></div>
      <section class="pt-card"><h3>Scene</h3>${globalHtml(r.global)}</section>
      <section class="pt-card"><h3>Performance timeline <small>click a step to jump</small></h3>${segs?`${setup}<ol class="pt-timeline">${segs}</ol>`:'<p class="pt-missing">No timed motion prompts for this run.</p>'}</section>
    </div>`;
  }
  function mainContent(pane, entry) {
    const item = byId[entry.id];
    const variants = grouped(pane) ? pane.items.filter(e => byId[e.id]?.image_id === item.image_id) : [];
    const chips = variants.length ? `<div class="layout-variants" aria-label="Reference image variants">${variants.map(e => {
      const variant = byId[e.id];
      const duration = variant.duration == null ? "duration unknown" : `${Math.round(variant.duration * 10) / 10}s`;
      return `<button class="layout-variant ${e.id === entry.id ? "selected" : ""}" data-action="select" data-pane="${escape(pane.id)}" data-item="${escape(e.id)}" aria-pressed="${e.id === entry.id}" data-drop-pane="${escape(pane.id)}" data-drop-item="${escape(e.id)}" ${edit ? `draggable="true" data-drag-pane="${escape(pane.id)}" data-drag-item="${escape(e.id)}"` : ""}>${escape(`${e.id} · ${duration} · ${variant.task}`)}${hasVideo(e,variant) ? "" : " · not run yet"}</button>`;
    }).join("")}</div>` : "";
    return `<div class="layout-main">${player(entry,item,pane)}
      ${chips}
      
      ${prompts(item)}
      ${pane.mode === "hero" || pane.mode === "compare" || grouped(pane) ? inspector(pane,entry,item,pane.items.indexOf(entry)) : ""}</div>`;
  }
  function actionPath(entry, item) {
    const parts = caption(entry, item).split(" → ");
    return parts.map((part, index) => `<span class="layout-action-step" data-step="${index}">${escape(part)}</span>`).join(" → ");
  }
  function compareContent(pane, entries) {
    const isAction = entries.every(e => byId[e.id].segments?.some(s => s.action));
    const branch = isAction ? byId[entries[0].id].segments[1].start_frame / 24 : 0;
    const panels = entries.map(entry => {
      const item = byId[entry.id], available = hasVideo(entry, item);
      const action = item.segments?.some(segment => segment.action);
      const time = duration(item), label = action ? item.segments[1].action : fullTask(item.task);
      return `<div class="layout-compare-unit">${!isAction ? `<h3 class="compare-task-name">${taskLabel(item.task)}</h3>` : ""}<div class="layout-compare-panel" role="button" tabindex="0" data-action="compare-open" data-pane="${escape(pane.id)}" data-item="${escape(entry.id)}" data-drop-pane="${escape(pane.id)}" data-drop-item="${escape(entry.id)}" ${edit ? `draggable="true" data-drag-pane="${escape(pane.id)}" data-drag-item="${escape(entry.id)}"` : ""} aria-label="${escape(`${label}, ${time}. Preview and open player`)}">
        <div class="layout-compare-media">
          <img loading="lazy" decoding="async" src="${escape(poster(entry,item))}" alt="">
          <video preload="none" muted playsinline data-compare-video></video>
        </div>
        <div class="layout-compare-shade"></div>
        <div class="layout-compare-label"><strong data-current-action="${escape(entry.id)}">${escape(label)}</strong>
          
          ${available ? "" : "<small>not run yet</small>"}</div>
        ${available ? `<button type="button" class="layout-compare-mute" data-action="compare-mute" data-pane="${escape(pane.id)}" data-item="${escape(entry.id)}" aria-label="Unmute preview">🔇</button>` : ""}
      </div>${item.segments?.length ? `<div class="layout-compare-inline">${action ? `<p class="layout-action-path" data-path-item="${escape(entry.id)}">${actionPath(entry,item)}</p>` : ""}<p class="layout-compare-segment" data-inline-segment="${escape(entry.id)}"></p></div>` : ""}</div>`;
    }).join("");
    const captions = entries.map(entry => {
      const item = byId[entry.id], action = item.segments?.some(segment => segment.action);
      const path = action ? `<p class="layout-action-path" data-path-item="${escape(entry.id)}">${actionPath(entry,item)}</p>` : "";
      return `<div>${path}${item.segments?.length ? `<p class="layout-compare-segment" data-segment-item="${escape(entry.id)}"></p>` : ""}${inspector(pane,entry,item,pane.items.indexOf(entry))}</div>`;
    }).join("");
    return `${entries.length < 2 ? '<p class="layout-compare-hint">Add another item to compare.</p>' : ""}
      ${isAction ? `<button type="button" class="layout-compare-play" data-action="compare-play" data-pane="${escape(pane.id)}">▶ Play & compare</button>` : ""}
      ${isAction ? `<div class="layout-branch-controls"><span data-branch-status>Same opening · ${escape(byId[entries[0].id].segments[0].action)}</span><button data-action="branch-jump" data-pane="${escape(pane.id)}" data-time="${branch}">Compare from ${branch.toFixed(2)} s ↗</button><label>Shared time <input aria-label="Comparison timeline" type="range" min="0" max="${Math.min(...entries.map(e => byId[e.id].duration))}" step="0.01" value="0" data-sync-seek data-pane="${escape(pane.id)}"></label></div>` : ""}
      <p class="layout-compare-hint">${isAction ? "Hover to switch routes at the same moment. Click for the original and prompts." : "Hover to preview. Click for the full video and prompts."}</p>
      <div class="layout-compare-row ${isAction ? "action-comparison" : "task-comparison"}" data-branch="${branch}" aria-label="Comparison panels">${panels}</div>
      <div class="layout-compare-captions" style="--compare-count:${entries.length}">${captions}</div>`;
  }
  function paneEditor(pane, index) {
    if (!edit) return "";
    return `<div class="layout-edit"><div class="layout-edit-row">
      ${["title", "subtitle", "comment"].map(field => `<label><span>${field[0].toUpperCase()+field.slice(1)}</span><input data-pane-field="${field}" data-pane="${escape(pane.id)}" value="${escape(pane[field])}"></label>`).join("")}
      <label><span>Display</span><select data-pane-field="mode" data-pane="${escape(pane.id)}">${["rail","grid","hero","compare"].map(v => `<option ${v === pane.mode ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label><span>Grid columns</span><select data-pane-field="cols" data-pane="${escape(pane.id)}">${[2,3,4].map(v => `<option value="${v}" ${v === pane.cols ? "selected" : ""}>${v} per row</option>`).join("")}</select></label>
      ${pane.mode === "rail" ? `<label class="layout-group-option"><input type="checkbox" data-pane-field="group_by_reference" data-pane="${escape(pane.id)}" ${grouped(pane) ? "checked" : ""}> Group by reference image</label>` : ""}
      </div><div class="layout-pane-controls">
      <button data-action="pane-up" data-pane="${escape(pane.id)}" ${index === 0 ? "disabled" : ""}>↑ Pane</button>
      <button data-action="pane-down" data-pane="${escape(pane.id)}" ${index === board.panes.length - 1 ? "disabled" : ""}>↓ Pane</button>
      <button data-action="delete-pane" data-pane="${escape(pane.id)}">Delete pane</button>
      <span class="layout-save-status" role="status"></span></div></div>`;
  }
  function paneHtml(pane, index) {
    const valid = pane.items.filter(entry => byId[entry.id]);
    if (!valid.some(entry => entry.id === selected[pane.id])) selected[pane.id] = valid[0]?.id;
    let contents = `<div class="layout-empty">No videos yet${edit ? " — drag from the library or use Add to pane." : "."}</div>`;
    if (valid.length && pane.mode === "hero") contents = mainContent(pane, valid[0]);
    if (valid.length && pane.mode === "rail") {
      const entry = valid.find(e => e.id === selected[pane.id]);
      let cards;
      if (grouped(pane)) {
        const groups = new Map();
        for (const e of valid) {
          const key = byId[e.id].image_id;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(e);
        }
        cards = [...groups.values()].map(group => {
          const representative = group.find(e => e.id === selected[pane.id]) || group[0];
          return card(pane, representative, pane.items.indexOf(representative), true, group);
        }).join("");
      } else cards = valid.map((e,i) => card(pane,e,i,true)).join("");
      contents = `<div class="layout-rail">${mainContent(pane, entry)}<div class="layout-rail-list">${cards}</div></div>`;
    }
    if (valid.length && pane.mode === "grid") contents = `<div class="layout-grid" style="--cols:${pane.cols}">${valid.map((e,i) => card(pane,e,i,false)).join("")}</div>`;
    if (valid.length && pane.mode === "compare") contents = compareContent(pane, valid);
    if (pane.id === "pane-action-1" && !edit) contents = `<div class="branch-film"><video controls playsinline preload="none" poster="/assets/action-branch-r005.jpg" data-branch-film></video><button class="layout-play" data-action="branch-film-play" data-pane="${escape(pane.id)}" aria-label="Play four-way motion film">▶</button></div>
      <div class="branch-originals"><p>Explore the originals</p><div>${valid.map(entry => `<button data-action="compare-open" data-pane="${escape(pane.id)}" data-item="${escape(entry.id)}"><img loading="lazy" decoding="async" src="${escape(poster(entry,byId[entry.id]))}" alt=""><span>${escape(byId[entry.id].segments[1].action)} ↗</span></button>`).join("")}</div></div>`;
    return `<article class="layout-pane" id="section-${escape(pane.id)}" data-drop-pane="${escape(pane.id)}">
      <div class="section-heading"><div><h2 class="section-title">${escape(pane.title || "Untitled pane")}</h2></div>
        <div class="layout-heading-actions"><button class="layout-collapse" ${pane.id === "scene-examples" ? "hidden" : ""} data-action="collapse" data-pane="${escape(pane.id)}" aria-expanded="${!pane.collapsed}">${pane.collapsed ? "Expand" : "Collapse"}</button></div></div>
      ${paneEditor(pane,index)}${pane.comment ? `<p class="layout-comment">${escape(pane.comment)}</p>` : ""}
      ${pane.collapsed ? "" : contents}</article>`;
  }
  function renderDrawer() {
    drawer.hidden = !edit || !drawerOpen;
    document.body.classList.toggle("layout-library-open", !drawer.hidden);
    if (drawer.hidden) return;
    const optionList = (field, title) => `<select data-filter="${field}" aria-label="${title}"><option value="">All ${title}</option>${[...new Set(library.map(i => i[field]).filter(Boolean))].map(v => `<option value="${escape(v)}" ${filters[field] === v ? "selected" : ""}>${escape(field === "set" ? setName(v) : fullTask(v))}</option>`).join("")}</select>`;
    const visible = library.filter(i => (!filters.set || i.set === filters.set) && (!filters.task || i.task === filters.task) &&
      (!filters.image || i.image_id.toLowerCase().includes(filters.image.toLowerCase())) && (!filters.unused || !placement(i.id)));
    drawer.innerHTML = `<div class="layout-drawer-heading"><h2>Demo library <small>· ${visible.length} / ${library.length}</small></h2><button data-action="toggle-library" aria-label="Close library">Close ✕</button></div><p>Drag items onto a pane, or choose a destination.</p>
      <div class="layout-filter">${optionList("set","sets")}${optionList("task","tasks")}
      <input data-filter="image" value="${escape(filters.image)}" placeholder="Filter image ID" aria-label="Filter image ID">
      <label><input type="checkbox" data-filter="unused" ${filters.unused ? "checked" : ""}> Unused only</label></div>
      ${visible.map(item => { const placed = placements(item.id); return `<div class="layout-library-item ${placed.length ? "used" : ""}" draggable="true" data-drag-item="${escape(item.id)}" data-drag-pane="">
        <img loading="lazy" decoding="async" src="${escape(imageAsset(item.poster))}" alt=""><div><strong>${escape(item.id)} · ${escape(item.image_id)}</strong><small>${escape(setName(item.set))} · ${escape(fullTask(item.task))}</small>
        ${placed.length ? `<small>In ${escape(placed.map(p => p.title).join(", "))}</small>` : ""}
        <select aria-label="Destination for ${escape(item.id)}" data-destination="${escape(item.id)}">${board.panes.map(p => `<option value="${escape(p.id)}">${escape(p.title)}</option>`).join("")}</select>
        <button data-action="library-add" data-item="${escape(item.id)}">Add to pane</button></div></div>`; }).join("")}`;
  }
  let actionChoice = 'pane-action-1', longChoice = 0, taskFocus = '', activeFirstLook = 'D016', activeTask = '', previewIndex=0;
  const previewGroups = () => board.preview_groups || [];
  const previewEntries = () => {
    const entries=previewGroups().flatMap(g=>g.items),order=board.showcase_order||[];
    return [...entries].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?order.length:ai)-(bi<0?order.length:bi);});
  };
  function taskLabel(task) {
    const [input,output]=fullTask(task).split(' → ');
    return `<span>${escape(input)}</span><small>→ ${escape(output)}</small>`;
  }
  let comparisonImage='more-b-18539109';
  function comparisonGroups(){
    const groups=new Map();library.filter(i=>i.id.startsWith('V-')).forEach(i=>{if(!groups.has(i.image_id))groups.set(i.image_id,[]);groups.get(i.image_id).push(i);});
    return [...groups].filter(([id,rows])=>new Set(rows.map(i=>i.task)).size===3);
  }
  function comparisonPane(){
    const source=board.panes.find(p=>p.id==='pane-compare-one-reference'),group=comparisonGroups().find(([id])=>id===comparisonImage)||comparisonGroups()[0];
    return {...source,id:'pane-compare-one-reference',mode:'compare',cols:3,title:'One Character, Three Inputs',subtitle:'',collapsed:false,items:(group?.[1]||[]).sort((a,b)=>['Ref2VA','RefA2V','RefA2VA'].indexOf(a.task)-['Ref2VA','RefA2V','RefA2VA'].indexOf(b.task)).filter(i=>!staticSite&&new URLSearchParams(location.search).has('debug')||!board.debug_hidden?.includes(i.id)).map(i=>({id:i.id,weight:i.default_weight,caption:'',label:'',comment:''}))};
  }
  function comparisonShowcase(){const selector=`<div class="comparison-groups" aria-label="Choose a comparison example">${comparisonGroups().map(([id,rows],i)=>`<button data-comparison-image="${escape(id)}" aria-pressed="${id===comparisonImage}"><img loading="lazy" decoding="async" src="${escape(imageAsset(rows[0].poster))}" alt=""><span>Example ${i+1}</span></button>`).join('')}</div>`;return paneHtml(comparisonPane(),1).replace('<p class="layout-compare-hint">',selector+'<p class="layout-compare-hint">');}
  let comparisonObserver=null,comparisonVisible=false;
  function watchInputVideos(){
    comparisonObserver?.disconnect();comparisonVisible=false;
    const section=$('#section-pane-compare-one-reference');if(edit||!section)return;
    comparisonObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
      comparisonVisible=entry.isIntersecting&&entry.intersectionRatio>=.15;
      if(!comparisonVisible) {
        section.querySelectorAll('[data-compare-video],.input-audio-compare audio').forEach(unloadMedia);
      }
    }),{threshold:[0,.15]});
    comparisonObserver.observe(section);
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-comparison-image]');if(!button)return;stopVideos();comparisonImage=button.dataset.comparisonImage;$('#section-pane-compare-one-reference').outerHTML=comparisonShowcase();if(!edit)$("#layout-rest").innerHTML=paneHtml(scenePane(),0);watchInputVideos();});
  function renderPreview() {
    const groups=previewGroups(); if(!groups.length) return;
    $('#preview').innerHTML=`<div class="preview-heading"><h2>Bring Any Character to Life</h2></div>
      <div class="task-deck" aria-label="Showcase examples" tabindex="0"><div class="orbit-halo" aria-hidden="true"></div><svg class="orbit-track" viewBox="0 0 1100 520" preserveAspectRatio="none" aria-hidden="true"><ellipse cx="550" cy="213" rx="430" ry="126" transform="rotate(-12 550 213)"/></svg><div class="deck-cards"></div></div>
      <div class="deck-controls"><button data-deck-step="-1" aria-label="Previous example">←</button><button data-deck-step="1" aria-label="Next example">→</button></div><p class="deck-info" aria-live="polite"></p>`;
    renderDeck();
    watchRing();
    let nav=$('.section-float-nav');
    if(!nav){nav=document.createElement('nav');nav.className='section-float-nav';nav.setAttribute('aria-label','Page sections');document.body.append(nav);}
    const sections=[['preview','Showcase'],['overview','Overview'],['section-pane-action-1','Motion'],['section-pane-compare-one-reference','Inputs'],['three-ways','Gallery'],['longform','Duration'],['more-demos','Scenes'],['citation','Citation']];
    nav.innerHTML=sections.map(([id,label],i)=>`<a href="#${id}"><span>${String(i+1).padStart(2,'0')}</span>${label}</a>`).join('');updateSectionNav();
  }
  const ringPreview=document.createElement("video");
  ringPreview.muted=true;ringPreview.playsInline=true;ringPreview.preload="none";
  let ringObserver=null,ringVisible=false,warmGeneration=0,warmVideos=[];
  const deckActivity={pointer:false,focus:false,animation:false};
  function setDeckActivity(key,value){
    if(deckActivity[key]===value)return;
    deckActivity[key]=value;
    window.dispatchEvent(new CustomEvent("showcase-activity",{detail:Object.values(deckActivity).some(Boolean)}));
  }
  function clearRingWarm(){
    warmGeneration++;
    warmVideos.forEach(unloadMedia);warmVideos=[];
  }
  function scheduleRingWarm(){
    clearRingWarm();
    if(!ringVisible||document.hidden||edit)return;
    const generation=warmGeneration;
    const run=()=>{
      if(generation!==warmGeneration||!ringVisible||document.hidden)return;
      const entries=previewEntries(),n=entries.length;
      if(!n)return;
      for(const offset of [-1,0,1]){
        const entry=entries[(previewIndex+offset+n)%n],url=byId[entry.id]?.weights[entry.weight];
        if(!url)continue;
        const video=document.createElement("video");video.muted=true;video.preload="metadata";video.src=url;video.load();warmVideos.push(video);
      }
    };
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if("requestIdleCallback" in window)requestIdleCallback(run,{timeout:1800});else setTimeout(run,200);
    }));
  }
  function stopRingMotion(){
    if(!orbitFrame)return;
    cancelAnimationFrame(orbitFrame);orbitFrame=0;
    $(".task-deck")?.classList.remove("is-animating");
    setDeckActivity("animation",false);
  }
  function watchRing(){
    ringObserver?.disconnect();clearRingWarm();ringVisible=false;
    const deck=$(".task-deck");if(!deck)return;
    ringObserver=new IntersectionObserver(([entry])=>{
      ringVisible=entry.isIntersecting;
      if(ringVisible){
        if(orbitPosition!==previewIndex)positionDeck(false);
        scheduleRingWarm();
      } else {stopRingMotion();clearRingWarm();unloadMedia(ringPreview);setDeckActivity("pointer",false);setDeckActivity("focus",false);}
    },{threshold:0});
    ringObserver.observe(deck);
  }
  document.addEventListener("visibilitychange",()=>{if(document.hidden){stopRingMotion();clearRingWarm();unloadMedia(ringPreview);setDeckActivity("pointer",false);setDeckActivity("focus",false);}else if(ringVisible){if(orbitPosition!==previewIndex)positionDeck(false);scheduleRingWarm();}});
  function renderDeck() {
    const entries=previewEntries();previewIndex=Math.max(0,Math.min(previewIndex,entries.length-1));
    $('.deck-cards').innerHTML=entries.map((entry,i)=>{const item=byId[entry.id],ringPoster=ringPosters[`${entry.id}|${entry.weight}`],image=escape(imageAsset(ringPoster?.src || poster(entry,item))),ratio=item.width/item.height,w=Math.min(1,ratio),h=Math.min(1,1/ratio),priority=i===previewIndex?'high':'low';return `<div class="deck-card" data-deck-index="${i}" role="button" tabindex="-1" data-preview-card data-pane="preview-tasks" data-item="${escape(entry.id)}" style="--orbit-width:${w};--orbit-height:${h}" aria-label="Open original example"><div class="orbit-card-body"><div class="preview-frame orbit-front"><img src="${image}" alt="" loading="${i===previewIndex?'eager':'lazy'}" fetchpriority="${priority}" decoding="async"></div><div class="orbit-back" aria-hidden="true"><img src="${image}" alt="" loading="lazy" fetchpriority="${priority}" decoding="async"></div></div></div>`;}).join('');
    orbitPosition=previewIndex;positionDeck(false);
    $(".deck-card.is-current .orbit-front")?.append(ringPreview);
  }
  let orbitPosition=0,orbitFrame=0;
  function positionDeck(animate=true){
    cancelAnimationFrame(orbitFrame);const entries=previewEntries(),cards=[...document.querySelectorAll('[data-deck-index]')],stage=$('.task-deck');if(!stage)return;
    const width=stage.clientWidth,mobile=width<700,rx=mobile?width*.69:Math.min(465,width*.42),ry=mobile?90:112;
    const tilt=-12*Math.PI/180,start=orbitPosition,travel=((previewIndex-start+entries.length*1.5)%entries.length)-entries.length/2,began=performance.now(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const visibleCount=Math.min(15,entries.length),cosTilt=Math.cos(tilt),sinTilt=Math.sin(tilt);
    const movingCards=cards.map(card=>({card,index:Number(card.dataset.deckIndex),visible:!card.hidden,rear:card.classList.contains('is-rear'),z:card.style.zIndex}));
    const moving=animate&&!reduced&&!!travel;stage.classList.toggle("is-animating",moving);setDeckActivity("animation",moving);
    cards.forEach(card=>{const current=Number(card.dataset.deckIndex)===previewIndex,was=card.classList.contains('is-current');card.classList.toggle('is-current',current);card.classList.remove('is-featured','is-arriving');card.tabIndex=current?0:-1;card.setAttribute('aria-label',current?'Open current original':'Bring example to front');if(current&&!was&&animate&&!reduced)card.classList.add('is-arriving');});
    const paint=now=>{const progress=!animate||reduced?1:Math.min(1,(now-began)/760),ease=1-Math.pow(1-progress,4);orbitPosition=start+travel*ease;
      movingCards.forEach(state=>{const {card}=state,offset=((state.index-orbitPosition+entries.length*1.5)%entries.length)-entries.length/2,visible=Math.abs(offset)<=(visibleCount-1)/2+.5;if(state.visible!==visible){state.visible=visible;card.hidden=!visible;if(visible)card.removeAttribute('aria-hidden');else card.setAttribute('aria-hidden','true');}
        const theta=offset*2*Math.PI/visibleCount,depth=(Math.cos(theta)+1)/2,x=Math.sin(theta)*rx,y=Math.cos(theta)*ry;
        card.style.setProperty('--orbit-x',`${(x*cosTilt-y*sinTilt).toFixed(2)}px`);card.style.setProperty('--orbit-y',`${(x*sinTilt+y*cosTilt).toFixed(2)}px`);
        card.style.setProperty('--orbit-scale',(.47+.53*Math.pow(depth,1.7)).toFixed(3));card.style.setProperty('--orbit-yaw',`${(-Math.sin(theta)*58).toFixed(2)}deg`);card.style.setProperty('--orbit-opacity',(.66+.34*depth).toFixed(3));const z=String(Math.round(depth*100)+2);if(state.z!==z){state.z=z;card.style.zIndex=z;}const rear=depth<.4;if(state.rear!==rear){state.rear=rear;card.classList.toggle('is-rear',rear);}
      });if(progress<1&&moving)orbitFrame=requestAnimationFrame(paint);else{orbitFrame=0;stage.classList.remove("is-animating");setDeckActivity("animation",false);if(moving)scheduleRingWarm();}};paint(began);
    $('[data-deck-step="-1"]').disabled=false;$('[data-deck-step="1"]').disabled=false;
    const item=byId[entries[previewIndex].id],segment=promptRecord(item).segs[0]?.text||'';
    const spoken=segment.match(/<d>([\s\S]*?)<\/d>/i)?.[1]?.replace(/^\[[^\]]+\]\s*/,'').trim()||item.segments?.[0]?.line||'';
    $('.deck-info').textContent=spoken?displayText(spoken):duration(item);
  }
  function stepDeck(direction){const next=(previewIndex+direction+previewEntries().length)%previewEntries().length;if(next===previewIndex)return false;stopVideos();previewIndex=next;positionDeck();return true;}
  addEventListener('resize',()=>{if(board&&$('.task-deck'))positionDeck(false);});
  let wheelTotal=0,wheelLast=0,wheelMoved=0;
  document.addEventListener('wheel',event=>{if(!event.target.closest('.task-deck')||dialog.open||event.ctrlKey)return;const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY,direction=Math.sign(delta);if(!direction)return;event.preventDefault();const now=performance.now();if(now-wheelLast>180)wheelTotal=0;wheelLast=now;if(now-wheelMoved<350)return;wheelTotal+=delta*(event.deltaMode===1?16:event.deltaMode===2?400:1);if(Math.abs(wheelTotal)>65){stepDeck(Math.sign(wheelTotal));wheelTotal=0;wheelMoved=now;}},{passive:false});
  document.addEventListener('keydown',event=>{if(event.target.closest('.task-deck')&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();stepDeck(event.key==='ArrowRight'?1:-1);}});
  function showTaskInfo(id) {
    const entry=paneById('pane-task-gallery')?.items.find(e=>e.id===id),item=entry&&byId[id];if(!item)return;
    activeTask=id;
    document.querySelectorAll('.task-gallery-card').forEach(card=>card.classList.toggle('is-active',card.dataset.item===id));
    const info=$('.task-gallery-info');info.className=`firstlook-info task-gallery-info task-${item.task}`;
    const rec=promptRecord(item),line=rec.segs[0]?.text||rec.global.split('\n').map(s=>s.trim()).find(s=>s&&!/^GLOBAL PROMPT$|^=+$|^[\w_]+:$/.test(s))||'Prompt unavailable';
    info.innerHTML=`<img loading="lazy" decoding="async" src="${escape(imageAsset(entry.reference_url||poster(entry,item)))}" alt="Reference image"><div><strong>${escape(fullTask(item.task))}</strong><small>${escape(duration(item))}</small><p>${fmtPrompt(displayText(line))}</p><div class="firstlook-info-actions">${entry.input_audio_url?`<button type="button" data-audio-src="${escape(entry.input_audio_url)}">${item.task==="RefA2VA"?"▶ Voice reference":"▶ Input audio"}</button><audio preload="none"></audio>`:'<span>Voice described in prompt</span>'}<button type="button" data-action="compare-open" data-pane="pane-task-gallery" data-item="${escape(id)}">Full prompt ↗</button></div></div>`;
  }
  const icon = kind => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${({image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.4"/><path d="M4 18l5-5 3 3 3-4 5 6"/>',audio:'<path d="M3 10v4m4-7v10m5-13v16m5-13v10m4-7v4"/>',voice:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11a6 6 0 0012 0M12 17v4m-4 0h8"/>',video:'<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'})[kind]}</svg>`;
  const taskSpecs={RefA2VA:['Image + Voice → Video + Audio',['image','voice'],['video','audio']],Ref2VA:['Image → Video + Audio',['image'],['video','audio']],RefA2V:['Image + Audio → Video',['image','audio'],['video']]};
  function taskShowcase(){
    const pane=paneById('pane-task-gallery');if(!pane)return '';
    return `<article id="three-ways" class="task-gallery-section"><div class="section-heading"><div><h2 class="section-title">Explore the Gallery</h2></div></div><div class="task-gallery-layout"><div class="hex-cluster" role="group" aria-label="Filter by generation task">${['RefA2VA','Ref2VA','RefA2V'].map(t=>{const s=taskSpecs[t];return `<div class="hex-wrap task-${t}"><svg class="hex-shape" viewBox="0 0 230 200" aria-hidden="true" focusable="false"><defs><linearGradient id="hex-gradient-${t}" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop offset="0" class="hex-light"/><stop offset="1" class="hex-dark"/></linearGradient></defs><path class="hex-fill" d="M57.5 1 H172.5 L229 100 L172.5 199 H57.5 L1 100 Z" fill="url(#hex-gradient-${t})"/><path class="hex-highlight" d="M59 5 H171 L224 100 L171 195 H59 L6 100 Z"/></svg><button type="button" class="task-hex" data-hex="${t}" aria-pressed="${t===taskFocus}" title="${escape(fullTask(t))}" aria-label="${escape(fullTask(t))}"><span class="hex-content"><span class="task-icons">${s[1].map(icon).join('')}<b>→</b>${s[2].map(icon).join('')}</span><strong>${s[0]}</strong><em class="hex-count">${(n=>`${n} case${n===1?'':'s'}`)(pane.items.filter(e=>byId[e.id]?.task===t).length)}</em></span></button></div>`;}).join('')}<p class="hex-hint">Hover to highlight · click to filter</p></div><div class="task-gallery-content"><div class="task-gallery-grid"></div><div class="firstlook-info task-gallery-info" aria-live="polite"></div></div></div></article>`;
  }
  function justifiedLayout(entries,width,gap,target,minFactor){
    const ratio=e=>(e.width||byId[e.id].width)/(e.height||byId[e.id].height);
    const best=Array(entries.length+1);best[entries.length]={cost:0,rows:[]};
    for(let start=entries.length-1;start>=0;start--){
      let sum=0;
      for(let end=start;end<entries.length;end++){
        sum+=ratio(entries[end]);const count=end-start+1,available=width-gap*(count-1),fit=available/sum,last=end===entries.length-1;
        if(available<=0||!best[end+1]||fit<target*minFactor||(!last&&fit>target*1.8)||(last&&sum*target+gap*(count-1)>width+.01))continue;
        const height=last?target:fit;
        const unused=last?Math.max(0,width-(sum*height+gap*(count-1)))/width:0;
        const cost=best[end+1].cost+Math.pow((height-target)/target,2)+unused*unused*4+.08;
        if(!best[start]||cost<best[start].cost)best[start]={cost,rows:[{entries:entries.slice(start,end+1),height},...best[end+1].rows]};
      }
    }
    return best[0];
  }
  function renderTaskCards(){
    const pane=paneById('pane-task-gallery'),grid=$('.task-gallery-grid');
    const entries=pane.items.filter(e=>!taskFocus||byId[e.id].task===taskFocus);
    const width=grid.clientWidth,gap=innerWidth<=900?10:16,columns=width<500?2:width<900?3:4;
    grid.style.setProperty('--gallery-columns',columns);
    grid.style.setProperty('--gallery-row',`${Math.round((width-gap*(columns-1))/columns)}px`);
    grid.innerHTML=entries.map(e=>{const i=byId[e.id],ratio=(e.width||i.width)/(e.height||i.height),portrait=ratio<1;return `<div class="task-gallery-card task-${escape(i.task)} ${portrait?'is-portrait':'is-landscape'} ${e.id===activeTask?'is-active':''}" role="button" tabindex="0" data-preview-card data-pane="pane-task-gallery" data-item="${escape(e.id)}" aria-label="${escape(fullTask(i.task))}, ${escape(duration(i))}. Open video"><span class="firstlook-dot"></span><span class="task-card-badge" aria-hidden="true">▶ Play</span><img src="${escape(poster(e,i))}" alt="" loading="lazy" decoding="async"><video muted playsinline preload="none"></video></div>`;}).join('');
    const selected=entries.find(e=>e.id===activeTask)||entries[0];if(selected)showTaskInfo(selected.id);
  }
  document.addEventListener('pointerover',event=>{const h=event.target.closest('[data-hex]');if(h&&!h.contains(event.relatedTarget))$('#three-ways').dataset.highlight=h.dataset.hex;});
  document.addEventListener('pointerout',event=>{const h=event.target.closest('[data-hex]');if(h&&!h.contains(event.relatedTarget))$('#three-ways').dataset.highlight=taskFocus;});
  document.addEventListener('click',event=>{const h=event.target.closest('[data-hex]');if(!h)return;stopVideos();taskFocus=taskFocus===h.dataset.hex?'':h.dataset.hex;$('#three-ways').dataset.highlight=taskFocus;document.querySelectorAll('[data-hex]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.hex===taskFocus)));renderTaskCards();});
  let galleryResize=0;
  addEventListener('resize',()=>{clearTimeout(galleryResize);galleryResize=setTimeout(()=>{if(!edit&&$('.task-gallery-grid')){$('#three-ways').querySelectorAll('video[src],audio[src]').forEach(unloadMedia);renderTaskCards();}},120);});
  document.addEventListener('wheel',event=>{const strip=event.target.closest('.firstlook-strip');if(!strip||event.ctrlKey)return;const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(!delta)return;if((delta<0&&strip.scrollLeft<=0)||(delta>0&&strip.scrollLeft+strip.clientWidth>=strip.scrollWidth-1))return;event.preventDefault();strip.scrollBy({left:delta,behavior:'smooth'});},{passive:false});
  document.addEventListener('keydown',event=>{const strip=event.target.closest('.firstlook-strip');if(strip&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();strip.scrollBy({left:(event.key==='ArrowRight'?1:-1)*strip.clientWidth/3,behavior:'smooth'});}});
  const actionAsset = id => id==='pane-action-1'?'/assets/action-speakers-r014':`/assets/action-${id}-r006`;
  function actionShowcase() {
    const panes=board.panes.filter(p=>p.id.startsWith('pane-action-'));
    const pane=panes.find(p=>p.id===actionChoice)||panes[0];if(!pane)return '';
    return `<article class="layout-pane motion-showcase" id="section-pane-action-1"><div class="section-heading"><div><h2 class="section-title">One Opening, Different Directions</h2></div></div>
      <div class="motion-select" role="group" aria-label="Choose a motion example">${panes.map((p,i)=>`<button data-motion-choice="${escape(p.id)}" aria-pressed="${p.id===pane.id}"><img loading="lazy" decoding="async" src="${escape(poster(p.items[0],byId[p.items[0].id]))}" alt=""><span>${i===3?'From a bouquet':'From a wave'}<small>${p.items.length} directions</small></span></button>`).join('')}</div>
      <div class="branch-film"><video controls playsinline preload="none" data-poster="${escape(imageAsset(siteAsset(actionAsset(pane.id)+'.jpg')))}" data-branch-film></video><button class="layout-play" data-action="branch-film-play" data-pane="${escape(pane.id)}" data-src="${siteAsset(actionAsset(pane.id)+'.mp4')}" aria-label="Play motion film">▶</button></div>
      <div class="branch-originals"><p>Explore each original</p><div style="--routes:${pane.items.length}">${pane.items.map(e=>`<button data-action="compare-open" data-pane="${escape(pane.id)}" data-item="${escape(e.id)}"><img loading="lazy" decoding="async" src="${escape(poster(e,byId[e.id]))}" alt=""><span>${escape(byId[e.id].segments[1].action)} ↗</span></button>`).join('')}</div></div></article>`;
  }
  function scenePane() {
    const used=new Set();
    const chosen=board.panes.find(p=>p.id==='pane-task-gallery')?.items||[];
    const motion=board.panes.find(p=>p.id===actionChoice)?.items||[];
    const currentLong=board.longform[longChoice]?.item;
    const visibleIds=new Set([...chosen,...previewGroups().flatMap(g=>g.items),...comparisonPane().items,...motion,...(currentLong?[currentLong]:[])].map(e=>e.id));
    const moved=(board.panes.find(p=>p.id==='pane-firstlook-rest')?.items||[]).filter(e=>!visibleIds.has(e.id)),ids=new Set(moved.map(e=>e.id));
    moved.forEach(e=>used.add(byId[e.id]?.image_id));
    const items=[...moved,...board.panes.filter(p=>p.mode==='grid'&&p.id!=='pane-firstlook-rest'&&p.id!=='pane-task-gallery').flatMap(p=>p.items).filter(e=>{const image=byId[e.id]?.image_id;if(visibleIds.has(e.id)||ids.has(e.id)||used.has(image))return false;used.add(image);return true;})];
    return {id:'scene-examples',mode:'grid',cols:3,title:'Characters & Scenes',subtitle:'Different appearances, settings and performances across the three generation tasks.',items};
  }
  function longData(index=longChoice) {
    const data=board.longform[index],e=data.item,i=e&&byId[e.id],ch=longChapters[data.id];
    return {...data,...(ch?{preview_url:ch.film_url,chapter:ch}:{}),src:i?i.weights[e.weight]:data.src,poster:i?poster(e,i):imageAsset(data.poster),duration:i?i.duration:data.duration,task:i?i.task:data.task};
  }
  const timeLabel=seconds=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const longDuration = d => d.duration >= 3600 ? `${Math.floor(d.duration/3600)} h ${Math.floor(d.duration%3600/60)} min` : `${Math.round(d.duration/60)} min`;
  let longFull=false,longVisible=false,longObserver=null;
  function longIndexes() {
    const visible=board.longform_visible||[];
    return board.longform.map((_,i)=>i).filter(i=>!visible.length||visible.includes(longData(i).id));
  }
  function longShowcase() {
    if(!board.longform.length)return '<article id="longform"><p>No videos are currently selected.</p></article>';
    let indexes=longIndexes();if(!indexes.length)return '<article id="longform"><p>No videos are currently selected.</p></article>';if(!indexes.includes(longChoice))longChoice=indexes[0];
    const d=longData();
    const unit=d.duration<300?1:60; const moments=d.times || [0,Math.floor(d.duration*.25/unit)*unit,Math.floor(d.duration*.5/unit)*unit,Math.max(0,Math.floor((d.duration-(unit===1?10:60))/unit)*unit)];
    return `<article class="layout-pane longform-showcase" id="longform"><div class="section-heading"><div><h2 class="section-title">Minutes to Hours, Across Languages</h2></div></div>
      <div class="longform-layout"><div class="longform-main ${d.chapter&&!longFull?'has-film':''}"><div class="longform-screen"><video controls muted loop preload="none" playsinline data-poster="${escape(d.poster)}" data-long-video></video></div>
      <div class="longform-now"><h3>${escape(d.title)}</h3><span>${escape(longDuration(d))}${d.language?' · '+escape(d.language):''}</span></div><p class="longform-task">${escape(fullTask(d.task))}</p>
      <div class="longform-footer"><button class="source-prompt-link" data-long-full>Watch full length ↗</button>${d.chapter?'':`<div class="longform-chapters" aria-label="Jump to a moment">${[...new Set(moments)].map(t=>`<button data-long-time="${t}">${timeLabel(t)} ↗</button>`).join('')}</div>`}<button class="source-prompt-link" data-long-open="${longChoice}">Original & prompts ↗</button></div></div>
      ${d.chapter?chapterStrip(d):''}
      <div class="longform-index" role="group" aria-label="Choose a full-length video">${indexes.map(i=>{const x=longData(i);return `<button class="longform-choice" data-long-choice="${i}" aria-pressed="${i===longChoice}"><img src="${escape(x.poster)}" alt="" loading="lazy" decoding="async"><span><strong>${escape(x.title)}</strong><small>${escape(longDuration(x))}${x.language?' · '+escape(x.language):''}</small></span></button>`;}).join('')}</div></div></article>`;
  }
  function chapterStrip(d){
    const segs=d.chapter.segments,last=segs.length-1;
    return `<div class="chapter-strip" role="group" aria-label="Chapters of this take">${segs.map((s,k)=>`<button type="button" class="chapter-card" data-long-time="${Math.floor(s.src_start_s)}" data-chapter-out="${s.out_start_s}" data-chapter-end="${s.out_start_s+s.dur_s}"><span class="chapter-no">${k===last?'End':`Ch ${k+1}`}</span><strong>${timeLabel(s.src_start_s)}</strong><small>${k===last?'final moments':`plays ${Math.round(s.dur_s)} s at 1×`}</small><i class="chapter-bar" style="--pos:${(s.src_start_s/d.duration*100).toFixed(2)}%"></i></button>`).join('')}</div>`;
  }
  document.addEventListener('timeupdate',e=>{const v=e.target;if(!v.matches?.('[data-long-video]')||longFull)return;document.querySelectorAll('.chapter-card').forEach(c=>c.classList.toggle('is-now',v.currentTime>=+c.dataset.chapterOut&&v.currentTime<+c.dataset.chapterEnd));},true);
  function watchLongVideo(){
    longObserver?.disconnect();longVisible=false;const section=$('#longform');if(edit||!section)return;
    longObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{
      longVisible=entry.isIntersecting&&entry.intersectionRatio>=.15;
      const video=$('[data-long-video]',section);
      if(!longVisible){if(video)unloadMedia(video);return;}
      if(!longFull&&video&&!dialog.open){stopVideos();video.muted=true;video.loop=true;video.src=siteAsset(longData().preview_url);video.play().catch(()=>{});}
    }),{threshold:[0,.15]});longObserver.observe(section);
  }
  async function openLongOriginal(index) {
    const d=longData(index);if(d.item){openCompare(paneById('longform-items'),d.item.id);return;}
    stopVideos();
    dialog.innerHTML=`<div class="layout-dialog-header"><h2>${escape(d.title)} · ${escape(longDuration(d))}</h2><button type="button" data-action="compare-close" aria-label="Close player">Close ✕</button></div><div class="layout-player"><video controls playsinline preload="none" poster="${escape(d.poster)}" data-long-original></video></div><p class="longform-task">${escape(fullTask(d.task))}</p><div data-long-prompts></div>`;
    dialog.showModal();const video=$('video',dialog);video.src=d.original_url||d.src;video.play().catch(()=>{});
    const output=$('[data-long-prompts]',dialog);
    if(d.prompts_url){
      output.textContent='Loading prompts…';
      try{const response=await fetch(d.prompts_url);if(!response.ok)throw Error(response.status);const data=await response.json();
        if(!output.isConnected)return;
        const global=data.global_prompt||data.prompt||data.global||'',segments=data.segments||data.motion_segments||data.motion_prompts||[];
        output.innerHTML=prompts({prompt:global,segments:segments.map(s=>({start_frame:s.start_frame||0,prompt:s.prompt||s.motion_prompt||''}))});
      }catch{if(output.isConnected)output.textContent='The original video is available. Prompt details could not be loaded.';}
    }
  }
  function playLong(seconds) {
    $('.longform-main')?.classList.remove('has-film');
    const video=$('[data-long-video]');if(!longFull||!video.hasAttribute('src')){stopVideos();longFull=true;video.src=siteAsset(longData().src);}
    video.loop=false;video.currentTime=Math.min(seconds,longData().duration-.1);video.muted=false;video.play().catch(()=>{});
  }
  document.addEventListener('click',event=>{
    const step=event.target.closest('[data-deck-step]');if(step){stepDeck(Number(step.dataset.deckStep));return;}
    const first=event.target.closest('.deck-card');if(first){const index=Number(first.dataset.deckIndex);if(index!==previewIndex){stopVideos();previewIndex=index;positionDeck();}else openCompare(paneById('preview-tasks'),first.dataset.item);return;}
    const taskCard=event.target.closest('.task-gallery-card');if(taskCard){showTaskInfo(taskCard.dataset.item);openCompare(paneById('pane-task-gallery'),taskCard.dataset.item);return;}
    const motion=event.target.closest('[data-motion-choice]');if(motion){stopVideos();actionChoice=motion.dataset.motionChoice;$('#section-pane-action-1').outerHTML=actionShowcase();if(!edit)$("#layout-rest").innerHTML=paneHtml(scenePane(),0);watchVideoPosters();return;}
    const original=event.target.closest('[data-long-open]');if(original){openLongOriginal(Number(original.dataset.longOpen));return;}
    const longer=event.target.closest('[data-long-choice]');if(longer){stopVideos();longFull=false;longChoice=Number(longer.dataset.longChoice);$('#longform').outerHTML=longShowcase();if(!edit)$("#layout-rest").innerHTML=paneHtml(scenePane(),0);watchLongVideo();watchVideoPosters();return;}
    if(event.target.closest('[data-long-full]')){playLong(0);return;}
    const time=event.target.closest('[data-long-time]');if(time){playLong(Number(time.dataset.longTime));return;}
  });
  setInterval(()=>{
    const strip=$('#section-scene-examples .layout-grid');
    if(edit||document.hidden||dialog.open||!strip||strip.matches(':hover')||strip.contains(document.activeElement)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const rect=strip.getBoundingClientRect();
    if(rect.top>=innerHeight||rect.bottom<=0||[...strip.querySelectorAll('video')].some(v=>!v.paused))return;
    const end=strip.scrollWidth-strip.clientWidth;
    strip.scrollTo({left:strip.scrollLeft>=end-4?0:Math.min(end,strip.scrollLeft+strip.clientWidth*.7),behavior:'smooth'});
  },4500);
  function updateSectionNav() {
    const links=[...document.querySelectorAll(".section-float-nav a")];
    const active=links.filter(a=>document.querySelector(a.getAttribute("href"))?.getBoundingClientRect().top <= innerHeight*.38).at(-1) || links[0];
    links.forEach(a=>{ if(a===active) a.setAttribute("aria-current","location"); else a.removeAttribute("aria-current"); });
  }
  let navFrame = 0;
  addEventListener("scroll",()=>{if(!navFrame) navFrame=requestAnimationFrame(()=>{updateSectionNav();navFrame=0;});},{passive:true});
  addEventListener("resize",updateSectionNav);
  function previewCard(card) {
    if(dialog.open || card.getAttribute("aria-hidden")==="true" || card.querySelector("video[src]")) return;
    stopVideos();
    document.querySelectorAll("[data-preview-card]").forEach(x=>x.classList.toggle("is-featured",x===card));
    const entry=paneById(card.dataset.pane).items.find(x=>x.id===card.dataset.item);
    if(!entry)return;
    let video=card.querySelector("video");
    if(card.classList.contains("deck-card")){
      video=ringPreview;
      card.querySelector(card.classList.contains("is-rear")?".orbit-back":".orbit-front").append(video);
    }
    if(!video)return;
    video.preload="auto";video.src=byId[entry.id].weights[entry.weight]; video.muted=true;
    video.play().catch(()=>{});
  }
  document.addEventListener("pointerover",event=>{const card=event.target.closest("[data-preview-card]");if(card && event.pointerType!=="touch" && !card.contains(event.relatedTarget)){if(card.matches('.deck-card'))setDeckActivity("pointer",true);if(card.matches('.task-gallery-card'))showTaskInfo(card.dataset.item);if(card.matches('.firstlook-card')){activeFirstLook=card.dataset.item;document.querySelectorAll('.firstlook-card').forEach(c=>c.classList.toggle('is-active',c===card));}previewCard(card);}});
  document.addEventListener("focusin",event=>{const card=event.target.closest("[data-preview-card]");if(card){if(card.matches('.deck-card'))setDeckActivity("focus",true);if(card.matches('.task-gallery-card'))showTaskInfo(card.dataset.item);if(card.matches('.firstlook-card')){activeFirstLook=card.dataset.item;document.querySelectorAll('.firstlook-card').forEach(c=>c.classList.toggle('is-active',c===card));}previewCard(card);}});
  document.addEventListener("focusout",event=>{const card=event.target.closest?.('.deck-card');if(card&&!event.relatedTarget?.closest?.('.deck-card')){setDeckActivity("focus",false);if(!card.matches(':hover'))card.querySelectorAll('video[src]').forEach(unloadMedia);}});
  document.addEventListener("pointerout",event=>{const card=event.target.closest("[data-preview-card]");if(card && !card.contains(event.relatedTarget)){if(card.matches('.deck-card')&&!event.relatedTarget?.closest?.('.deck-card'))setDeckActivity("pointer",false);card.classList.remove("is-featured");card.querySelectorAll("video[src]").forEach(unloadMedia);}});
  document.addEventListener("playing",event=>{if(event.target.matches?.(".deck-card video"))event.target.classList.add("is-ready");},true);
  document.addEventListener("keydown",event=>{if(event.target.matches("[data-preview-card]") && ["Enter"," "].includes(event.key)){event.preventDefault();event.target.click();}});
  function render() {
    if (dialog.open) dialog.close();
    stopVideos();
    railObserver.disconnect();
    toolbar.innerHTML = staticSite ? '' : `<a href="/versions/index.html">Versions · r030</a><button data-action="toggle-edit" aria-pressed="${edit}">${edit ? "Edit: on" : "Edit"}</button>${edit ? `<button data-action="toggle-library" aria-pressed="${drawerOpen}">${drawerOpen ? "Hide library" : "Library"}</button><button data-action="add-pane">+ Pane</button><a href="/api/export.md" target="_blank">Export .md</a>` : ""}`;
    const stage=(id)=>{let node=$(`#${id}`);if(!node){node=document.createElement('section');node.id=id;node.className='section section-shell';}return node;};
    const motion=stage('motion-stage'),tasks=stage('tasks-stage'),long=stage('long-stage');
    $('#hero-showcase').after(motion);motion.after($('#task-proof'));$('#task-proof').after(tasks);tasks.after(long);long.after($('#more-demos'));$('#more-demos').after($('#method-details-container'));
    $('#demos').hidden=!edit;
    $('#highlights').hidden=!edit;
    if(edit) {
      $("#task-proof").hidden=true;
      motion.hidden=tasks.hidden=long.hidden=true;
      $("#layout-first").innerHTML = board.panes.slice(0,2).map((p,i)=>paneHtml(p,i)).join("");
      $("#layout-rest").innerHTML = board.panes.slice(2).map((p,i)=>paneHtml(p,i+2)).join("");
    } else {
      motion.hidden=tasks.hidden=long.hidden=false;
      $('#task-proof').hidden=false;
      $('#task-proof').innerHTML=comparisonShowcase();
      motion.innerHTML=actionShowcase();tasks.innerHTML=taskShowcase();long.innerHTML=longShowcase();$('#three-ways').dataset.highlight=taskFocus;renderTaskCards();
      tasks.querySelector('.hex-hint')?.remove();
      $("#layout-rest").innerHTML=paneHtml(scenePane(),0);
    }
    renderDrawer();
    renderPreview();
    watchInputVideos();
    watchLongVideo();
    watchVideoPosters();
    if(!edit){
      const tasks=$('#three-ways');
      if(tasks){
        const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();ensurePrompts().then(ok=>{if(ok&&activeTask)showTaskInfo(activeTask);});}},{rootMargin:'300px'});
        observer.observe(tasks);
      }
    }
    document.querySelectorAll(".layout-rail .layout-main .layout-player").forEach(player => {
      player.closest(".layout-rail").style.setProperty("--rail-player-height", `${player.offsetHeight}px`);
      railObserver.observe(player);
    });
  }
  function moveItem(id, destId, beforeId, sourceId = "") {
    const dest = paneById(destId), source = sourceId ? paneById(sourceId) : placement(id), item = byId[id];
    if (!dest || !item) return;
    if (dest.mode === "hero" && dest.items.some(e => e.id !== id)) {
      alert("A hero pane holds one video. Remove or move it first."); return;
    }
    if (dest !== source && dest.items.some(e => e.id === id)) {
      alert("This item is already in that pane."); return;
    }
    if (dest.mode === "compare" && dest !== source && dest.items.length >= 5) {
      alert("A compare pane holds at most five videos."); return;
    }
    const entry = source?.items.find(e => e.id === id) || {id, weight:item.default_weight, caption:"", label:"", comment:""};
    if (source) source.items = source.items.filter(e => e.id !== id);
    let index = beforeId ? dest.items.findIndex(e => e.id === beforeId) : -1;
    if (index < 0) index = dest.items.length;
    dest.items.splice(index, 0, entry);
    selected[dest.id] = id;
    save(); render();
  }
  function activate(pane, id) {
    const entry = pane.items.find(e => e.id === id), item = byId[id];
    if (!entry || !item) return;
    if (pane.mode === "rail" && selected[pane.id] !== id) {
      selected[pane.id] = id; render();
    }
    stopVideos();
    if (!hasVideo(entry,item)) return;
    const video = (dialog.open ? dialog : document).querySelector(`[data-player="${CSS.escape(pane.id + ":" + id)}"]`);
    if (!video) return;
    video.src = window.LAYOUT_ORIGINAL_URLS[item.weights[entry.weight]] || item.weights[entry.weight];
    const play = video.parentElement.querySelector(".layout-play");
    if (play) play.hidden = true;
    video.play().catch(() => {});
  }
  function clearCompare(row) {
    if (activeCompare?.row === row) {
      clearInterval(activeCompare.timer);
      activeCompare.button.textContent = "▶ Play & compare";
      activeCompare = null;
    }
    row.classList.remove("has-active", "comparing");
    row.querySelectorAll(".layout-compare-panel").forEach(panel => {
      panel.classList.remove("active", "audio-selected");
      const item = byId[panel.dataset.item], label = $("[data-current-action]", panel);
      if (item.segments?.[1]?.action && label) label.textContent = item.segments[1].action;
    });
    row.querySelectorAll("video[src]").forEach(video => {
      video.pause(); video.removeAttribute("src"); video.load();
    });
    const article = row.closest(".layout-pane");
    const seek = $("[data-sync-seek]", article), status = $("[data-branch-status]", article);
    if (seek) seek.value = 0;
    if (status) status.textContent = "Same opening · " + byId[row.querySelector(".layout-compare-panel").dataset.item].segments[0].action;
    article.querySelectorAll("[data-segment-item], [data-inline-segment]").forEach(output => { output.textContent = ""; });
    article.querySelectorAll("[data-path-item]").forEach(path => {
      path.querySelectorAll(".is-current").forEach(step => { step.classList.remove("is-current"); step.removeAttribute("aria-current"); });
      delete path.dataset.activeStep;
    });
  }
  function segmentFor(item, seconds) {
    return [...(item.segments || [])].reverse().find(s => seconds * 24 >= s.start_frame) || item.segments?.[0];
  }
  function selectAudio(row, selected) {
    row.querySelectorAll(".layout-compare-panel").forEach(panel => {
      const video = $("[data-compare-video]", panel), button = $(".layout-compare-mute", panel);
      const audible = panel === selected;
      video.muted = !audible;
      panel.classList.toggle("audio-selected", audible);
      if (button) {
        button.textContent = audible ? "🔊" : "🔇";
        button.setAttribute("aria-label", audible ? "Mute preview" : "Unmute preview");
      }
    });
  }
  function switchPanel(session, panel) {
    if (session.panel === panel) return;
    const previous = session.videos[0], time = previous?.currentTime || 0;
    if (session.panel) {
      const item = byId[session.panel.dataset.item];
      if (item.segments?.[1]?.action) $("[data-current-action]", session.panel).textContent = item.segments[1].action;
    }
    if (previous) { previous.pause(); previous.removeAttribute("src"); previous.load(); }
    session.row.querySelectorAll(".active, .audio-selected").forEach(p => p.classList.remove("active", "audio-selected"));
    session.row.closest("article").querySelectorAll(".is-current").forEach(p => { p.classList.remove("is-current"); p.removeAttribute("aria-current"); });
    session.row.closest("article").querySelectorAll("[data-active-step]").forEach(p => delete p.dataset.activeStep);
    const pane = paneById(panel.dataset.pane), entry = pane.items.find(e => e.id === panel.dataset.item);
    const video = $("video", panel);
    video.src = byId[entry.id].weights[entry.weight];
    video.currentTime = Math.min(time, Math.max(0, byId[entry.id].duration - .1));
    session.panel = panel; session.videos = [video];
    panel.classList.add("active"); selectAudio(session.row, panel);
    video.play().catch(() => {
      if (activeCompare !== session || session.panel !== panel) return;
      video.muted = true; video.play().catch(() => {});
    });
  }
  function playComparison(pane, button) {
    const article = button.closest(".layout-pane"), row = $(".layout-compare-row", article);
    if (activeCompare?.row === row) { clearCompare(row); return; }
    document.querySelectorAll(".layout-compare-row").forEach(clearCompare);
    stopVideos();
    const panels = [...row.querySelectorAll(".layout-compare-panel")].filter(panel => {
      const entry = pane.items.find(e => e.id === panel.dataset.item);
      return entry && hasVideo(entry, byId[entry.id]);
    });
    if (!panels.length) return;
    row.classList.add("comparing");
    button.textContent = "■ Stop";
    const session = {row, button, videos: [], panel: null, timer: null};
    activeCompare = session;
    switchPanel(session, panels[0]);
    const tick = () => {
      if (activeCompare !== session) return;
      const master = session.videos[0];
      if (master.ended) { clearCompare(row); return; }
      const seek = $("[data-sync-seek]", article), status = $("[data-branch-status]", article);
      if (seek) seek.value = master.currentTime;
      if (status) status.textContent = master.currentTime < Number(row.dataset.branch) ? "Same opening · " + byId[panels[0].dataset.item].segments[0].action : "Different motion prompts · " + master.currentTime.toFixed(1) + " s";
      [session.panel].forEach(panel => {
        const item = byId[panel.dataset.item], segment = segmentFor(item, master.currentTime);
        const output = $(`[data-segment-item="${CSS.escape(item.id)}"]`, article);
        if (segment) {
          const label = $("[data-current-action]", panel);
          if (segment.action && label) label.textContent = segment.action;
          if (output) output.textContent = displayText(segment.line || "");
          const inline = $(`[data-inline-segment="${CSS.escape(item.id)}"]`, article);
          if (inline) inline.textContent = displayText(segment.line || "");
          const stepIndex = item.segments.indexOf(segment);
          article.querySelectorAll(`[data-path-item="${CSS.escape(item.id)}"]`).forEach(path => {
            if (path.dataset.activeStep === String(stepIndex)) return;
            path.querySelectorAll(".layout-action-step").forEach((step, index) => {
              step.classList.toggle("is-current", index === stepIndex);
              if (index === stepIndex) step.setAttribute("aria-current", "step");
              else step.removeAttribute("aria-current");
            });
            path.dataset.activeStep = String(stepIndex);
          });
        }
      });
    };
    session.timer = setInterval(tick, 20);
    tick();
  }
  function expandCompare(panel) {
    if (dialog.open || !panel) return;
    const row = panel.closest(".layout-compare-row");
    if (activeCompare?.row === row) { switchPanel(activeCompare, panel); return; }
    if (row.classList.contains("action-comparison")) {
      playComparison(paneById(panel.dataset.pane), $("[data-action=compare-play]", row.closest("article")));
      switchPanel(activeCompare, panel); return;
    }
    if (panel.classList.contains("active")) return;
    document.querySelectorAll(".layout-compare-row").forEach(clearCompare);
    stopVideos();
    row.classList.add("has-active");
    panel.classList.add("active");
    const pane = paneById(panel.dataset.pane), entry = pane?.items.find(e => e.id === panel.dataset.item);
    const item = entry && byId[entry.id], video = $("[data-compare-video]", panel);
    if (!entry || !item || !hasVideo(entry,item) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    video.muted = true;
    const sound=$(".layout-compare-mute",panel); if(sound){sound.textContent="🔇";sound.setAttribute("aria-label","Unmute preview");}
    video.src = item.weights[entry.weight];
    video.currentTime = 0;
    video.play().catch(() => {});
  }
  function openCompare(pane, id) {
    const entry = pane.items.find(e => e.id === id);
    if (!entry || !byId[id]) return;
    document.querySelectorAll(".layout-compare-row").forEach(clearCompare);
    const it=byId[id];
    dialog.dataset.item=id;
    dialog.classList.toggle('prompt-dialog',!edit);
    dialog.innerHTML = edit ? `<div class="layout-dialog-header"><h2>${escape(caption(entry,it))}</h2><button type="button" data-action="compare-close" aria-label="Close player">Close ✕</button></div>${mainContent(pane,entry)}` :
      `<div class="layout-dialog-header"><h2>${escape(fullTask(it.task))}</h2><button type="button" data-action="compare-close" aria-label="Close player">Close ✕</button></div><div class="pt-layout ${escape(it.orientation||'')}" style="--aspect:${it.width/it.height}"><div class="pt-video">${player(entry,it,pane)}</div>${promptPanel(entry,it)}</div>`;
    dialog.showModal();
    watchVideoPosters();
    activate(pane,id);
    if(!edit)ensurePrompts().then(ok=>{
      if(!dialog.open||dialog.dataset.item!==id)return;
      const panel=$('.pt-panel',dialog);if(!panel)return;
      if(ok)panel.outerHTML=promptPanel(entry,it);
      else panel.insertAdjacentHTML('afterbegin','<p class="pt-missing">Prompt details could not be loaded. Reopen to retry.</p>');
    });
  }
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    dialog.querySelectorAll("video[src],audio[src]").forEach(video => {
      video.pause(); video.removeAttribute("src"); video.load();
    });
    dialog.querySelectorAll("[data-copy-prompt]").forEach(button=>originalPrompts.delete(button.dataset.copyPrompt));
    dialog.innerHTML = "";
    if(longVisible&&!longFull)watchLongVideo();
  });
  document.addEventListener("click", event=>{
    const view=event.target.closest("[data-view-original-prompt]");
    if(view){
      const id=view.dataset.viewOriginalPrompt,value=originalPrompts.get(id);
      if(value==null)return;
      promptDialog.querySelector("pre").textContent=value;
      promptDialog.querySelector("[data-copy-original-modal]").dataset.copyPrompt=id;
      promptDialog.showModal();
    }
    if(event.target.closest("[data-close-original-prompt]"))promptDialog.close();
  });
  promptDialog.addEventListener("close",()=>{
    promptDialog.querySelector("pre").textContent="";
    delete promptDialog.querySelector("[data-copy-original-modal]").dataset.copyPrompt;
  });
  document.addEventListener("click",async event=>{
    const button=event.target.closest("[data-copy-prompt]");if(!button)return;
    const value=originalPrompts.get(button.dataset.copyPrompt);if(value==null)return;
    try{await navigator.clipboard.writeText(value);button.textContent="Original prompt copied";}
    catch{button.textContent="Copy unavailable";}
  });
  document.addEventListener('volumechange',event=>{
    const panel=event.target.closest?.('.layout-compare-panel'),button=panel&&$('.layout-compare-mute',panel);
    if(button){button.textContent=event.target.muted?'🔇':'🔊';button.setAttribute('aria-label',event.target.muted?'Unmute preview':'Mute preview');}
    if(event.target instanceof HTMLMediaElement&&!event.target.muted&&!event.target.paused)selectAudible(event.target);
  },true);
  document.addEventListener("input", event => {
    if (!event.target.matches("[data-sync-seek]")) return;
    const row = event.target.closest(".layout-pane").querySelector(".layout-compare-row");
    if (activeCompare?.row === row) activeCompare.videos.forEach(v => { v.currentTime = Number(event.target.value); });
  });
  document.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    const panel = event.target.closest(".layout-compare-panel");
    if (panel && !panel.contains(event.relatedTarget)) expandCompare(panel);
  });
  document.addEventListener("pointerout", event => {
    const row = event.target.closest(".layout-compare-row");
    if (row && !row.classList.contains("comparing") && !row.contains(event.relatedTarget) &&
        (!row.contains(document.activeElement) || !document.activeElement.matches(":focus-visible"))) {
      if (row.contains(document.activeElement)) document.activeElement.blur();
      clearCompare(row);
    }
  });
  document.addEventListener("focusin", event => {
    const panel = event.target.closest(".layout-compare-panel");
    if (panel) expandCompare(panel);
  });
  document.addEventListener("focusout", event => {
    const row = event.target.closest(".layout-compare-row");
    if (row) setTimeout(() => {
      if (!row.classList.contains("comparing") && !row.contains(document.activeElement) && !row.matches(":hover")) clearCompare(row);
    }, 0);
  });
  document.addEventListener("pointerdown", event => {
    const panel = event.target.closest(".layout-compare-panel");
    if (panel && event.pointerType === "touch") panel.dataset.touchWasActive = String(panel.classList.contains("active"));
    if (!event.target.closest(".layout-compare-row")) document.querySelectorAll(".layout-compare-row:not(.comparing)").forEach(clearCompare);
  });
  document.addEventListener("keydown", event => {
    const panel = event.target.closest(".layout-compare-panel");
    if (panel && event.target === panel && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault(); panel.click();
    }
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action, pane = paneById(button.dataset.pane), id = button.dataset.item;
    if (action === "compare-close") { dialog.close(); return; }
    if (action === "toggle-edit") { edit = !edit; render(); return; }
    if (action === "toggle-library") { drawerOpen = !drawerOpen; renderDrawer(); const toggle = $('[data-action="toggle-library"]', toolbar); toggle.textContent = drawerOpen ? "Hide library" : "Library"; toggle.setAttribute("aria-pressed", drawerOpen); return; }
    if (action === "add-pane") {
      board.panes.push({id:`pane-${crypto.randomUUID()}`,title:"New pane",subtitle:"",mode:"grid",cols:3,collapsed:false,comment:"",items:[]});
      save(); render(); return;
    }
    if (action === "library-add") {
      const destination = $(`[data-destination="${CSS.escape(id)}"]`, drawer);
      if (destination) moveItem(id, destination.value); return;
    }
    if (!pane) return;
    if (action === "branch-film-play") {
      stopVideos(); const video=button.parentElement.querySelector("video");
      video.src=button.dataset.src || "/assets/action-branch-r005.mp4"; button.hidden=true; video.play().catch(()=>{button.hidden=false;}); return;
    }
    if (action === "branch-jump") {
      const article = button.closest(".layout-pane"), row = $(".layout-compare-row", article);
      if (activeCompare?.row !== row) playComparison(pane, $("[data-action=compare-play]", article));
      activeCompare?.videos.forEach(v => { v.currentTime = Number(button.dataset.time); }); return;
    }
    if (action === "compare-play") { playComparison(pane, button); return; }
    if (action === "compare-open") {
      if (button.dataset.touchWasActive === "false") { delete button.dataset.touchWasActive; expandCompare(button); return; }
      openCompare(pane,id);
      return;
    }
    if (action === "compare-mute") {
      const panel = button.closest(".layout-compare-panel"), row = panel.closest(".layout-compare-row");
      const video = panel.querySelector("video");
      if (video.hasAttribute("src")) {
        if (row.classList.contains("comparing") && video.muted) { selectAudio(row, panel); return; }
        video.muted = !video.muted;
        panel.classList.toggle("audio-selected", !video.muted);
        button.textContent = video.muted ? "🔇" : "🔊";
        button.setAttribute("aria-label", video.muted ? "Unmute preview" : "Mute preview");
      }
      return;
    }
    if (action === "play" || action === "select") { activate(pane,id); return; }
    if (action === "collapse") pane.collapsed = !pane.collapsed;
    if (action === "delete-pane") {
      if (!confirm(`Delete "${pane.title}"? Its items will return to the library.`)) return;
      board.panes = board.panes.filter(p => p !== pane);
    }
    if (action === "remove") pane.items = pane.items.filter(e => e.id !== id);
    if (action === "pane-up" || action === "pane-down") {
      const i = board.panes.indexOf(pane), j = i + (action === "pane-up" ? -1 : 1);
      if (j >= 0 && j < board.panes.length) [board.panes[i],board.panes[j]] = [board.panes[j],board.panes[i]];
    }
    if (action === "item-up" || action === "item-down") {
      const i = pane.items.findIndex(e => e.id === id), j = i + (action === "item-up" ? -1 : 1);
      if (i >= 0 && j >= 0 && j < pane.items.length) [pane.items[i],pane.items[j]] = [pane.items[j],pane.items[i]];
    }
    save(); render();
  });
  document.addEventListener("timeupdate", event => {
    const video = event.target;
    if (!video.matches?.("[data-player]")) return;
    const [paneId, id] = video.dataset.player.split(":"), item = byId[id];
    const output = $(`[data-player-segment="${CSS.escape(`${paneId}:${id}`)}"]`);
    const segment = item && segmentFor(item, video.currentTime);
    if (output && segment) output.textContent = displayText([segment.action, segment.line, segment.prompt].filter(Boolean).join(" · "));
    if (dialog.open && dialog.contains(video)) {
      const segs=[...dialog.querySelectorAll('.pt-seg')];let active=null;
      segs.forEach(li=>{if(video.currentTime+0.05>=+li.dataset.segT)active=li;});
      segs.forEach(li=>li.classList.toggle('is-now',li===active));
    }
  }, true);
  document.addEventListener('click',event=>{
    const li=event.target.closest('.pt-seg');if(!li||!dialog.contains(li))return;
    const video=$('video[data-player]',dialog);if(!video)return;
    const go=()=>{video.currentTime=+li.dataset.segT;video.play().catch(()=>{});};
    if(!video.hasAttribute('src'))$('.layout-play',dialog)?.click();
    if(video.readyState>=1)go();else {video.addEventListener('loadedmetadata',go,{once:true});video.preload='metadata';video.load();}
  });
  document.addEventListener('keydown',event=>{const li=event.target.closest?.('.pt-seg');if(li&&['Enter',' '].includes(event.key)){event.preventDefault();li.click();}});
  document.addEventListener("change", event => {
    const el = event.target;
    if (el.dataset.filter) { filters[el.dataset.filter] = el.type === "checkbox" ? el.checked : el.value; renderDrawer(); return; }
    const pane = paneById(el.dataset.pane);
    if (!pane) return;
    if (el.dataset.paneField) {
      const field = el.dataset.paneField;
      if (field === "mode" && el.value === "hero" && pane.items.length > 1) {
        alert("A hero pane holds one video. Move the other items first."); el.value = pane.mode; return;
      }
      if (field === "mode" && el.value === "compare" && pane.items.length > 5) {
        alert("A compare pane holds at most five videos. Move the other items first."); el.value = pane.mode; return;
      }
      pane[field] = field === "cols" ? Number(el.value) : el.type === "checkbox" ? el.checked : el.value;
    } else if (el.dataset.itemField) {
      const entry = pane.items.find(e => e.id === el.dataset.item);
      if (!entry) return;
      entry[el.dataset.itemField] = el.value;
    } else return;
    save(); render();
  });
  document.addEventListener("dragstart", event => {
    const el = event.target.closest("[data-drag-item]");
    if (!edit || !el) return;
    drag = {id:el.dataset.dragItem, source:el.dataset.dragPane};
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", drag.id);
  });
  document.addEventListener("dragover", event => {
    if (edit && drag && event.target.closest("[data-drop-pane]")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
  });
  document.addEventListener("drop", event => {
    const target = event.target.closest("[data-drop-pane]");
    if (!edit || !drag || !target) return;
    event.preventDefault();
    if (target.dataset.dropItem !== drag.id) moveItem(drag.id, target.dataset.dropPane, target.dataset.dropItem, drag.source);
    drag = null;
  });
  document.addEventListener("dragend", () => { drag = null; });
  Promise.all([fetch(staticSite ? "data/items.json" : window.LAYOUT_ARCHIVE ? window.LAYOUT_ARCHIVE + "/items.json" : "/_layout/items.json").then(r => { if (!r.ok) throw Error("Items unavailable"); return r.json(); }),
               fetch(staticSite ? "data/board.json" : window.LAYOUT_ARCHIVE ? window.LAYOUT_ARCHIVE + "/board.json" : "/api/board").then(r => { if (!r.ok) throw Error("Board unavailable"); return r.json(); }),
               fetch(staticSite ? "data/orbit-posters.json" : window.LAYOUT_ARCHIVE ? window.LAYOUT_ARCHIVE + "/orbit-posters.json" : "/assets/r019-orbit-posters/manifest.json").then(r => r.ok ? r.json() : {}).catch(() => ({})),
               fetch(staticSite ? "data/ref2va-extra.json" : window.LAYOUT_ARCHIVE ? window.LAYOUT_ARCHIVE + "/ref2va-extra.json" : "/assets/refa2v-extra-r022.json").then(r => r.ok ? r.json() : []).catch(() => []),
               fetch(staticSite ? "data/longform-chapters.json" : window.LAYOUT_ARCHIVE ? window.LAYOUT_ARCHIVE + "/longform-chapters.json" : "/assets/longform-r022/manifest.json").then(r => r.ok ? r.json() : []).catch(() => []),
               staticSite ? Promise.resolve({}) : fetch(window.LAYOUT_ARCHIVE ? window.LAYOUT_ARCHIVE+"/assets/optimized-r027/manifest.json" : "/assets/optimized-r027/manifest.json").then(r=>r.ok?r.json():{}).catch(()=>({}))])
    .then(([items, saved, posters, extras, chapters, optimized]) => { optimizedImages=optimized||{};
      longChapters = Object.fromEntries((chapters||[]).map(c => [c.take_id, c]));
      extraItems = (extras||[]).map(e => ({id:e.id,set:e.collection,task:e.task,image_id:e.reference_image,sample_id:e.sample_id,duration:e.duration,width:e.width,height:e.height,orientation:e.width>=e.height?'landscape':'portrait',weights:{[e.weight]:e.proxy_url},default_weight:e.weight,poster:e.poster,posters:{[e.weight]:e.poster},prompt:e.prompt||'',segments:e.segments||[],caption:'',status:e.review||'',reference_url:e.reference_image}));
      items = [...items, ...extraItems.filter(x => !items.some(i => i.id === x.id))];
      library = items; byId = Object.fromEntries(items.map(i => [i.id,i])); board = saved; ringPosters = posters; longChoice=Math.max(0,board.longform.findIndex(d=>d.id==='hourly-01')); render(); })
    .catch(error => { $("#layout-first").textContent = `Layout preview failed: ${error.message}`; });
})();
