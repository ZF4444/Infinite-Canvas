(function(){
  const state=window.CanvasAgentState;
  let schemaRequest=0;
  const clone=value=>JSON.parse(JSON.stringify(value||{}));
  const text=step=>step.description||step.node?.title||step.action||'执行画布操作';
  const pathValue=(value,path)=>String(path||'').split('.').filter(Boolean).reduce((item,key)=>item&&typeof item==='object'?item[key]:undefined,value);
  const setPath=(target,path,value)=>{const keys=String(path||'').split('.').filter(Boolean);let cursor=target;keys.slice(0,-1).forEach(key=>cursor=cursor[key]||={});if(keys.length)cursor[keys.at(-1)]=value;};
  const primitive=value=>['string','number','boolean'].includes(typeof value);
  const resourceIndex=()=>{const index=typeof aiResourceIndex!=='undefined'?aiResourceIndex:window.aiResourceIndex;return index&&typeof index==='object'?index:{connections:[],models:[],resources:[]};};
  // Agent plan nodes describe their target through the same engine-specific
  // settings a canvas node uses (runningHub `rhConfigKey`, ComfyUI
  // `comfyWorkflow`), but they do not persist the canonical
  // connection_id/model_id/resource_id. Derive them here by reusing the exact
  // resolvers the generation-settings panel relies on, so the confirmation
  // dialog fetches the same parameter schema the real node would.
  function resolveStableTarget(settings){
    const engine=String(settings.engine||'').toLowerCase();
    const target={connection_id:String(settings.connection_id||''),model_id:String(settings.model_id||''),resource_id:String(settings.resource_id||''),model:String(settings.model||settings.videoModel||'')};
    if(target.connection_id||target.model_id||target.resource_id)return target;
    try{
      if(engine==='runninghub'&&typeof selectedRunningHubRef==='function'&&typeof runningHubTarget==='function'){
        const ref=selectedRunningHubRef(settings);const stable=runningHubTarget(ref,settings)||{};
        target.connection_id=String(stable.connection_id||'');target.model_id=String(stable.model_id||'');target.resource_id=String(stable.resource_id||'');
      }else if(engine==='comfy'){
        // ComfyUI workflows resolve by workflow name; the backend keys the
        // schema on `model` rather than a stable resource id.
        target.model=String(settings.comfyWorkflow||target.model||'');
      }
    }catch(_){/* resolvers unavailable (e.g. tests); fall back to legacy model */}
    return target;
  }
  const schemaUrl=(capability,settings)=>{const target=resolveStableTarget(settings);const params=new URLSearchParams({capability,connection_id:target.connection_id,model_id:target.model_id,resource_id:target.resource_id});if(!target.connection_id&&!target.model_id&&!target.resource_id&&target.model)params.set('model',target.model);return `/api/canvas/capability-parameters?${params.toString()}`;};
  // The prompt now lives in params.runSettings.prompt for every engine, mirroring
  // the backend SemanticNode contract. Keep a single accessor so the top prompt
  // box, RunningHub prompt-role fields, and overrides stay in sync.
  const readPrompt=params=>{const rs=params&&typeof params==='object'?params.runSettings:null;return rs&&typeof rs.prompt==='string'?rs.prompt:'';};
  const writePrompt=(params,value)=>{const rs=(params.runSettings&&typeof params.runSettings==='object')?params.runSettings:(params.runSettings={});rs.prompt=value;};
  function planValues(step){
    const node=step.node||{},params=clone(node.params);
    return {step_id:step.id,title:node.title||'',content:readPrompt(params),params,settings:params.runSettings||params};
  }
  function label(field){return String(field.display_name||field.name||field.id||'参数');}
  function options(field){
    const values=Array.isArray(field.display_options)?field.display_options:[];
    if(values.length)return values;
    const labels=Array.isArray(field.option_labels)?field.option_labels:[];
    return (field.options||[]).map((value,index)=>({value,label:String(labels[index]||value)}));
  }
  function fieldIcon(field){
    return ({provider_id:'plug-zap',videoProvider:'plug-zap',model:'sparkles',videoModel:'film',resolution:'monitor',videoResolution:'monitor',ratio:'scan',videoAspect:'scan',quality:'sliders-horizontal',count:'copy'})[String(field.id||'')]||'sliders-horizontal';
  }
  function ratioIcon(value){
    if(['2:3','3:4'].includes(String(value))) return String(value)==='2:3'?'r-portrait':'r-portrait43';
    if(['3:2','4:3'].includes(String(value))) return String(value)==='3:2'?'r-landscape':'r-landscape43';
    if(['16:9','21:9'].includes(String(value))) return 'r-wide';
    if(['9:16','9:21'].includes(String(value))) return 'r-story';
    return String(value)==='source'?'r-source':String(value)==='custom'?'r-custom':'';
  }
  function closePopovers(except=null){document.querySelectorAll('#canvasAgentPlan .canvas-agent-smart-control.pinned').forEach(control=>{if(control!==except)control.classList.remove('pinned');});}
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#canvasAgentPlan .canvas-agent-smart-control'))closePopovers();},true);
  function appendIcon(parent,name,klass=''){const icon=document.createElement('i');icon.setAttribute('data-lucide',name);if(klass)icon.className=klass;parent.appendChild(icon);}
  function choiceButton(value,caption,active,onPick,klass=''){
    const button=document.createElement('button');button.type='button';button.dataset.agentValue=String(value);button.className=`${klass} ${active?'active':''}`.trim();button.textContent=caption;button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onPick(value);});return button;
  }
  function control(field,value,onChange,interactive){
    const id=String(field.id||'');let type=String(field.type||'text');
    if(id==='count'&&type==='number') field={...field,type:'dropdown',options:Array.from({length:Math.max(1,Number(field.max??4)-Number(field.min??1)+1)},(_,index)=>Number(field.min??1)+index)};
    type=String(field.type||type);const configurable=interactive&&(field.ui?.configurable!==false||['model','videoModel'].includes(id));
    if(type==='dropdown'){
      const values=options(field),current=String(value??'');const wrapper=document.createElement('div');wrapper.className=`canvas-agent-smart-control smart-control ${String(field.id||'')}-control`;
      const pill=document.createElement('button');pill.type='button';pill.className='smart-pill';pill.title=label(field);pill.disabled=!configurable;appendIcon(pill,fieldIcon(field));const summary=document.createElement('span');summary.className='sub';summary.textContent=String(values.find(option=>String(option.value)===current)?.label??current??'');pill.appendChild(summary);appendIcon(pill,'chevron-down','pill-caret');pill.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();const open=!wrapper.classList.contains('pinned');closePopovers(wrapper);wrapper.classList.toggle('pinned',open);});wrapper.appendChild(pill);
      if(configurable){
        const popover=document.createElement('div');popover.className='smart-popover compact-popover';const title=document.createElement('div');title.className='smart-popover-title';title.textContent=label(field);popover.appendChild(title);
        const pick=next=>{onChange(next);summary.textContent=String(values.find(option=>String(option.value)===String(next))?.label??next);popover.querySelectorAll('[data-agent-value]').forEach(button=>button.classList.toggle('active',button.dataset.agentValue===String(next)));closePopovers();};
        if(id==='ratio'||id==='videoAspect'){
          const grid=document.createElement('div');grid.className='ratio-grid';values.forEach(option=>{const button=choiceButton(option.value,option.label,String(option.value)===current,pick,'ratio-option');const glyph=document.createElement('span');glyph.className=`ratio-icon ${ratioIcon(option.value)}`;const text=document.createElement('span');text.textContent=String(option.label);button.textContent='';button.append(glyph,text);grid.appendChild(button);});popover.appendChild(grid);
        }else if(id==='count'){
          const grid=document.createElement('div');grid.className='count-grid';values.forEach(option=>grid.appendChild(choiceButton(option.value,option.label,String(option.value)===current,pick,'count-cell')));popover.appendChild(grid);
        }else if(['resolution','videoResolution','quality'].includes(id)){
          const row=document.createElement('div');row.className='seg-row';values.forEach(option=>row.appendChild(choiceButton(option.value,option.label,String(option.value)===current,pick)));popover.appendChild(row);
        }else{
          const list=document.createElement('div');list.className='model-list';values.forEach(option=>list.appendChild(choiceButton(option.value,option.label,String(option.value)===current,pick,'direct-option')));popover.appendChild(list);
        }
        wrapper.appendChild(popover);
      }
      return wrapper;
    }
    if(type==='boolean'){
      const button=document.createElement('button');button.type='button';button.className=`setting-check ${Boolean(value)?'active':''}`;button.disabled=!configurable;const check=document.createElement('span');check.className='check-box';const caption=document.createElement('span');caption.textContent=label(field);button.append(check,caption);button.addEventListener('click',()=>onChange(!Boolean(value)));return button;
    }
    const wrapper=document.createElement('div');wrapper.className=`num-compact canvas-agent-number-control ${type==='textarea'?'rh-text-param':''}`;wrapper.title=label(field);const caption=document.createElement('span');caption.className='num-label';caption.textContent=label(field);wrapper.appendChild(caption);
    const input=document.createElement(type==='textarea'?'textarea':'input');
    if(type==='number'||type==='slider'){input.type='number';if(field.min!=null)input.min=field.min;if(field.max!=null)input.max=field.max;if(field.step!=null)input.step=field.step;}
    input.value=value??'';input.disabled=!configurable;if(type==='textarea')input.rows=2;input.addEventListener('input',()=>onChange((type==='number'||type==='slider')&&input.value!==''?Number(input.value):input.value));wrapper.appendChild(input);return wrapper;
  }
  function schemaField(field,values,paramsPath,interactive,onLayoutChange){
    // RunningHub app fields persist their value wrapped as {value:...} under
    // runSettings.rhParams (keyed by `nodeId::fieldName`). Unwrap for display
    // and re-wrap on change so the shape matches what the canvas node writes.
    const wrapped=Boolean(field.nodeId||field.fieldName)||/(^|\.)rhParams$/.test(String(paramsPath||''));
    const stored=pathValue(values.params,`${paramsPath}.${field.id}`);
    const value=(wrapped&&stored&&typeof stored==='object'?stored.value:stored)??field.default??'';
    return control(field,value,next=>{setPath(values.params,`${paramsPath}.${field.id}`,wrapped?{value:next}:next);onLayoutChange?.(String(field.id));},interactive);
  }
  // Shared read/write for a schema field's stored value, unwrapping the
  // RunningHub {value:...} envelope when present.
  function fieldStore(field,values,paramsPath){
    const wrapped=Boolean(field.nodeId||field.fieldName)||/(^|\.)rhParams$/.test(String(paramsPath||''));
    return {
      get(){const stored=pathValue(values.params,`${paramsPath}.${field.id}`);return (wrapped&&stored&&typeof stored==='object'?stored.value:stored)??field.default??'';},
      set(next){setPath(values.params,`${paramsPath}.${field.id}`,wrapped?{value:next}:next);},
    };
  }
  function visible(field,settings){
    const id=String(field.id||'');
    if(id==='customSize'||id==='customWidth'||id==='customHeight')return settings.resolution==='custom';
    if(id==='customRatio'||id==='customRatioWidth'||id==='customRatioHeight')return settings.ratio==='custom';
    if(id==='ratioMatched')return settings.ratio==='source';
    if(id==='msCustomSize'||id==='msCustomWidth'||id==='msCustomHeight')return settings.msResolution==='custom';
    if(id==='msCustomRatio'||id==='msCustomRatioWidth'||id==='msCustomRatioHeight')return settings.msRatio==='custom';
    if(id==='msRatioMatched')return settings.msRatio==='source';
    return true;
  }
  function isRunningHubTarget(settings){
    if(String(settings?.engine||'').toLowerCase()==='runninghub')return true;
    const index=resourceIndex();const target=resolveStableTarget(settings);
    if(target.resource_id){
      const resource=(index.resources||[]).find(item=>item.id===target.resource_id);
      if(resource)return resource.kind==='runninghub_app';
    }
    const connection=(index.connections||[]).find(item=>item.id===(target.connection_id||settings?.connection_id));
    return connection?.protocol==='runninghub';
  }
  function fallbackFields(values,interactive){
    const fields=[];const walk=(object,prefix='')=>Object.entries(object||{}).forEach(([key,value])=>{const path=prefix?`${prefix}.${key}`:key;if(value&&typeof value==='object'&&!Array.isArray(value))walk(value,path);else if(primitive(value))fields.push({id:path,name:path,type:typeof value==='boolean'?'boolean':typeof value==='number'?'number':'text',default:value,ui:{configurable:true}});});walk(values.params);return fields.map(field=>schemaField(field,values,'',interactive));
  }
  async function populateSchema(card,step,values,interactive,request,history=false,promptEl=null){
    const node=step.node||{},settings=values.settings||{};
    const kind=String(settings.apiKind||node.genKind).toLowerCase()==='video'?'video':'image',engine=String(settings.engine||'').toLowerCase();
    const capability=String(node.capability||((node.semantic_type==='prompt'||node.semantic_type==='smart-prompt')?'prompt.generate':(engine==='comfy'?`comfyui.workflow.${kind}`:(engine==='runninghub'||isRunningHubTarget(settings)?`runninghub.app.${kind}`:(kind==='video'?'video.text_to_video':'image.text_to_image')))));
    if(!capability){fallbackFields(values,interactive).forEach(item=>card.querySelector('.canvas-agent-config-controls').appendChild(item));return;}
    try{
      const response=await fetch(schemaUrl(capability,settings),{credentials:'same-origin'});if(!response.ok)throw new Error();const schema=await response.json();if((request!==schemaRequest&&!history)||!card.isConnected)return;
      const paramsPath=String(schema.params_path||'runSettings');const controls=card.querySelector('.canvas-agent-config-controls');
      // A RunningHub app exposes its prompt through a prompt-role field. Mirror
      // the canvas node: surface that text in the top prompt box (and write it
      // back there) instead of rendering a duplicate parameter control.
      const bindPrompt=field=>{if(!promptEl)return;const store=fieldStore(field,values,paramsPath);const initial=String(store.get()??readPrompt(values.params)??'');if(initial){promptEl.value=initial;values.content=initial;store.set(initial);writePrompt(values.params,initial);}const handler=()=>{store.set(promptEl.value);writePrompt(values.params,promptEl.value);values.content=promptEl.value;};promptEl.removeEventListener('input',promptEl._agentPromptHandler||(()=>{}));promptEl._agentPromptHandler=handler;promptEl.addEventListener('input',handler);};
      const renderFields=()=>{controls.innerHTML='';
        (schema.fields||[])
          .filter(field=>!['provider_id','videoProvider'].includes(String(field.id||'')))
          .filter(field=>visible(field,pathValue(values.params,paramsPath)||{}))
          .forEach(field=>{
            const role=String(field.role||field.type||'');
            if(role==='prompt'){bindPrompt(field);return;}
            // Image/video/audio fields are reference inputs supplied by node
            // connections, not editable parameters. Match the canvas node,
            // which excludes them from the parameter panel entirely.
            if(['image','video','audio'].includes(role))return;
            controls.appendChild(schemaField(field,values,paramsPath,interactive,fieldId=>{if(['model','videoModel'].includes(fieldId))void populateSchema(card,step,values,interactive,request,history,promptEl);else if(['resolution','ratio','msResolution','msRatio'].includes(fieldId))renderFields();}));
          });
        window.lucide?.createIcons();};renderFields();
      if(!controls.childElementCount){fallbackFields(values,interactive).forEach(item=>controls.appendChild(item));window.lucide?.createIcons();}
    }catch(_){if((request===schemaRequest||history)&&card.isConnected)fallbackFields(values,interactive).forEach(item=>card.querySelector('.canvas-agent-config-controls').appendChild(item));}
  }
  function config(step,interactive,request,withActions=false,history=false,status=''){
    const values=planValues(step);const card=document.createElement('section');card.className=`canvas-agent-node-config composer-card${history?' canvas-agent-node-config-history':''}`;
    const head=document.createElement('div');head.className='canvas-agent-node-config-head composer-head';const heading=document.createElement('h5');heading.textContent=values.title||text(step);head.appendChild(heading);if(status){const badge=document.createElement('span');badge.className='canvas-agent-plan-state';badge.textContent=status;head.appendChild(badge);}card.appendChild(head);
    const promptRow=document.createElement('div');promptRow.className='prompt-row';const content=document.createElement('textarea');content.className='canvas-agent-config-prompt prompt-input';content.value=values.content;content.disabled=!interactive&&!history;content.readOnly=history;content.placeholder='提示词';content.style.setProperty('--prompt-h','124px');if(history){content.classList.add('canvas-agent-history-prompt');content.setAttribute('aria-expanded','false');content.title='点击展开提示词';content.addEventListener('click',()=>{const expanded=content.classList.toggle('expanded');content.setAttribute('aria-expanded',String(expanded));content.title=expanded?'点击收起提示词':'点击展开提示词';});}content.addEventListener('input',()=>{values.content=content.value;writePrompt(values.params,content.value);});promptRow.appendChild(content);card.appendChild(promptRow);
    const controls=document.createElement('div');controls.className='canvas-agent-config-controls dynamic-params param-row';card.appendChild(controls);
    if(withActions&&interactive){const footer=document.createElement('div');footer.className='canvas-agent-confirm-actions';const authorization=document.createElement('label');authorization.className='setting-check';authorization.innerHTML='<input type="checkbox" id="canvasAgentAuthorizeNodes"><span class="check-box"></span><span>允许本轮修改引用的用户节点</span>';authorization.querySelector('input').addEventListener('change',event=>authorization.classList.toggle('active',event.target.checked));footer.appendChild(authorization);const buttons=document.createElement('div');buttons.className='canvas-agent-plan-actions';[['取消',false,'cascade-run-btn','x'],['确认',true,'run-btn','play']].forEach(([caption,approved,klass,icon])=>{const button=document.createElement('button');button.type='button';button.className=`canvas-agent-action ${klass}`;button.textContent=caption;const glyph=document.createElement('i');glyph.setAttribute('data-lucide',icon);button.prepend(glyph);button.addEventListener('click',()=>window.CanvasAgentPanel.confirm(approved));buttons.appendChild(button);});footer.appendChild(buttons);card.appendChild(footer);}
    card._override=()=>({step_id:values.step_id,title:values.title,content:values.content,params:values.params});void populateSchema(card,step,values,interactive,request,history,content);return card;
  }
  function render(row,options={}){
    const box=options.container||document.getElementById('canvasAgentPlan'),interactive=options.interactive!==false,renderKey=`${row?.version||''}:${interactive?'interactive':'readonly'}`;
    if(!options.force&&!options.container&&row&&state.plan?.version===row.version&&box.dataset.planVersion===renderKey)return;
    const request=++schemaRequest;box.innerHTML='';if(!options.container)state.plan=row||null;const plan=row?.content_json||{},steps=Array.isArray(plan.steps)?plan.steps:[];if(!row){box.hidden=true;return;}box.dataset.planVersion=renderKey;
    const title=document.createElement('h4');title.textContent=plan.goal||'Agent 计划';box.appendChild(title);
    const history=Boolean(options.container)||Boolean(options.history);
    const configurableActions=new Set(['canvas.create_node','canvas.update_node_params','canvas.replace_node_content','canvas.run_node','canvas.run_group']);
    const nodeSteps=steps.filter(step=>step.node||configurableActions.has(step.action));const configs=nodeSteps.map((step,index)=>config(step,interactive,request,interactive&&index===nodeSteps.length-1,history,options.status||''));if(configs.length)configs.forEach(item=>box.appendChild(item));else{const summary=document.createElement('div');summary.className='canvas-agent-plan-meta';summary.textContent=steps.map(text).join('；');box.appendChild(summary);}if(!interactive)box.hidden=false;else box.hidden=false;
    window.lucide?.createIcons();
  }
  const collectOverrides=()=>[...document.querySelectorAll('#canvasAgentPlan .canvas-agent-node-config')].map(card=>card._override?.()).filter(Boolean);
  window.CanvasAgentPlan={render,collectOverrides};
})();
