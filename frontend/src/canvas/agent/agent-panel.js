(function(){
  const state=window.CanvasAgentState, $=id=>document.getElementById(id), panel=$('canvasAgentPanel');
  let lastLiveStatus = '';
  let liveEvents = [];
  const expandedEventGroups = new Set();
  let rebuildingMessages = false;
  let messageFollow = true;
  let lastRunRenderKey = '';
  let confirmationPending = false;
  let confirmationAccepted = false;
  const planDecisions = new Map();
  let referencePickerOpen = false;
  let referencePickerIndex = 0;
  let referencePickerSource = 'canvas';
  const status = value => { $('canvasAgentStatus').textContent=value || ''; };
  const planDecisionKey = (runId, version) => `${runId || ''}:${version || ''}`;
  const planStatusLabel = status => ({confirmed:'已确认',rejected:'已取消'})[String(status || '')] || '';
  const timeLabel = () => new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit'}).format(new Date());
  const isNearMessageBottom = box => (box.scrollHeight - box.scrollTop - box.clientHeight) < 48;
  const captureMessageScroll = box => ({top:box.scrollTop,follow:messageFollow});
  const restoreMessageScroll = (box, snapshot) => { box.scrollTop=snapshot?.follow ? box.scrollHeight : Math.min(snapshot?.top || 0, Math.max(0,box.scrollHeight-box.clientHeight)); };
  const attachAuxiliaryPanels = () => {
    const messages=$('canvasAgentMessages');
    messages.append($('canvasAgentPlan'), $('canvasAgentArtifacts'));
    messages.addEventListener('scroll',()=>{if(!rebuildingMessages)messageFollow=isNearMessageBottom(messages);});
  };
  const eventProjector = () => window.CanvasAgentEventProjector;
  const isConversationEvent = (type, data) => eventProjector()?.isConversationEvent?.({type, payload:data}) || false;
  const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const renderMessageContent = (body, content) => {
    const candidates = (window.CanvasAgentBridge.nodeMentionCandidates?.() || []).sort((a,b)=>b.label.length-a.label.length || b.id.length-a.id.length);
    const usable = candidates.filter(item=>item.label.length >= 2 || item.id.length >= 8);
    if(!usable.length){ body.appendChild(document.createTextNode(content)); return; }
    const pattern = new RegExp(usable.map(item=>escapeRegExp(item.label)).concat(usable.map(item=>escapeRegExp(item.id))).join('|'), 'g');
    let cursor=0; let match;
    while((match=pattern.exec(String(content)))!==null){
      if(match.index>cursor) body.appendChild(document.createTextNode(String(content).slice(cursor,match.index)));
      const value=match[0]; const target=usable.find(item=>item.label===value || item.id===value);
      if(!target){ body.appendChild(document.createTextNode(value)); cursor=pattern.lastIndex; continue; }
      const link=document.createElement('button'); link.type='button'; link.className='canvas-agent-node-link'; link.textContent=value; link.title=`定位节点：${target.label}`; link.dataset.nodeId=target.id; body.appendChild(link); cursor=pattern.lastIndex;
    }
    if(cursor<String(content).length) body.appendChild(document.createTextNode(String(content).slice(cursor)));
    if(!body.childNodes.length) body.appendChild(document.createTextNode(content));
  };
  const linkNodeMentions = root => {
    const candidates=(window.CanvasAgentBridge.nodeMentionCandidates?.()||[]).sort((a,b)=>b.label.length-a.label.length||b.id.length-a.id.length);
    const usable=candidates.filter(item=>item.label.length>=2||item.id.length>=8);
    if(!usable.length)return;
    const pattern=new RegExp(usable.map(item=>escapeRegExp(item.label)).concat(usable.map(item=>escapeRegExp(item.id))).join('|'),'g');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); const textNodes=[];
    while(walker.nextNode())textNodes.push(walker.currentNode);
    textNodes.forEach(node=>{
      if(node.parentElement?.closest('a,button,code,pre'))return;
      const value=node.textContent||''; pattern.lastIndex=0; if(!pattern.test(value))return; pattern.lastIndex=0;
      const fragment=document.createDocumentFragment(); let cursor=0; let match;
      while((match=pattern.exec(value))!==null){
        if(match.index>cursor)fragment.append(document.createTextNode(value.slice(cursor,match.index)));
        const target=usable.find(item=>item.label===match[0]||item.id===match[0]);
        if(!target)fragment.append(document.createTextNode(match[0]));
        else {const link=document.createElement('button');link.type='button';link.className='canvas-agent-node-link';link.textContent=match[0];link.title=`定位节点：${target.label}`;link.dataset.nodeId=target.id;fragment.append(link);}
        cursor=pattern.lastIndex;
      }
      if(cursor<value.length)fragment.append(document.createTextNode(value.slice(cursor)));
      node.replaceWith(fragment);
    });
  };
  const renderMarkdownMessageContent = (body, content) => {
    if(!window.MediaForgeMarkdown?.render){renderMessageContent(body,content);return;}
    body.classList.add('markdown-content'); body.innerHTML=window.MediaForgeMarkdown.render(content,{emptyText:'暂无内容'}); linkNodeMentions(body);
  };
  const focusReference = reference => {
    if (reference?.source === 'asset') { toast('素材库中内容无法跳转'); return; }
    const nodeId = reference?.node_id || reference?.nodeId || '';
    if (!nodeId) { toast('该引用不属于画布节点，无法跳转'); return; }
    if (!window.CanvasAgentBridge.focusNode(nodeId)) toast('对应画布节点已不存在，无法跳转');
  };
  const messageReferenceToken = (reference,index) => {
    const token=document.createElement('button'); token.type='button'; token.className='mention-image-token';
    const url=reference.thumbnail||reference.src||reference.url||'';
    const name=reference.name||reference.label||`图${index+1}`;
    token.dataset.url=reference.preview_url||reference.previewSrc||reference.url||url;
    token.title=reference.source==='asset'?'素材库中内容无法跳转':`定位节点：${name}`;
    const image=reference.empty||!url ? document.createElement('i') : document.createElement('img');
    if (reference.empty||!url) { image.className='mention-image-empty'; image.setAttribute('data-lucide','box'); image.setAttribute('aria-hidden','true'); token.dataset.empty='true'; }
    else { image.src=url; image.alt=name; image.draggable=false; }
    const label=document.createElement('span'); label.textContent=name;
    token.append(image,label);
    token.addEventListener('click',()=>focusReference(reference));
    if (window.lucide) lucide.createIcons({root:token});
    return token;
  };
  const renderUserMessageContent = (body, content, references=[]) => {
    const refs=Array.isArray(references)?references:[]; const used=new Set(); const text=String(content||''); const pattern=/图([1-9]\d*)/g; let cursor=0; let match;
    while((match=pattern.exec(text))!==null){
      const index=Number(match[1])-1; const reference=refs[index];
      if(!reference){ continue; }
      renderMessageContent(body,text.slice(cursor,match.index)); body.appendChild(messageReferenceToken(reference,index)); used.add(index); cursor=pattern.lastIndex;
    }
    renderMessageContent(body,text.slice(cursor));
    const remaining=refs.filter((_,index)=>!used.has(index));
    if(!remaining.length)return;
    const row=document.createElement('div'); row.className='canvas-agent-message-references';
    remaining.forEach(reference=>row.appendChild(messageReferenceToken(reference,refs.indexOf(reference)))); body.appendChild(row);
  };
  const appendMessageReferences = (body, references=[]) => {
    const refs=Array.isArray(references)?references:[];
    if(!refs.length)return;
    const row=document.createElement('div'); row.className='canvas-agent-message-references';
    refs.forEach((reference,index)=>row.appendChild(messageReferenceToken(reference,index))); body.appendChild(row);
  };
  const message = (content, kind='agent', references=[]) => {
    if (!content) return;
    if (kind === 'agent') sealLiveStatus();
    const el=document.createElement('div'); el.className=`canvas-agent-message ${kind}`;
    const body=document.createElement('div'); body.className='canvas-agent-message-body'; if(kind==='user')renderUserMessageContent(body,content,references); else { renderMarkdownMessageContent(body,content); appendMessageReferences(body,references); } el.appendChild(body);
    if (kind === 'user') { const time=document.createElement('div'); time.className='canvas-agent-message-time'; time.textContent=timeLabel(); el.appendChild(time); }
    const box=$('canvasAgentMessages'); box.appendChild(el); if(!rebuildingMessages && messageFollow) box.scrollTop=box.scrollHeight;
  };
  const liveEventText = (_type, data, fallback='') => {
    const message = String(data?.message || fallback || '').trim();
    return message ? message.replace(/…$/, '') : '处理中';
  };
  const liveEventIcon = type => {
    if (type.includes('tool') || type === 'task.succeeded' || type === 'task.failed') return 'terminal-square';
    if (type.includes('skill')) return 'box';
    if (type.includes('model') || type.includes('context')) return 'search';
    return 'box';
  };
  const liveEventDuration = data => {
    const ms = Number(data?.duration_ms || data?.durationMs || 0);
    if (!ms) return '';
    return `${Math.max(0, Math.round(ms / 1000))}s`;
  };
  const eventGroupKey = events => {
    const first = events[0] || {};
    return first.sequence ? `sequence:${first.sequence}` : `content:${first.type || 'status'}:${first.message || first.data?.message || ''}`;
  };
  const orderedEvents = events => [...events].sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  const renderLiveIcons = root => { if(window.lucide) window.lucide.createIcons({root}); };
  const createLiveStatus = events => {
    const el=document.createElement('div'); el.className='canvas-agent-live-status';
    const groupKey=eventGroupKey(events);
    let expanded=expandedEventGroups.has(groupKey);
    const render = () => {
    el.innerHTML='';
    const ordered=orderedEvents(events);
    const first=ordered[0] || {type:'status',message:lastLiveStatus,data:{}};
    const toggle=document.createElement('button'); toggle.type='button'; toggle.className='canvas-agent-live-toggle'; toggle.setAttribute('aria-expanded', String(expanded));
    const icon=document.createElement('i'); icon.setAttribute('data-lucide', liveEventIcon(first.type));
    const text=document.createElement('span'); text.className='canvas-agent-live-text'; text.textContent=liveEventText(first.type, first.data, first.message);
    const duration=document.createElement('span'); duration.className='canvas-agent-live-duration'; duration.textContent=liveEventDuration(first.data);
    const chevron=document.createElement('i'); chevron.className='canvas-agent-live-chevron'; chevron.setAttribute('data-lucide', expanded ? 'chevron-up' : 'chevron-down');
    toggle.append(icon, text, duration, chevron); toggle.addEventListener('click', () => { expanded=!expanded; if(expanded) expandedEventGroups.add(groupKey); else expandedEventGroups.delete(groupKey); render(); }); el.appendChild(toggle);
    const details=document.createElement('div'); details.className='canvas-agent-live-details'; details.hidden=!expanded; details.style.display=expanded ? '' : 'none';
    [...ordered].reverse().forEach(item => {
      const row=document.createElement('div'); row.className='canvas-agent-live-row';
      const rowIcon=document.createElement('i'); rowIcon.setAttribute('data-lucide', liveEventIcon(item.type));
      const rowText=document.createElement('span'); rowText.textContent=liveEventText(item.type, item.data, item.message);
      const rowDuration=document.createElement('span'); rowDuration.className='canvas-agent-live-duration'; rowDuration.textContent=liveEventDuration(item.data);
      row.append(rowIcon, rowText, rowDuration); details.appendChild(row);
    });
    el.appendChild(details);
    if(el.isConnected) renderLiveIcons(el);
    };
    render();
    return el;
  };
  const renderLiveStatus = () => {
    const box=$('canvasAgentMessages'); let el=box.querySelector('.canvas-agent-live-status.is-active');
    if (!liveEvents.length && !lastLiveStatus) { el?.remove(); return; }
    const next=createLiveStatus(liveEvents.length ? liveEvents : [{type:'status',message:lastLiveStatus,data:{}}]);
    next.classList.add('is-active');
    if(el) el.replaceWith(next); else box.appendChild(next);
    renderLiveIcons(next);
    if(!rebuildingMessages && messageFollow) box.scrollTop=box.scrollHeight;
  };
  const liveEvent = event => {
    const item={sequence:Number(event?.sequence || 0),type:String(event?.type || 'status').replace(/^agent\./,''),data:event?.data || {},message:event?.message || ''};
    if(item.sequence && liveEvents.some(existing=>existing.sequence===item.sequence)) return;
    const projection=eventProjector()?.project?.({type:item.type,payload:item.data});
    const groupId=projection?.progress?.groupId;
    const existingIndex=groupId ? liveEvents.findIndex(existing => eventProjector()?.project?.({type:existing.type,payload:existing.data})?.progress?.groupId===groupId) : -1;
    if(existingIndex>=0) liveEvents[existingIndex]=item; else liveEvents.push(item);
    liveEvents=liveEvents.slice(-80);
    lastLiveStatus=liveEventText(item.type,item.data,item.message);
    renderLiveStatus();
  };
  const liveStatus = content => { if (!content) return; lastLiveStatus=content; renderLiveStatus(); };
  const sealLiveStatus = () => { $('canvasAgentMessages').querySelector('.canvas-agent-live-status.is-active')?.classList.remove('is-active'); liveEvents=[]; lastLiveStatus=''; };
  const clearLiveStatus = () => { lastLiveStatus=''; liveEvents=[]; $('canvasAgentMessages').querySelectorAll('.canvas-agent-live-status').forEach(el=>el.remove()); };
  const system = content => message(content, 'system');
  const modelStorageKey = () => `canvas-agent-model:${window.CanvasAgentBridge.canvasId()}`;
  function modelSelection() {
    if (state.modelConnection && state.modelId) return {connection_id:state.modelConnection, model_id:state.modelId};
    // “自动选择” must still send a concrete configured model. Otherwise the
    // server can observe a cold provider cache while the UI lists usable models.
    const option=[...$('canvasAgentModelSelect').options].find(item=>item.dataset.connection&&item.dataset.modelId);
    return {connection_id:option?.dataset.connection || '', model_id:option?.dataset.modelId || ''};
  }
  function saveModelSelection() { localStorage.setItem(modelStorageKey(), JSON.stringify(modelSelection())); }
  function loadModelSelection() { try { const saved=JSON.parse(localStorage.getItem(modelStorageKey()) || '{}'); state.modelName=String(saved.model || ''); state.modelConnection=String(saved.connection_id || ''); state.modelId=String(saved.model_id || ''); } catch (_) {} }
  let modelLoadPromise=null;
  async function loadModels() { const select=$('canvasAgentModelSelect'); try { const response=await fetch('/api/ai/resources',{credentials:'same-origin'}); if(!response.ok) throw new Error(`请求失败 (${response.status})`); const data=await response.json(); const previous=modelSelection(); select.innerHTML=''; const automatic=document.createElement('option'); automatic.value=''; automatic.textContent='自动选择'; select.appendChild(automatic); const connections=new Map((data.connections||[]).filter(item=>item.enabled!==false).map(item=>[item.id,item])); (data.models||[]).filter(model=>model.enabled!==false && model.kind==='chat' && connections.has(model.connection_id)).forEach(model=>{ const connection=connections.get(model.connection_id); const option=document.createElement('option'); option.value=`${model.connection_id}::${model.id}`; option.textContent=`${connection.name || connection.id} / ${model.alias || model.upstream_model}`; option.dataset.connection=model.connection_id; option.dataset.modelId=model.id; option.dataset.model=model.upstream_model || model.alias || ''; select.appendChild(option); }); const selected=[...select.options].find(option=>option.dataset.connection===previous.connection_id&&option.dataset.modelId===previous.model_id); select.value=selected ? selected.value : ''; if(!selected){state.modelName='';state.modelConnection='';state.modelId='';saveModelSelection();} } catch (_) { select.innerHTML='<option value="">自动选择（模型列表加载失败）</option>'; } }
  function ensureModelsLoaded() { if (!modelLoadPromise) modelLoadPromise=loadModels().finally(()=>{ modelLoadPromise=null; }); return modelLoadPromise; }
  function onModelChange(event) { const option=event.target.selectedOptions[0]; state.modelName=option?.dataset.model || ''; state.modelConnection=option?.dataset.connection || ''; state.modelId=option?.dataset.modelId || ''; saveModelSelection(); }
  const runTitle = run => String(run.title || run.message_title || '').trim().replace(/\s+/g,' ');
  const runLabel = run => { const title=runTitle(run); const short=title ? (title.length > 34 ? `${title.slice(0,34)}…` : title) : '新建对话'; return `${short} · ${run.status || 'created'}`; };
  async function refreshRuns() {
    const select=$('canvasAgentRunSelect'), menu=$('canvasAgentRunMenu');
    let runs=[];
    try {
      const data=await window.CanvasAgentClient.listRuns(window.CanvasAgentBridge.canvasId());
      runs=data.runs||[];
    } catch (_) {}
    const known=new Set(runs.map(run=>run.id));
    try {
      const history=JSON.parse(localStorage.getItem(`canvas-agent-runs:${window.CanvasAgentBridge.canvasId()}`) || '[]');
      history.filter(id=>id && !known.has(id)).forEach(id=>runs.push({id,status:id===state.runId?'created':'unknown',title:'历史 Run'}));
    } catch (_) {}
    if(state.runId && !known.has(state.runId)) runs.unshift({id:state.runId,status:'created',title:'当前 Run'});
    menu.innerHTML=''; select.querySelector('.canvas-agent-session-current')?.remove(); const current=document.createElement('span'); current.className='canvas-agent-session-current'; current.textContent=runTitle(runs.find(run=>run.id===state.runId)||{}) || (state.runId?'当前对话':'新建对话'); select.prepend(current);
    if(!runs.length){ menu.innerHTML='<div class="canvas-agent-session-empty">暂无历史会话</div>'; return; }
    runs.forEach(run=>{ const row=document.createElement('div'); row.className='canvas-agent-session-row'; const button=document.createElement('button'); button.type='button'; button.className='canvas-agent-session-name'; button.textContent=runLabel(run); button.addEventListener('click',()=>{menu.hidden=true;select.setAttribute('aria-expanded','false');window.CanvasAgentEvents.switchRun(run.id);}); const actions=document.createElement('div'); actions.className='canvas-agent-session-actions'; const rename=document.createElement('button'); rename.type='button'; rename.title='改名'; rename.setAttribute('aria-label','改名'); rename.innerHTML='<i data-lucide="pencil"></i>'; rename.addEventListener('click',async event=>{event.stopPropagation();const title=prompt('会话名称',runTitle(run));if(title?.trim()){await window.CanvasAgentClient.renameRun(run.id,title.trim());await refreshRuns();}}); const remove=document.createElement('button'); remove.type='button'; remove.title='删除'; remove.setAttribute('aria-label','删除'); remove.innerHTML='<i data-lucide="trash-2"></i>'; remove.addEventListener('click',async event=>{event.stopPropagation();if(!confirm('删除此会话及其消息？'))return;await window.CanvasAgentClient.deleteRun(run.id);window.CanvasAgentEvents.removeRun(run.id);if(state.runId===run.id){state.runId='';clearRun();}await refreshRuns();}); actions.append(rename,remove); row.append(button,actions); menu.appendChild(row); }); if(window.lucide)lucide.createIcons({root:menu});
  }
  async function refreshCurrentRun() { if (!state.runId) return; try { renderRun(await window.CanvasAgentClient.getRun()); } catch (_) {} }
  function clearRun() {
    lastLiveStatus=''; liveEvents=[]; expandedEventGroups.clear(); messageFollow=true;
    lastRunRenderKey='';
    const messages=$('canvasAgentMessages'), plan=$('canvasAgentPlan'), artifacts=$('canvasAgentArtifacts');
    messages.innerHTML='';
    plan.innerHTML=''; plan.hidden=true; artifacts.innerHTML=''; artifacts.hidden=true;
    messages.append(plan, artifacts);
    state.plan=null; state.tasks=[];
  }
  function renderSkills() { const box=$('canvasAgentSkills'); box.innerHTML=''; state.skills.forEach(skill=>{const tag=document.createElement('span');tag.className='canvas-agent-skill';tag.textContent=`${skill.name}${skill.version ? ` v${skill.version}` : ''}`;box.appendChild(tag);});box.hidden=!state.skills.length; }
  function renderMentions() {
    const box=$('canvasAgentMentions'); box.innerHTML='';
    state.references.forEach(reference => {
      const chip=document.createElement('div'); chip.className='input-thumb'; chip.title=`引用素材：${reference.label||reference.name||'图片'}`;
      chip.addEventListener('click', event => { if (event.target.closest('.input-thumb-x')) return; focusReference(reference); });
      if (!reference.empty && (reference.previewSrc||reference.url||reference.src)) chip.style.setProperty('--preview-url',`url('${reference.previewSrc||reference.url||reference.src}')`);
      const image=reference.empty ? document.createElement('i') : document.createElement('img');
      if (reference.empty) { image.className='input-thumb-empty'; image.setAttribute('data-lucide','box'); image.setAttribute('aria-hidden','true'); chip.dataset.empty='true'; }
      else { image.src=reference.src||reference.thumbnail||reference.url; image.alt=reference.label||reference.name||'图片'; image.draggable=false; }
      const remove=document.createElement('button'); remove.type='button'; remove.className='input-thumb-x'; remove.setAttribute('aria-label',`移除 ${reference.label||reference.name||'图片'}`); remove.innerHTML='<i data-lucide="x"></i>';
      remove.addEventListener('click',()=>{state.references=state.references.filter(item=>item!==reference);renderMentions();});
      const label=document.createElement('span'); label.className='input-thumb-label'; label.textContent=reference.empty ? `节点${state.references.indexOf(reference)+1}` : `图${state.references.indexOf(reference)+1}`;
      chip.append(image,label,remove); box.appendChild(chip);
    });
    state.mentions.forEach(id => {
      const chip=document.createElement('span'); chip.className='canvas-agent-mention'; chip.textContent=`@${window.CanvasAgentBridge.nodeLabel(id)}`;
      const remove=document.createElement('button'); remove.type='button'; remove.textContent='×'; remove.addEventListener('click',()=>{state.mentions=state.mentions.filter(item=>item!==id);renderMentions();}); chip.appendChild(remove); box.appendChild(chip);
    });
    if(window.lucide) lucide.createIcons({root:box});
  }
  function renderRun(data) {
    const run=data.run||{};
    if(run.id){ state.runId=run.id; window.CanvasAgentEvents.saveRun(); }
    if(data.plan?.version && data.plan.version !== state.plan?.version) confirmationAccepted=false;
    if(run.status !== 'awaiting_confirmation') confirmationAccepted=false;
    if(!state.operationId) status(`${run.status || 'unknown'} · ${run.phase || ''}`);
    const activeOperation=(data.operations||[]).find(item=>['accepted','queued','running'].includes(item.status));
    state.sequence=Math.max(state.sequence,...(data.events||[]).map(event=>Number(event.sequence)||0));
    state.operationId=activeOperation?.id || '';
    // Do not detach an unchanged confirmation form on every polling cycle.
    // Removing a native select from the DOM closes its option list.
    const renderKey=JSON.stringify({
      run:[run.id||'',run.status||'',run.phase||''],
      messages:(data.messages||[]).map(item=>[item.id||'',item.role||'',item.content||'',JSON.stringify(item.metadata_json||{}),item.created_at||'']),
      events:(data.events||[]).map(event=>[event.sequence||'',event.type||'',event.created_at||'']),
      plan:[data.plan?.version||'',data.plan?.status||''],
      tasks:(data.tasks||[]).map(item=>[item.id||item.task_id||'',item.status||'',item.updated_at||'']),
      artifacts:(data.artifacts||[]).map(item=>[item.id||'',item.version||'',item.status||'',item.stale||false])
    });
    if(renderKey===lastRunRenderKey) return;
    lastRunRenderKey=renderKey;
    const messages=$('canvasAgentMessages'), planBox=$('canvasAgentPlan'), artifactsBox=$('canvasAgentArtifacts'); const scrollSnapshot=captureMessageScroll(messages); rebuildingMessages=true; messages.innerHTML=''; liveEvents=[]; lastLiveStatus='';
    const loaded=new Map(), planStates=new Map(planDecisions); const persistedPlanStatus=planStatusLabel(data.plan?.status); if(persistedPlanStatus) planStates.set(planDecisionKey(run.id,data.plan.version),persistedPlanStatus); let latestProgress=''; const timeline=[];
    (data.messages||[]).forEach(item=>timeline.push({kind:'message',at:Number(item.created_at)||0,item}));
    (data.events||[]).forEach(event=>{
      const type=String(event.type||'').replace(/^agent\./,''); const payload=event.payload||event.payload_json||{};
      const live={sequence:Number(event.sequence)||0,type,data:payload,message:payload.message||''};
      if(type==='plan.confirmed')planStates.set(planDecisionKey(run.id,payload.plan_version),'已确认');
      if(type==='plan.rejected')planStates.set(planDecisionKey(run.id,payload.plan_version),'已取消');
      const projection=eventProjector()?.project?.({type,payload});
      const historyVisible=projection?.progress ? projection.progress.history : true;
      if(historyVisible && isConversationEvent(type,payload)) timeline.push({kind:'event',at:Number(event.created_at)||0,item:live});
      if(type==='plan.created' && payload.plan) timeline.push({kind:'plan',at:Number(event.created_at)||0,item:{version:payload.plan_version,content_json:payload.plan}});
      if(projection?.skillBadge?.name) loaded.set(`${projection.skillBadge.name}:${projection.skillBadge.version||''}`,projection.skillBadge);
    });
    timeline.sort((a,b)=>a.at-b.at || (a.kind==='event' ? -1 : 1));
    const activePlan=run.status==='awaiting_confirmation'&&!confirmationAccepted; let pending=[]; let turnOpen=false; let planRendered=false; const renderedPlanVersions=new Set();
    timeline.forEach(entry=>{
      if(entry.kind==='event'){ if(turnOpen){ pending.push(entry.item); latestProgress=liveEventText(entry.item.type,entry.item.data,entry.item.message); } return; }
      if(entry.kind==='plan'){
        const planVersion=String(entry.item.version||'');
        if(renderedPlanVersions.has(planVersion)) return;
        renderedPlanVersions.add(planVersion);
        if(data.plan && String(entry.item.version||'')===String(data.plan.version||'')&&activePlan){
          messages.appendChild(planBox); window.CanvasAgentPlan.render(data.plan,{interactive:true,status:planStates.get(planDecisionKey(run.id,entry.item.version))||''}); planRendered=true; return;
        }
        const snapshot=document.createElement('div'); snapshot.className='canvas-agent-plan canvas-agent-plan-history'; snapshot.hidden=false;
        messages.appendChild(snapshot); window.CanvasAgentPlan.render(data.plan&&String(entry.item.version||'')===String(data.plan.version||'')?data.plan:entry.item,{interactive:false,container:snapshot,status:planStates.get(planDecisionKey(run.id,entry.item.version))||''}); planRendered=true; return;
      }
      const kind=entry.item.role==='user'?'user':entry.item.role==='system'?'system':'agent';
      if(kind==='user'){ pending=[]; turnOpen=true; }
      if(kind==='agent' && pending.length){ const liveStatus=createLiveStatus(pending); messages.appendChild(liveStatus); renderLiveIcons(liveStatus); pending=[]; }
      message(entry.item.content,kind,entry.item.metadata_json?.media_references||[]);
      if(kind==='agent' || kind==='system') turnOpen=false;
    });
    liveEvents=turnOpen ? pending : [];
    if(liveEvents.length){ lastLiveStatus=latestProgress; renderLiveStatus(); }
    state.skills=[...loaded.values()]; renderSkills();
    // The plan and artifacts live in the message flow. Restore their DOM nodes
    // before their renderers resolve them by id after rebuilding the timeline.
    if(data.plan && !planRendered){
      if(activePlan){ messages.appendChild(planBox); window.CanvasAgentPlan.render(data.plan,{interactive:true,status:planStates.get(planDecisionKey(run.id,data.plan.version))||''}); }
      else { const snapshot=document.createElement('div'); snapshot.className='canvas-agent-plan canvas-agent-plan-history'; snapshot.hidden=false; messages.appendChild(snapshot); window.CanvasAgentPlan.render(data.plan,{interactive:false,container:snapshot,status:planStates.get(planDecisionKey(run.id,data.plan.version))||''}); }
    }
    else if(!planRendered) { planBox.innerHTML=''; planBox.hidden=true; messages.appendChild(planBox); }
    if(!planBox.isConnected){ planBox.innerHTML=''; planBox.hidden=true; messages.appendChild(planBox); }
    messages.append(artifactsBox);
    window.CanvasAgentArtifacts.render(data.tasks||[],data.artifacts||[]); if((data.artifacts||[]).length)window.CanvasAgentArtifacts.renderDocChain(data.artifacts);
    restoreMessageScroll(messages,scrollSnapshot); rebuildingMessages=false; messageFollow=scrollSnapshot.follow;
  }
  async function ensureRun() { if (state.runId) return state.runId; status('正在创建会话'); const data=await window.CanvasAgentClient.createRun(); state.runId=data.run.id; window.CanvasAgentEvents.saveRun(); await refreshRuns(); return state.runId; }
  async function newRun() { if (state.busy) return; state.busy=true; window.CanvasAgentEvents.stop(); state.runId=''; state.sequence=0; state.skills=[]; clearRun(); renderSkills(); status('正在创建会话'); try { const data=await window.CanvasAgentClient.createRun(); state.runId=data.run.id; window.CanvasAgentEvents.saveRun(); renderRun({run:data.run,messages:[],events:[],tasks:[],artifacts:[]}); await refreshRuns(); } catch (e) { system(e.message); status('创建失败'); } finally { state.busy=false; } }
  function closeReferencePicker(){ referencePickerOpen=false; const picker=$('canvasAgentReferencePicker'); if(picker){ picker.classList.remove('open'); picker.hidden=true; picker.innerHTML=''; } }
  function inputMentionCandidates(){ return state.references.filter(item=>item?.url||item?.src).map((item,index)=>({...item,url:item.url||item.src,thumbnail:item.thumbnail||item.src||item.url,alias:item.name||item.label||`图片${index+1}`,source:item.source||'canvas'})); }
  function assetMentionCandidates(categoryId=''){ try { return typeof assetMentionCandidateImages==='function' ? assetMentionCandidateImages(categoryId).map(item=>({...item,source:'asset'})) : []; } catch (_) { return []; } }
  function mentionCandidates(source=referencePickerSource){ return source==='asset' ? assetMentionCandidates(mentionAssetCategoryId) : inputMentionCandidates(); }
  function positionReferencePicker(){ const picker=$('canvasAgentReferencePicker'), input=$('canvasAgentInput'), compose=input?.closest('.canvas-agent-compose'); if(!picker||!input||!compose)return; const composeRect=compose.getBoundingClientRect(), inputRect=input.getBoundingClientRect(); const selection=window.getSelection(); const range=selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null; const caretRect=range?.getClientRects?.()[0]||range?.getBoundingClientRect?.(); const width=picker.offsetWidth||340, height=picker.offsetHeight||260; const left=Math.max(4,Math.min((caretRect?.left||inputRect.left)-composeRect.left-6,composeRect.width-width-4)); const above=inputRect.top-height-8; const below=caretRect?.bottom||inputRect.top+24; picker.style.left=`${left}px`; picker.style.top=`${(above>=8?above:below+2)-composeRect.top}px`; }
  function renderReferencePicker(){ const picker=$('canvasAgentReferencePicker'); if(!picker)return; const inputItems=inputMentionCandidates(); const libraries=typeof assetLibraries==='function' ? assetLibraries() : []; if(!activeAssetLibraryId||!libraries.some(lib=>lib.id===activeAssetLibraryId)) activeAssetLibraryId=assetLibrary?.active_library_id||libraries[0]?.id||''; const libraryWithAssets=libraries.find(lib=>(lib.categories||[]).some(cat=>(cat.type||'image')==='image'&&(cat.items||[]).some(item=>item?.url))); const categories=typeof assetCategories==='function' ? assetCategories('image') : []; if(referencePickerSource==='asset'&&libraryWithAssets&&!categories.some(cat=>(cat.items||[]).some(item=>item?.url))){activeAssetLibraryId=libraryWithAssets.id;activeAssetCategoryId='';mentionAssetCategoryId='';} const currentCategory=typeof assetCategoryForMention==='function'?assetCategoryForMention():null; const assetItems=assetMentionCandidates(currentCategory?.id||''); const hasInput=inputItems.length>0, hasAssets=Boolean(libraryWithAssets); if(referencePickerSource==='canvas'&&!hasInput&&hasAssets)referencePickerSource='asset'; if(referencePickerSource==='asset'&&!hasAssets&&hasInput)referencePickerSource='canvas'; if(!hasInput&&!hasAssets){closeReferencePicker();return;} const candidates=(referencePickerSource==='asset'?assetItems:inputItems).slice(0,36); const librarySelect=referencePickerSource==='asset'&&libraries.length?`<label class="mention-library-row"><span>资产库</span><select class="mention-library-select" data-agent-mention-library>${libraries.map(lib=>`<option value="${escapeHtml(lib.id)}" ${lib.id===activeAssetLibraryId?'selected':''}>${escapeHtml(lib.name||'资产库')}</option>`).join('')}</select></label>`:''; const folderChips=referencePickerSource==='asset'&&categories.length?categories.map(cat=>`<button class="mention-folder-chip ${cat.id===mentionAssetCategoryId?'active':''}" type="button" data-agent-mention-folder="${escapeHtml(cat.id)}" title="${escapeHtml(cat.name||'未分类')}">${escapeHtml(cat.name||'未分类')}</button>`).join(''):''; picker.innerHTML=`<div class="mention-picker-shell"><div class="mention-source-tabs"><button class="mention-source-tab ${referencePickerSource==='canvas'?'active':''}" type="button" data-agent-mention-source="canvas" ${hasInput?'':'disabled'}><i data-lucide="image"></i><span>输入图</span></button><button class="mention-source-tab ${referencePickerSource==='asset'?'active':''}" type="button" data-agent-mention-source="asset" ${hasAssets?'':'disabled'}><i data-lucide="library"></i><span>资产库</span></button></div>${librarySelect}<div class="mention-folder-chips ${folderChips?'':'hidden'}">${folderChips}</div><div class="mention-content">${candidates.length?`<div class="mention-option-grid">${candidates.map((item,index)=>`<button class="mention-option" type="button" data-agent-mention-index="${index}"><img src="${escapeHtml(item.thumbnail||item.url)}" alt=""><span>${escapeHtml(item.alias||item.name||'图片')}</span></button>`).join('')}</div>`:'<div class="mention-empty">没有可引用的图片</div>'}</div></div>`; picker._items=candidates; picker.hidden=false; picker.classList.add('open'); positionReferencePicker(); picker.querySelectorAll('[data-agent-mention-source]').forEach(button=>button.addEventListener('mousedown',event=>{event.preventDefault();if(!button.disabled){referencePickerSource=button.dataset.agentMentionSource;referencePickerIndex=0;renderReferencePicker();}})); picker.querySelector('[data-agent-mention-library]')?.addEventListener('change',event=>{activeAssetLibraryId=event.target.value||'';activeAssetCategoryId='';mentionAssetCategoryId='';renderAssetLibrary();renderReferencePicker();}); picker.querySelectorAll('[data-agent-mention-folder]').forEach(button=>button.addEventListener('mousedown',event=>{event.preventDefault();mentionAssetCategoryId=button.dataset.agentMentionFolder||'';renderReferencePicker();})); picker.querySelectorAll('[data-agent-mention-index]').forEach(button=>button.addEventListener('mousedown',event=>{event.preventDefault();insertReferenceMention(picker._items[Number(button.dataset.agentMentionIndex)]);})); if(window.lucide)lucide.createIcons({root:picker}); }
  function insertReferenceMention(ref){ const input=$('canvasAgentInput'), selection=window.getSelection(); if(!ref?.url||!selection?.rangeCount)return closeReferencePicker(); const range=selection.getRangeAt(0); if(!input.contains(range.startContainer))return closeReferencePicker(); let removed=false; if(range.startContainer.nodeType===Node.TEXT_NODE&&range.startOffset>0){const value=range.startContainer.textContent||'';if(value[range.startOffset-1]==='@'){range.setStart(range.startContainer,range.startOffset-1);range.deleteContents();removed=true;}} if(!removed)return closeReferencePicker(); if(!state.references.some(item=>(item.url||item.src)===(ref.url||ref.src))){state.references.push(ref);renderMentions();} const token=document.createElement('span');token.className='mention-image-token';token.contentEditable='false';token.dataset.url=ref.url||ref.src||'';token.dataset.name=ref.alias||ref.name||ref.label||'图片';token.dataset.kind=typeof mediaKindForItem==='function'?mediaKindForItem(ref):'image';token.dataset.nodeId=ref.nodeId||'';token.dataset.imageIndex=String(ref.imageIndex??'');token.dataset.assetUris=JSON.stringify(ref.asset_uris||{});token.innerHTML=`<img src="${escapeHtml(ref.url||ref.src||'')}" alt=""><span>${escapeHtml(token.dataset.name)}</span>`; token.addEventListener('click', event=>{ event.preventDefault(); focusReference(ref); }); range.insertNode(token);const spacer=document.createTextNode(' ');token.after(spacer);range.setStartAfter(spacer);range.collapse(true);selection.removeAllRanges();selection.addRange(range);closeReferencePicker();input.focus(); }
  function composerText(){ const input=$('canvasAgentInput'); let text=''; input.childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE)text+=node.textContent||'';else if(node.classList?.contains('mention-image-token')){const index=state.references.findIndex(ref=>(ref.url||ref.src)===(node.dataset.url||''));text+=index>=0?`图${index+1}`:`@${node.dataset.name||'图片'}`;}else text+=node.innerText||'';}); return text.trim(); }
  function textBeforeAgentCaret(){ const input=$('canvasAgentInput'), selection=window.getSelection(); if(!selection?.rangeCount||!input.contains(selection.anchorNode))return '';const range=selection.getRangeAt(0).cloneRange();range.selectNodeContents(input);range.setEnd(selection.anchorNode,selection.anchorOffset);return range.toString(); }
  function handleInput(){ if(/@$/.test(textBeforeAgentCaret())){referencePickerOpen=true;referencePickerSource=inputMentionCandidates().length?'canvas':'asset';referencePickerIndex=0;renderReferencePicker();} else closeReferencePicker(); }
  function handleInputKeydown(event){ if(referencePickerOpen){const total=mentionCandidates().length;if((event.key==='ArrowDown'||event.key==='ArrowUp')&&total){event.preventDefault();referencePickerIndex=(referencePickerIndex+(event.key==='ArrowDown'?1:-1)+total)%total;renderReferencePicker();return;}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();insertReferenceMention($('canvasAgentReferencePicker')._items?.[referencePickerIndex]);return;}if(event.key==='Escape'){event.preventDefault();closeReferencePicker();return;}}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send();} }
  function previewReferenceMention(event){ const token=event.target.closest?.('.mention-image-token'), preview=$('mentionPreview'); if(!token||!preview)return; if(token.dataset.empty==='true'||!token.dataset.url){preview.style.display='none';return;} let media=preview.querySelector('img,video'); const isVideo=token.dataset.kind==='video'||(typeof isVideoMediaItem==='function'&&isVideoMediaItem({url:token.dataset.url,kind:token.dataset.kind})); if(isVideo&&media?.tagName?.toLowerCase()!=='video'){media?.replaceWith(document.createElement('video'));media=preview.querySelector('video');}else if(!isVideo&&media?.tagName?.toLowerCase()!=='img'){media?.replaceWith(document.createElement('img'));media=preview.querySelector('img');} if(isVideo){media.muted=true;media.loop=true;media.playsInline=true;media.preload='metadata';media.src=token.dataset.url||'';media.play?.().catch(()=>{});}else{media.src=token.dataset.url||'';media.alt='preview';} const rect=token.getBoundingClientRect(); preview.style.left=`${Math.min(window.innerWidth-236,rect.left)}px`;preview.style.top=`${Math.min(window.innerHeight-236,rect.bottom+8)}px`;preview.style.display='block'; }
  function hideReferenceMentionPreview(event){ if(!event.target.closest?.('.mention-image-token'))return; const preview=$('mentionPreview'); if(!preview)return; const media=preview.querySelector('img,video'); preview.style.display='none';media?.pause?.();media?.removeAttribute('src');media?.load?.(); }
  async function send() { closeReferencePicker(); const input=$('canvasAgentInput'), content=composerText(); if (!content || state.busy) return; const references=state.references.map(item=>({node_id:item.nodeId||'',image_index:item.imageIndex ?? -1,empty:Boolean(item.empty),source:item.source||'canvas',url:item.url||item.src||'',thumbnail:item.thumbnail||item.src||'',preview_url:item.previewSrc||item.url||item.src||'',name:item.name||item.label||''})); const referenceIds=references.map(item=>item.node_id).filter(Boolean); state.busy=true; input.innerHTML=''; state.references=[]; renderMentions(); messageFollow=true; message(content,'user',references); status('正在受理请求…'); try { await ensureModelsLoaded(); await ensureRun(); window.CanvasAgentEvents.start(); const selection=modelSelection(); const data=await window.CanvasAgentClient.send({content,connection_id:selection.connection_id,model_id:selection.model_id,selected_node_ids:window.CanvasAgentBridge.selectedNodeIds(),mention_node_ids:[...new Set([...state.mentions,...referenceIds]) ],media_references:references}); state.operationId=data.operation_id || ''; status('请求已受理，正在准备 Agent…'); window.CanvasAgentEvents.start(); } catch(e) { system(e.message); status('error'); } finally { state.busy=false; } }
  async function answer(answer) { if (!answer?.trim() || !state.runId) return; try { window.CanvasAgentEvents.start(); const selection=modelSelection(); const data=await window.CanvasAgentClient.answer(answer.trim(),selection); state.operationId=data.operation_id || ''; status('回答已受理，正在继续规划…'); } catch(e) { system(e.message); } }
  async function confirm(approved) { if (!state.plan || !state.runId || confirmationPending) return; const authorize=$('canvasAgentAuthorizeNodes')?.checked; const nodeOverrides=approved ? window.CanvasAgentPlan.collectOverrides() : []; confirmationPending=true; confirmationAccepted=true; const decisionKey=planDecisionKey(state.runId,state.plan.version); planDecisions.set(decisionKey,approved?'已确认':'已取消'); window.CanvasAgentPlan.render(state.plan, {interactive:false,history:true,status:planDecisions.get(decisionKey),force:true}); try { const steps=state.plan.content_json?.steps || []; const targetIds=steps.filter(step=>['canvas.update_node_params','canvas.replace_node_content','canvas.run_node','canvas.run_group'].includes(step.action)).map(step=>step.target_node_id).filter(Boolean); const authorizedNodeIds=authorize ? [...new Set([...state.mentions,...targetIds])] : []; window.CanvasAgentEvents.start(); const data=await window.CanvasAgentClient.request(`/api/canvas-agent/runs/${encodeURIComponent(state.runId)}/confirm`, {method:'POST', body:JSON.stringify({plan_version:state.plan.version,approved,authorized_node_ids:authorizedNodeIds,node_overrides:nodeOverrides,client_request_id:globalThis.crypto?.randomUUID?.() || `${Date.now()}`})}); if(data.operation_id){state.operationId=data.operation_id;status(approved ? '确认已受理，正在执行…' : '拒绝已受理，正在处理…');}else renderRun(data); } catch(e) { planDecisions.delete(decisionKey); confirmationAccepted=false; window.CanvasAgentPlan.render(state.plan, {interactive:true,force:true}); system(e.message); } finally { confirmationPending=false; } }
  function confirmationFailed() { if (!state.plan || !state.runId) return; planDecisions.delete(planDecisionKey(state.runId,state.plan.version)); confirmationAccepted=false; }
  function resetConfirmationState() { confirmationAccepted=false; }
  async function cancel() { if (!state.runId) return; try { renderRun(await window.CanvasAgentClient.cancel()); window.CanvasAgentEvents.stop(); } catch(e) { system(e.message); } }
  function addSelectedMentions() { const ids=window.CanvasAgentBridge.selectedNodeIds(); state.mentions=[...new Set([...state.mentions,...ids])]; renderMentions(); if (!ids.length) system('请先在画布上选中节点。'); }
  function setCanvasReferencePicking(active) {
    state.referencePicking=Boolean(active);
    $('canvasAgentAddCanvasContent')?.classList.toggle('active',state.referencePicking);
  }
  function toggleCanvasReferencePicking() {
    setCanvasReferencePicking(!state.referencePicking);
    if(!state.referencePicking) { window.CanvasAgentBridge.endReferencePicking(); return; }
    window.CanvasAgentBridge.beginReferencePicking(reference => {
      if(state.references.some(item=>item.nodeId===reference.nodeId)) return;
      state.references.push(reference); renderMentions(); $('canvasAgentInput').focus();
    });
  }
  async function init() { try { const response=await fetch('/api/access-control/me',{credentials:'same-origin'}); const me=response.ok ? await response.json() : {}; if(!Array.isArray(me.pages)||!me.pages.includes('canvas-agent')){ $('canvasAgentToggle')?.remove(); panel?.remove(); return; } $('canvasAgentToggle').hidden=false; } catch (_) { $('canvasAgentToggle')?.remove(); panel?.remove(); return; } attachAuxiliaryPanels(); loadModelSelection(); $('canvasAgentToggle').addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden){messageFollow=true;ensureModelsLoaded();refreshRuns();window.CanvasAgentEvents.recover();requestAnimationFrame(()=>{const messages=$('canvasAgentMessages');if(messages)messages.scrollTop=messages.scrollHeight;});}}); ['pointerdown','mousedown','dblclick'].forEach(type=>panel.addEventListener(type,event=>event.stopPropagation())); panel.addEventListener('click', event=>{ const link=event.target.closest('.canvas-agent-node-link'); if(link){ event.preventDefault(); event.stopPropagation(); window.CanvasAgentBridge.focusNode(link.dataset.nodeId); } else event.stopPropagation(); }); panel.addEventListener('wheel', event=>event.stopPropagation(), {capture:true,passive:true}); $('canvasAgentClose').addEventListener('click',()=>{panel.hidden=true; window.CanvasAgentBridge.endReferencePicking();}); $('canvasAgentRunSelect').addEventListener('change',event=>window.CanvasAgentEvents.switchRun(event.target.value)); $('canvasAgentNewRun').addEventListener('click',newRun); $('canvasAgentModelSelect').addEventListener('change',onModelChange); $('canvasAgentSend').addEventListener('click',send); $('canvasAgentCancel').addEventListener('click',cancel); $('canvasAgentAddCanvasContent').addEventListener('click',toggleCanvasReferencePicking); $('canvasAgentInput').addEventListener('input',handleInput); $('canvasAgentInput').addEventListener('keydown',handleInputKeydown); $('canvasAgentInput').addEventListener('mouseover',previewReferenceMention); $('canvasAgentInput').addEventListener('mouseout',hideReferenceMentionPreview); window.addEventListener('canvas-agent-reference-picking-changed',event=>setCanvasReferencePicking(event.detail?.active)); window.addEventListener('beforeunload',()=>{window.CanvasAgentEvents.stop();window.CanvasAgentBridge.endReferencePicking();}); renderMentions(); ensureModelsLoaded(); refreshRuns(); window.CanvasAgentEvents.recover(); }
  document.addEventListener('mousedown',event=>{const picker=$('canvasAgentReferencePicker'),input=$('canvasAgentInput');if(referencePickerOpen&&!picker?.contains(event.target)&&!input?.contains(event.target))closeReferencePicker(); const menu=$('canvasAgentRunMenu'),button=$('canvasAgentRunSelect');if(menu&&!menu.hidden&&!menu.contains(event.target)&&event.target!==button&&!button?.contains(event.target)){menu.hidden=true;button?.setAttribute('aria-expanded','false');}});
  $('canvasAgentRunSelect')?.addEventListener('click',()=>{const menu=$('canvasAgentRunMenu'),button=$('canvasAgentRunSelect');if(menu){menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));}});
  window.CanvasAgentPanel={init,status,message,liveStatus,liveEvent,clearLiveStatus,isConversationEvent,system,renderRun,renderSkills,clearRun,refreshRuns,refreshCurrentRun,send,answer,confirm,confirmationFailed,resetConfirmationState,cancel}; init();
})();
