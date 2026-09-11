// 从 frontend/src/canvas/main.js 剪切出的一键运行/级联生成调度逻辑（M5 拆分批次）。
// 剪切时未改动任何函数签名/内部逻辑，只做了纯粹的位置搬移。
//
// M5 是体量最大、调用链最深的模块（计划里估计约占 15% 行数），采用比
// M1-M4 更谨慎的分批策略：先拆最小风险的独立小函数（本批），再拆中等
// 复杂度的 provider 调用函数，最后才处理核心编排函数 runSmartCascade/
// runGeneration（体量最大、嵌套最深，单独仔细核对）。每一批都单独验证，
// 不一次性全部完成。
//
// 为什么这里不用 ES module 的 export/import（跟 M1-M4 同一个原因）：
// canvas.js 依赖经典 <script> 的全局作用域语义，
// static/canvas.html 里 57 处内联 onclick="xxx()" 都依赖这一点。
// 所以这里同样只做"物理文件拆分"：cascade-run.js 保持经典脚本语法，
// 通过 <script src="cascade-run.js"> 排在 connections.js 之后、main.js
// 之前加载。
//
// === 第 1 批：最小风险的独立小函数 ===
//   smartCascadeAbortError / throwIfSmartCascadeStopRequested /
//   requestSmartCascadeStop / smartCascadeParallelLimit /
//   runSmartCascadeRoundsWithLimit
//
// 依赖的外部全局（都还留在 frontend/src/canvas/main.js / main.js 里，
// 通过共享全局作用域访问，未随本文件迁移）：
//   状态变量：smartCascadeRuns（Map）, smartCascadeActiveLoopId,
//     smartCascadeRunning, smartCascadeStopRequested, comfyInstanceCount
//     （这几个是跨多个功能域共享的全局状态，比如 smartCascadeRunning/
//     smartCascadeStopRequested 还被 syncSmartCascadeLegacyState 等
//     main.js 里的函数读写，不能只归给本模块）
//   循环节点（M2 已拆到 loop-node.js）：smartCascadeRunForLoop
//     （虽然名字看起来像级联相关，但它只是一个简单的 Map 查询包装，
//     M2 阶段就已经确认这几个函数——activeSmartCascadeCount/
//     smartCascadeRunForLoop/smartCascadeIsLoopRunning/
//     syncSmartCascadeLegacyState 等——留在 main.js，因为它们被
//     loop-node.js 依赖，属于"级联运行状态的读取入口"而不是循环节点
//     本身的逻辑）
//   节点设置查询：smartSettingsForNode
//   节点操作：toast, render
//   状态同步：syncSmartCascadeLegacyState

function smartCascadeAbortError(){
    const err = new Error('已停止链路运行');
    err.smartCascadeStopped = true;
    return err;
}
function throwIfSmartCascadeStopRequested(runState=null){
    if(runState?.stopRequested || (!runState && smartCascadeStopRequested)) throw smartCascadeAbortError();
}
function requestSmartCascadeStop(loopId=''){
    const runState = loopId ? smartCascadeRunForLoop(loopId) : (smartCascadeRuns.get(smartCascadeActiveLoopId) || [...smartCascadeRuns.values()][0] || null);
    if(runState){
        if(runState.stopRequested) return;
        runState.stopRequested = true;
        syncSmartCascadeLegacyState(runState.runKey || runState.loopId || loopId);
    } else {
        if(!smartCascadeRunning || smartCascadeStopRequested) return;
        smartCascadeStopRequested = true;
    }
    toast('已请求停止，当前任务完成后停止');
    render();
}
function smartCascadeParallelLimit(chain=[]){
    const hasComfy = (chain || []).some(node => smartSettingsForNode(node)?.engine === 'comfy');
    const hasRunningHub = (chain || []).some(node => smartSettingsForNode(node)?.engine === 'runninghub');
    if(hasRunningHub) return 1;
    return hasComfy ? Math.max(1, Math.min(6, Number(comfyInstanceCount) || 1)) : 6;
}
function canonicalRunSettings(value={}){
    const settings={...(value || {})};
    delete settings.provider_id;
    delete settings.provider;
    delete settings.model;
    delete settings.videoProvider;
    delete settings.videoModel;
    return settings;
}
function workflowTaskCount(runSettings=settings){
    return Math.max(1, Math.min(4, Number(runSettings?.count || 1) || 1));
}
// Turn the per-task settlements recorded by resumeSmartPendingNode into the
// `tasks` array consumed by addSmartGenerationLog, so a multi-task run produces
// one log entry per task_id. Returns null when no settlements are available
// (caller then falls back to a single aggregate log entry).
function smartLogTasksFromNode(node){
    const settlements = node && Array.isArray(node._smartRunSettlements) ? node._smartRunSettlements : null;
    if(node) delete node._smartRunSettlements;
    if(!settlements || !settlements.length) return null;
    return settlements.map(item => ({
        taskId:item.taskId || '',
        upstreamTaskId:item.upstreamTaskId || '',
        outputs:item.outputs || [],
        error:item.error || ''
    }));
}
async function runSmartCascadeRoundsWithLimit(roundIndexes, limit, runner, runState=null){
    let next = 0;
    const workerCount = Math.max(1, Math.min(Number(limit) || 1, roundIndexes.length));
    const workers = Array.from({length:workerCount}, async () => {
        while(next < roundIndexes.length){
            if(runState?.stopRequested || (!runState && smartCascadeStopRequested)) break;
            const roundOffset = next++;
            const current = roundIndexes[roundOffset];
            try {
                await runner(current, roundOffset);
            } catch(e) {
                if(e?.smartCascadeStopped) break;
                throw e;
            }
        }
    });
    await Promise.all(workers);
}

// === 第 2 批：中等复杂度的 provider 调用函数 ===
//   ComfyUI 队列基础设施：createSmartComfyTask / comfyParamsFromWorkflowValues
//   ComfyUI 具体调用：comfyFieldKind / runComfyGeneration / comfyNameForRef / sleep
//   其它 provider 调用：runApiGeneration / submitRunningHubGeneration /
//     pollRunningHubTask / runRunningHubGeneration / runApiVideoGeneration /
//     urlToBase64
//
// 这批函数在原文件里物理上分成两段（中间隔着 runSmartCascade/
// runSmartCascadeFromLoop/runGeneration 这几个第 3 批才处理的核心编排
// 函数，没有跟着搬），搬到这里后重新拼接为连续代码块，不影响运行时行为
// （经典脚本按声明顺序执行 top-level 代码，这些都是纯函数声明，声明顺序
// 本身不影响后续调用）。
//
// 依赖的外部全局（都还留在 frontend/src/canvas/main.js / main.js 里）：
//   状态变量：settings, comfyWorkflows, smartClientId, activeRunningHubTaskPolls
//   工具函数（M1 已拆到 utils.js）：tr
//   媒体判断：imageRefsOnly, videoRefsOnly, audioRefsOnly, resultMediaUrls,
//     mediaKindForUrls, fileIdFromUrl, fileDownloadUrl, filePreviewUrl
//   错误/配额处理：smartResponseError, checkQuotaWarningFromResult,
//     StorageQuotaSignal
//   节点操作（M3 已拆到 node-model.js / node-layout.js）：createNode, nodeRect
//   节点操作：attachRunMeta, addConnection, clearPromptInput, scheduleSave,
//     finalizePendingNode, selectedNode
//   RunningHub 相关：selectedRunningHubRef, rhActiveFields, rhMediaForRun,
//     rhBuildNodeInfoList
//   视频生成相关：videoGenerationMode
//   随机参数：comfyRandomEnabledField, smartComfyRandomActive, smartComfyRandomValue

async function createSmartComfyTask(payload){
    const res = await fetch('/api/canvas-comfy-tasks', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
    });
    if(!res.ok) throw await smartResponseError(res, tr('smart.errRunFailed'));
    return res.json();
}
function comfyParamsFromWorkflowValues(config, values={}){
    const params = {};
    (config?.fields || []).forEach(field => {
        if(!field?.node || !field?.input) return;
        let value = values[field.id];
        if(value === undefined) value = field.default;
        if(field.type === 'number' || field.type === 'slider'){
            const n = Number(value);
            if(Number.isFinite(n)) value = field.step && Number(field.step) < 1 ? n : Math.round(n);
        } else if(field.type === 'boolean'){
            value = Boolean(value);
        } else if(field.type === 'dropdown' && typeof value === 'string'){
            const s = value.trim();
            if(s && /^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(s)) value = s.includes('.') || /e/i.test(s) ? Number(s) : parseInt(s, 10);
        }
        params[field.node] = params[field.node] || {};
        params[field.node][field.input] = value;
    });
    return params;
}
function comfyFieldKind(field){
    if(['image','video','audio','prompt'].includes(field?.type)) return field.type;
    // Compatibility for configurations saved before the prompt type existed.
    if(field?.type === 'textarea') return 'prompt';
    return 'setting';
}
async function runApiGeneration(prompt, refs, runSettings=settings){
    if(!runSettings.connection_id || !runSettings.model_id) throw new Error(tr('smart.errNoApiModel'));
    // Keep the canvas contract intact. Provider-specific field mapping belongs
    // to the backend, where it is shared by direct runs and Agent executions.
    const payload = {prompt, run_settings:canonicalRunSettings(runSettings), reference_images:imageRefsOnly(refs), connection_id:runSettings.connection_id, model_id:runSettings.model_id, resource_id:runSettings.resource_id || ''};
    const task = await fetch('/api/canvas-image-tasks', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}).then(async r => {
        if(!r.ok) throw await smartResponseError(r);
        return r.json();
    });
    const taskIds = Array.isArray(task?.child_task_ids) && task.child_task_ids.length
        ? task.child_task_ids
        : (task?.task_id ? [task.task_id] : []);
    return {taskIds, count:Number(task?.count || 1), connectionId:runSettings.connection_id, modelId:runSettings.model_id, resourceId:runSettings.resource_id || ''};
}
async function submitRunningHubGeneration(prompt, refs, runSettings=settings){
    const ref = selectedRunningHubRef(runSettings);
    if(!ref) throw new Error(tr('smart.rhNeedConfig'));
    const fields = rhActiveFields(runSettings);
    if(!fields.length) throw new Error(tr('smart.rhNeedFields'));
    const randomValues = {};
    const media = rhMediaForRun(prompt, refs);
    const nodeInfoList = await rhBuildNodeInfoList(media, runSettings, randomValues);
    const stable = runningHubTarget(ref, runSettings);
    const body = {webappId:ref.id, nodeInfoList, instanceType:runSettings.rhInstanceType || '', connection_id:stable.connection_id, resource_id:stable.resource_id};
    // Canvas RunningHub apps run as canvas tasks (worker submits + polls the
    // upstream). We only receive the local task_id here and poll it locally.
    const submit = await fetch('/api/canvas-runninghub-tasks', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
    }).then(async r => {
        if(!r.ok) throw await smartResponseError(r, tr('smart.rhFailed'));
        const data = await r.json();
        if(data.success === false) throw new Error(data.detail || data.error || tr('smart.rhFailed'));
        return data.data || data;
    });
    const taskId = submit.task_id;
    if(!taskId) throw new Error(tr('smart.rhNoTaskId'));
    return {
        ...submit,
        taskId,
        connectionId:stable.connection_id,
        resourceId:stable.resource_id,
        mode:'app'
    };
}
async function pollRunningHubTask(taskId, target={}){
    if(!taskId) throw new Error(tr('smart.rhNoTaskId'));
    if(activeRunningHubTaskPolls.has(taskId)) return activeRunningHubTaskPolls.get(taskId);
    const promise = (async () => {
        for(let i = 0; i < 720; i++){
            await sleep(5000);
            const task = await fetch(`/api/canvas-runninghub-tasks/${encodeURIComponent(taskId)}`).then(async r => {
                if(!r.ok) throw await smartResponseError(r, tr('smart.rhFailed'));
                return r.json();
            });
            if(task.status === 'succeeded'){
                const result = task.result || {};
                const outputs = resultMediaUrls(result);
                checkQuotaWarningFromResult(result);
                return outputs;
            }
            if(task.status === 'failed' || task.status === 'interrupted' || task.status === 'timed_out'){
                if(task.error_code === 'runninghub_key_busy'){
                    toast('RunningHub 正忙：当前 API Key 有任务在执行，请稍后重试。');
                }
                throw new Error(task.error || tr('smart.rhFailed'));
            }
        }
        throw new Error(tr('smart.rhTimeout'));
    })();
    activeRunningHubTaskPolls.set(taskId, promise);
    try {
        return await promise;
    } finally {
        activeRunningHubTaskPolls.delete(taskId);
    }
}
async function runRunningHubGeneration(prompt, refs, runSettings=settings){
    const submit = await submitRunningHubGeneration(prompt, refs, runSettings);
    return pollRunningHubTask(submit.taskId, submit);
}
async function runApiVideoGeneration(prompt, refs, runSettings=settings){
    if(!runSettings.videoConnectionId || !runSettings.videoModelId) throw new Error(tr('smart.errNoVideoModel'));
    const generationMode = videoGenerationMode(runSettings);
    const useReferences = generationMode !== 'text';
    const refImages = (useReferences ? imageRefsOnly(refs) : []).map((ref, i) => ({
        url:ref.url, name:ref.name || `图${i + 1}`
    }));
    const payload = {
        prompt,
        run_settings: canonicalRunSettings(runSettings),
        connection_id:runSettings.videoConnectionId, model_id:runSettings.videoModelId, resource_id:runSettings.videoResourceId || '',
        images: refImages,
        videos: useReferences ? videoRefsOnly(refs).map(ref => ref.url).filter(Boolean) : [],
        audios: useReferences ? audioRefsOnly(refs).map(ref => ref.url).filter(Boolean).slice(0, 3) : []
    };
    const result = await fetch('/api/canvas-video', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
    }).then(async r => { if(!r.ok) throw await smartResponseError(r, tr('smart.errRunFailed')); return r.json(); });
    checkQuotaWarningFromResult(result);
    // Prefer video_items: they carry the MinIO file_id, which lets the log
    // thumbnail reuse the backend FFmpeg poster frame (/api/files/<id>/thumb)
    // instead of loading the whole video to grab a first frame.
    const items = Array.isArray(result?.video_items) && result.video_items.length
        ? result.video_items
        : resultMediaUrls(result);
    return {
        urls:items,
        taskId:(result && result.task_id) || '',
        upstreamTaskId:(result && result.upstream_task_id) || ''
    };
}
async function urlToBase64(itemOrUrl){
    const target = typeof itemOrUrl === 'string'
        ? String(itemOrUrl || '')
        : (fileDownloadUrl(itemOrUrl) || filePreviewUrl(itemOrUrl) || itemOrUrl?.url || '');
    const res = await fetch(target);
    if(!res.ok) throw new Error(tr('smart.errImageRead'));
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
async function runComfyGeneration(node, prompt, refs, pendingNode, meta){
    const allRefs = refs || [];
    refs = imageRefsOnly(allRefs);
    const workflowName = settings.comfyWorkflow || comfyWorkflows[0]?.name || '';
    if(!workflowName) throw new Error(tr('smart.errNeedWorkflow'));
    const wf = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}`).then(async r => {
        if(!r.ok) throw await smartResponseError(r);
        return r.json();
    });
    const fields = wf.config?.fields || [];
    const values = {};
    fields.filter(f => comfyFieldKind(f) === 'prompt').forEach(field => {
        values[field.id] = String(prompt || '').trim() || field.default || '';
    });
    const assignMediaFields = async (mediaFields, mediaRefs) => {
        for(let i = 0; i < mediaFields.length && i < mediaRefs.length; i++){
            values[mediaFields[i].id] = await comfyNameForRef(mediaRefs[i]);
        }
    };
    await assignMediaFields(fields.filter(f => comfyFieldKind(f) === 'image'), refs);
    await assignMediaFields(fields.filter(f => comfyFieldKind(f) === 'video'), videoRefsOnly(allRefs));
    await assignMediaFields(fields.filter(f => comfyFieldKind(f) === 'audio'), audioRefsOnly(allRefs));
    fields.filter(f => comfyFieldKind(f) === 'setting').forEach(field => {
        values[field.id] = settings.comfyParams?.[field.id] ?? field.default;
    });
    const stable = stableCanvasTarget('comfyui_workflow', 'comfyui', workflowName);
    const createTask = async () => {
        const taskValues = {...values};
        fields.filter(f => comfyFieldKind(f) === 'setting' && comfyRandomEnabledField(f) && smartComfyRandomActive(f.id))
            .forEach(field => { taskValues[field.id] = smartComfyRandomValue(field); });
        return createSmartComfyTask({prompt, workflow_json:workflowName, params:comfyParamsFromWorkflowValues(wf.config || {fields:[]}, taskValues), type:'workflow-custom', client_id:smartClientId, ...stable});
    };
    const tasks = await Promise.all(Array.from({length:workflowTaskCount(settings)}, createTask));
    if(tasks.some(task => !task?.task_id)) throw new Error(tr('smart.errRunFailed'));
    if(pendingNode){
        pendingNode.pendingTasks = tasks.map(task => ({taskId:task.task_id, kind:'image', connectionId:stable.connection_id, resourceId:stable.resource_id, taskType:'comfy'}));
        pendingNode.pending = tasks.length;
        pendingNode.pendingCandidatePool = true;
        pendingNode.running = false;
        render();
        await saveCanvas();
        await resumeSmartPendingNode(pendingNode);
        if(!(pendingNode.images || []).length) throw new Error(tr('smart.errComfyNoImages'));
        clearPromptInput({preserveDraft:true});
        scheduleSave();
        return;
    }
    const results = await Promise.all(tasks.map(task => pollCanvasComfyTask(task.task_id)));
    const urls = results.flatMap(result => resultMediaUrls(result));
    if(!urls.length) throw new Error(tr('smart.errComfyNoImages'));
    const fallbackKind = results.some(result => result?.videos?.length) ? 'video' : results.some(result => result?.audios?.length) ? 'audio' : results.some(result => result?.texts?.length) ? 'text' : 'image';
    const kind = mediaKindForUrls(urls, fallbackKind);
    const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
    const out = urls.map((url, i) => ({url, name:`comfy-${i + 1}.${ext}`, kind})).filter(x => x.url);
    if(!out.length) throw new Error(tr('smart.errComfyEmpty'));
    const outputUrls = out.map(o => o.url);
    if(pendingNode){
        finalizePendingNode(pendingNode, outputUrls, meta, kind);
    } else {
        const created = createNode((node.x || 0) + nodeRect(node).width + 40, node.y || 0, out);
        attachRunMeta(created, meta);
        addConnection(node.id, created.id);
    }
    clearPromptInput({preserveDraft:true});
    scheduleSave();
}
async function comfyNameForRef(ref){
    if(ref.comfy_name) return ref.comfy_name;
    const response = await fetch(ref.url);
    if(!response.ok) return ref.name || ref.url;
    const blob = await response.blob();
    const form = new FormData();
    form.append('files', blob, ref.name || 'smart-ref.png');
    const data = await fetch('/api/upload', {method:'POST', body:form}).then(async r => {
        if(!r.ok) throw await smartResponseError(r);
        return r.json();
    });
    const name = data.files?.[0]?.comfy_name || ref.name || ref.url;
    const node = selectedNode();
    const image = node?.images?.find(img => img.url === ref.url);
    if(image) image.comfy_name = name;
    ref.comfy_name = name;
    return name;
}

// === 第 3 批：核心编排函数（体量最大、嵌套最深）===
//   runCascadeStepIntoNode / runLoopRoundIntoSlot / runClonedLoopChain /
//   appendCascadeRefsToReceiver / cascadeRefsFromOutputs /
//   smartCascadeStopText / runSmartCascade / runSmartCascadeFromLoop /
//   runGeneration
//
// 这批函数密集读写以下全局状态（经典脚本共享全局作用域，直接重新赋值，
// 跟 M1-M4/本文件第1、2批同一个模式，未做任何改动）：
//   settings, selectedId, selectedIds, selectedImage, smartLoopContext,
//   smartCascadeRunPath, smartCascadeSilentSelection, activeComposerSubject,
//   lastComposerNodeId, undoSuppressed, nodes, candidatePanelNodeId,
//   candidatePanelIndex, canvas
//
// 依赖的外部全局（都还留在 frontend/src/canvas/main.js / main.js 里）：
//   DOM 元素：promptInput, composer, runBtn, cascadeRunBtn
//   循环节点（M2 已拆到 loop-node.js）：collectLoopChainSubgraph,
//     cloneLoopChainForRound, fitSmartLoopNode（间接）
//   连线（M4 已拆到 connections.js）：refreshConnectionLayer
//   节点布局/模型（M3）：nodeRect, createNode
//   节点操作：selectedNode, canRunSmartCascade, savePromptDraftForCurrent,
//     smartCascadeGraphForTail, resolveSmartCascadeLoop,
//     smartCascadeIsLoopRunning, smartCascadeAnyRunning,
//     isDirectLoopTargetRun, syncSmartCascadeLegacyState, pushUndo,
//     loopOutputSlotForRound, tagLoopOutputSlot, createLoopOutputSlot,
//     updateComposer, refsForDirectLoopRound, showDirectLoopRoundPreview,
//     isSmartImageNode, upstreamLoopPromptNodesFor, relayLoopPromptNodesForTarget,
//     relayLoopPromptNodesForEdge, isSmartAssetImageNode,
//     defaultReferenceImagesFor, finishLoopTargetPreviewState,
//     cascadeTailForLoop, handleStorageQuotaSignal
//   节点数据/输出：selfReferenceImagesForNode, outputImagesForNode,
//     buildPromptRequestForNode, buildPromptRequest, smartPromptInputEnabledForSettings,
//     smartSettingsForNode, applySourceRatioToSettings, validOutpaintSize,
//     rememberRecentSmartSettings, smartRunSnapshot, smartRunPlatformLabel（间接）,
//     snapshotRunMeta, addSmartGenerationLog, generatedImageWithRunMeta,
//     stripImageGenerationMeta, replaceOutputsToNodeWithHistory,
//     generateUrlsForCurrentSettings, cleanHistoryImages,
//     addGeneratedCandidatesToNode, uniqueGeneratedImages,
//     resumeSmartPendingNode, saveCanvas,
//     isApiLikeEngine, smartImageUsesWorkflowInput, isGeneratedResultNode,
//     createPendingOutputFromSource, stripRunInputMeta, pendingBoxSize,
//     attachRunMeta, coolNodeRunningState, coolRunButton,
//     clearNodeRunningState, restoreSourceVisualState, finalizePendingNode,
//     restoreFromExtraction, setNodeMainCandidate, candidateCountForNode
//   工具函数（M1 已拆到 utils.js）：tr, trf, nowMs

async function runCascadeStepIntoNode(sourceNode, targetNode, inputRefs, ctx=smartLoopContext){
    const outputNode = targetNode || sourceNode;
    if(!sourceNode || !targetNode || !outputNode) return [];
    const requestNode = targetNode;
    const previousSettings = cloneSmartSettings(settings);
    const runSettings = {...cloneSmartSettings(settings), ...cloneSmartSettings(smartSettingsForNode(requestNode) || {})};
    settings = runSettings;
    const outpaintSize = validOutpaintSize(requestNode);
    applySourceRatioToSettings('', requestNode, runSettings);
    const incoming = (inputRefs || []).filter(img => img?.url);
    const selfRefs = sourceNode?.type === 'smart-loop' ? [] : selfReferenceImagesForNode(sourceNode, false, ctx).filter(img => img?.url);
    const sourceRefs = (incoming.length ? incoming : (selfRefs.length ? selfRefs : defaultReferenceImagesFor(requestNode, false, ctx))).filter(img => img?.url);
    const refsForRequest = sourceRefs.length ? sourceRefs : null;
    const request = buildPromptRequestForNode(
        requestNode,
        refsForRequest,
        ctx
    );
    const prompt = (request.prompt || '').trim();
    const displayPrompt = (request.displayPrompt || '').trim();
    if((!prompt && smartPromptInputEnabledForSettings(runSettings)) || (!displayPrompt && smartPromptInputEnabledForSettings(runSettings))){
        settings = previousSettings;
        throw new Error('链路节点缺少提示词');
    }
    const meta = {
        prompt,
        displayPrompt:request.displayPrompt || '',
        promptRefs:(request.refs || []).map(ref => ({file_id:ref.file_id || '', url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? ''})).filter(ref => ref.url),
        inputRefs:(request.refs || []).map(ref => ({file_id:ref.file_id || '', url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? '', kind:ref.kind || ''})).filter(ref => ref.url),
        sourceNodeId:sourceNode.id,
        settings:JSON.parse(JSON.stringify(runSettings)),
        createdAt:Date.now()
    };
    if(requestNode.promptDraftHtml != null){
        meta.promptHtml = requestNode.promptDraftHtml;
        meta.promptText = requestNode.promptDraftText || request.displayPrompt || '';
    }
    const logKind = isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video' ? 'video' : 'image';
    const runLog = smartRunSnapshot(requestNode, prompt, request.refs || [], logKind);
    const runLogStart = nowMs();
    const targetPromptState = {
        promptDraftHtml:targetNode.promptDraftHtml,
        promptDraftText:targetNode.promptDraftText,
        runPrompt:targetNode.runPrompt,
        runModelPrompt:targetNode.runModelPrompt,
        runPromptRefs:targetNode.runPromptRefs ? targetNode.runPromptRefs.map(ref => ({...ref})) : undefined,
        runInputRefs:targetNode.runInputRefs ? targetNode.runInputRefs.map(ref => ({...ref})) : undefined,
        runSettings:targetNode.runSettings ? cloneSmartSettings(targetNode.runSettings) : undefined,
        sourceNodeId:targetNode.sourceNodeId,
        runAt:targetNode.runAt
    };
    outputNode.running = true;
    outputNode.runStartedAt = nowMs();
    delete outputNode.runFinishedAt;
    delete outputNode.runElapsedMs;
    outputNode.runTimerHidden = false;
    rememberRecentSmartSettings(runSettings, requestNode);
    render();
    settings = previousSettings;
    try {
        const result = await generateUrlsForCurrentSettings(outputNode, prompt, request.refs || [], runSettings);
        if(!result.urls?.length) throw new Error(result.kind === 'video' ? tr('smart.errNoOutVideos') : tr('smart.errNoOutImages'));
        if(outpaintSize) delete requestNode.outpaintSize;
        addSmartGenerationLog({run:{...runLog, kind:result.kind || logKind}, outputs:result.urls, runMs:nowMs() - runLogStart, tasks:result.tasks || null});
        const ext = result.kind === 'video' ? 'mp4' : result.kind === 'audio' ? 'mp3' : result.kind === 'text' ? 'txt' : 'png';
        const additions = result.urls.map((item, i) => {
            const url = typeof item === 'string' ? item : item?.url || '';
            const image = {url, file_id:(typeof item === 'object' && item.file_id) || '', name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:(typeof item === 'object' && item.kind) || result.kind, generatedResult:true};
            return result.kind === 'image' ? generatedImageWithRunMeta(image, meta) : stripImageGenerationMeta(image);
        }).filter(item => item.url);
        replaceOutputsToNodeWithHistory(outputNode, additions, result.kind, null, {skipShift:Boolean(ctx?.nodeId)});
        outputNode.runPrompt = targetPromptState.runPrompt;
        outputNode.runModelPrompt = targetPromptState.runModelPrompt;
        outputNode.runPromptRefs = targetPromptState.runPromptRefs || [];
        outputNode.runInputRefs = targetPromptState.runInputRefs || [];
        outputNode.runSettings = targetPromptState.runSettings;
        outputNode.sourceNodeId = targetPromptState.sourceNodeId;
        outputNode.runAt = targetPromptState.runAt;
        if(targetPromptState.promptDraftHtml === undefined) delete outputNode.promptDraftHtml;
        else outputNode.promptDraftHtml = targetPromptState.promptDraftHtml;
        if(targetPromptState.promptDraftText === undefined) delete outputNode.promptDraftText;
        else outputNode.promptDraftText = targetPromptState.promptDraftText;
        ['runPrompt','runModelPrompt','runSettings','sourceNodeId','runAt'].forEach(key => {
            if(targetPromptState[key] === undefined) delete outputNode[key];
        });
        settings = previousSettings;
        render();
        return additions;
    } catch(e) {
        settings = previousSettings;
        outputNode.running = false;
        addSmartGenerationLog({run:runLog, outputs:[], runMs:nowMs() - runLogStart, error:e.message || String(e), tasks:smartLogTasksFromNode(outputNode)});
        render();
        throw e;
    }
}
async function runLoopRoundIntoSlot(loopNode, rootNode, outputSlot, loopIndex, ctx){
    if(!loopNode || !rootNode || !outputSlot) return [];
    const previousSettings = cloneSmartSettings(settings);
    const edgeKey = `${rootNode.id}->${outputSlot.id}`;
    const runSettings = {...cloneSmartSettings(settings), ...cloneSmartSettings(smartSettingsForNode(rootNode) || {})};
    settings = runSettings;
    try {
        const refsForRequest = outputImagesForNode(loopNode, true, ctx).filter(img => img?.url);
        const request = buildPromptRequestForNode(rootNode, refsForRequest.length ? refsForRequest : null, ctx);
        const prompt = (request.prompt || '').trim();
        const displayPrompt = (request.displayPrompt || '').trim();
        if((!prompt && smartPromptInputEnabledForSettings(runSettings)) || (!displayPrompt && smartPromptInputEnabledForSettings(runSettings))) throw new Error('链路节点缺少提示词');
        const meta = {
            prompt,
            displayPrompt:request.displayPrompt || '',
            promptRefs:(request.refs || []).map(ref => ({file_id:ref.file_id || '', url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? ''})).filter(ref => ref.url),
            inputRefs:(request.refs || []).map(ref => ({file_id:ref.file_id || '', url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? '', kind:ref.kind || ''})).filter(ref => ref.url),
            sourceNodeId:rootNode.id,
            settings:JSON.parse(JSON.stringify(runSettings)),
            createdAt:Date.now()
        };
        const logKind = isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video' ? 'video' : 'image';
        const runLog = smartRunSnapshot(rootNode, prompt, request.refs || [], logKind);
        const runLogStart = nowMs();
        const expectedCount = isApiLikeEngine(runSettings.engine) && runSettings.apiKind !== 'video'
            ? Math.max(1, Math.min(4, Number(runSettings.count || 1)))
            : ['comfy', 'runninghub'].includes(runSettings.engine) ? workflowTaskCount(runSettings) : 1;
        outputSlot.queued = false;
        outputSlot.running = true;
        outputSlot.pending = expectedCount;
        outputSlot.pendingCandidatePool = true;
        outputSlot.runStartedAt = nowMs();
        delete outputSlot.runFinishedAt;
        delete outputSlot.runElapsedMs;
        outputSlot.runTimerHidden = false;
        const runPath = smartCascadePathForCtx(ctx);
        if(runPath?.states) {
            runPath.states[edgeKey] = 'active';
            refreshConnectionLayer();
        }
        render();
        settings = previousSettings;
        let result;
        if(isApiLikeEngine(runSettings.engine) && runSettings.apiKind !== 'video'){
            const taskResult = await runApiGeneration(prompt, request.refs || [], runSettings);
            const taskIds = Array.isArray(taskResult?.taskIds) ? taskResult.taskIds : [];
            if(!taskIds.length) throw new Error(tr('smart.errRunFailed'));
            const existing = cleanHistoryImages(outputSlot.images || []);
            if(existing.length){
                addGeneratedCandidatesToNode(outputSlot, existing, {main:'preserve'});
                outputSlot.images = [];
            }
            outputSlot.pendingTasks = taskIds.map(taskId => ({taskId, kind:'image', connectionId:taskResult.connectionId, modelId:taskResult.modelId, resourceId:taskResult.resourceId}));
            outputSlot.pending = Math.max(taskIds.length, Number(outputSlot.pending || 0) || taskIds.length);
            outputSlot.pendingCandidatePool = true;
            outputSlot.running = false;
            render();
            await saveCanvas();
            await resumeSmartPendingNode(outputSlot);
            result = {urls:(outputSlot.images || []).map(img => img?.url ? img : null).filter(Boolean), kind:'image', tasks:smartLogTasksFromNode(outputSlot)};
        } else {
            result = await generateUrlsForCurrentSettings(outputSlot, prompt, request.refs || [], runSettings);
        }
        if(!result.urls?.length) throw new Error(result.kind === 'video' ? tr('smart.errNoOutVideos') : tr('smart.errNoOutImages'));
        let additions;
        if(isApiLikeEngine(runSettings.engine) && runSettings.apiKind !== 'video'){
            additions = uniqueGeneratedImages(outputSlot.images || []).filter(img => img?.url);
            if(meta) attachRunMeta(outputSlot, meta);
        } else {
            const ext = result.kind === 'video' ? 'mp4' : result.kind === 'audio' ? 'mp3' : result.kind === 'text' ? 'txt' : 'png';
            additions = result.urls.map((item, i) => {
                const url = typeof item === 'string' ? item : item?.url || '';
                const image = {url, file_id:(typeof item === 'object' && item.file_id) || '', name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:(typeof item === 'object' && item.kind) || result.kind, generatedResult:true};
                return result.kind === 'image' ? generatedImageWithRunMeta(image, meta) : stripImageGenerationMeta(image);
            }).filter(item => item.url);
            replaceOutputsToNodeWithHistory(outputSlot, additions, result.kind, meta, {skipShift:Boolean(ctx?.nodeId)});
        }
        if(runPath?.states) {
            runPath.states[edgeKey] = 'done';
            refreshConnectionLayer();
        }
        addSmartGenerationLog({run:{...runLog, kind:result.kind || logKind}, outputs:result.urls, runMs:nowMs() - runLogStart, tasks:result.tasks || null});
        return additions;
    } catch(e) {
        outputSlot.queued = false;
        outputSlot.pending = 0;
        outputSlot.running = false;
        delete outputSlot.pendingCandidatePool;
        throw e;
    } finally {
        settings = previousSettings;
    }
}
async function runClonedLoopChain(clonedRoot, subgraphEdges, idMap, ctx, runState){
    if(!clonedRoot) return;
    const childrenMap = new Map();
    subgraphEdges.forEach(edge => {
        const from = idMap.get(edge.from);
        const to = idMap.get(edge.to);
        if(!from || !to) return;
        if(!childrenMap.has(from)) childrenMap.set(from, []);
        childrenMap.get(from).push(to);
    });
    const producedRefs = new Map();
    const runBranch = async (sourceId, incomingRefs=[]) => {
        throwIfSmartCascadeStopRequested(runState);
        const source = nodes.find(n => n.id === sourceId);
        if(!source) return;
        const targets = (childrenMap.get(sourceId) || []).map(id => nodes.find(n => n.id === id)).filter(Boolean);
        let sharedRefs = incomingRefs;
        for(let index = 0; index < targets.length; index++){
            throwIfSmartCascadeStopRequested(runState);
            const target = targets[index];
            const edgeKey = `${sourceId}->${target.id}`;
            if(runState.runPath){ runState.runPath.states[edgeKey] = 'active'; refreshConnectionLayer(); }
            let outputs;
            if(index === 0){
                outputs = await runCascadeStepIntoNode(source, target, incomingRefs, ctx);
                sharedRefs = cascadeRefsFromOutputs(outputs, target);
            } else {
                outputs = appendCascadeRefsToReceiver(target, sharedRefs, ctx);
            }
            if(runState.runPath){ runState.runPath.states[edgeKey] = 'done'; refreshConnectionLayer(); }
            const refs = index === 0 ? sharedRefs : cascadeRefsFromOutputs(outputs, target);
            producedRefs.set(target.id, refs);
            await runBranch(target.id, refs);
        }
    };
    // 克隆根节点的输入素材来自其上游素材节点。
    const rootRefs = defaultReferenceImagesFor(clonedRoot, true, ctx).filter(img => img?.url);
    // clonedRoot 本身需要先生成：它没有链路内上游，因此用其素材节点作为输入直接生成到自己。
    const rootUpstream = primaryImageInputFor(clonedRoot, {includeFlow:true});
    if(rootUpstream){
        const edgeKey = `${rootUpstream.id}->${clonedRoot.id}`;
        if(runState.runPath){ runState.runPath.states[edgeKey] = 'active'; refreshConnectionLayer(); }
        const outputs = await runCascadeStepIntoNode(rootUpstream, clonedRoot, rootRefs, ctx);
        if(runState.runPath){ runState.runPath.states[edgeKey] = 'done'; refreshConnectionLayer(); }
        producedRefs.set(clonedRoot.id, cascadeRefsFromOutputs(outputs, clonedRoot));
    } else {
        producedRefs.set(clonedRoot.id, rootRefs);
    }
    await runBranch(clonedRoot.id, producedRefs.get(clonedRoot.id) || rootRefs);
}
function appendCascadeRefsToReceiver(node, refs, ctx=smartLoopContext){
    if(!node || !refs?.length) return [];
    const additions = refs
        .filter(ref => ref?.url)
        .map((ref, i) => stripImageGenerationMeta({
            file_id:ref.file_id || '',
            url:ref.url,
            name:ref.name || `output-${i + 1}.png`,
            kind:ref.kind || (isVideoMediaItem(ref) ? 'video' : 'image')
        }));
    if(!additions.length) return [];
    replaceOutputsToNodeWithHistory(node, additions, mediaKindForUrls(additions, additions.some(isVideoMediaItem) ? 'video' : 'image'), null, {skipShift:Boolean(ctx?.nodeId)});
    render();
    return additions;
}
function cascadeRefsFromOutputs(outputs, targetNode){
    return (outputs || []).filter(img => img?.url).map((img, index) => ({
        file_id:img.file_id || '',
        url:img.url,
        name:img.name || `图${index + 1}`,
        kind:img.kind || 'image',
        role:`image_${index + 1}`,
        nodeId:targetNode?.id || '',
        imageIndex:targetNode ? (targetNode.images || []).length - outputs.length + index : index
    }));
}
function smartCascadeStopText(stopping=false){
    return stopping ? '停止中...' : '停止运行';
}
async function runSmartCascade(targetNode=null){
    const tail = targetNode || selectedNode();
    if(!canRunSmartCascade(tail)){ toast('请选择链路结尾图片节点'); return; }
    savePromptDraftForCurrent();
    const graph = smartCascadeGraphForTail(tail);
    const chain = graph.path;
    const loop = resolveSmartCascadeLoop(tail.id);
    const loopId = loop?.node?.id || '';
    if(loopId && smartCascadeIsLoopRunning(loopId)){ requestSmartCascadeStop(loopId); return; }
    if(!loopId && smartCascadeAnyRunning()){ requestSmartCascadeStop(); return; }
    const directLoopTargetRun = Boolean(loop && isDirectLoopTargetRun(loop, tail, graph));
    const singleNodeLoopRun = Boolean(loop && (chain.length === 1 || directLoopTargetRun));
    if(!graph.edges.length && !singleNodeLoopRun){ toast(tr('smart.loopNoChain')); return; }
    const originalSelected = selectedId;
    const originalSettings = cloneSmartSettings(settings);
    const originalPromptHtml = promptInput.innerHTML;
    const runKey = loopId || `cascade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runState = {runKey, loopId, stopRequested:false, runPath:null};
    smartCascadeRuns.set(runKey, runState);
    syncSmartCascadeLegacyState(runKey);
    smartCascadeSilentSelection = true;
    runBtn.disabled = true;
    cascadeRunBtn.disabled = false;
    pushUndo();
    const totalRounds = loop?.count || 1;
    const startIndex = Math.max(1, Number(loop?.node?.loopStart) || 1);
    const batchSize = loop?.node?.imageInput ? Math.max(1, Math.min(100, Number(loop.node.imageBatchSize) || 1)) : 1;
    const endIndex = startIndex + (totalRounds - 1) * batchSize;
    const loopMode = loop?.mode === 'parallel' ? 'parallel' : 'serial';
    const parallelLimit = loopMode === 'parallel' && totalRounds > 1 ? smartCascadeParallelLimit(chain) : 1;
    // ── 循环级联新逻辑：保留并跳过原链路，为每一轮克隆一条完整链路（不含循环节点），
    //    每条链路由「装当前轮素材的图片节点」驱动。串行=跑完一条建一条；并行=先建跑 parallelLimit 条，之后每完成一条再建一条。──
    if(loop && graph.root){
        const subgraph = collectLoopChainSubgraph(graph.root, graph);
        if(!subgraph.nodes.length){ toast(tr('smart.loopNoChain')); smartCascadeRuns.delete(runKey); syncSmartCascadeLegacyState(); smartCascadeSilentSelection = false; runBtn.disabled = smartCascadeAnyRunning(); cascadeRunBtn.disabled = false; return; }
        runState.runPath = {states:{}};
        smartCascadeRunPath = runState.runPath;
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        try {
            const columnsPerRow = loopMode === 'parallel' ? Math.max(1, parallelLimit) : 1;
            const runOneRound = async (loopIndex, roundOffset) => {
                throwIfSmartCascadeStopRequested(runState);
                const ctx = {index:loopIndex, total:endIndex, nodeId:loop.node.id, forceWorkflow:subgraph.nodes.length > 1, runState};
                const {idMap, clonedRoot} = cloneLoopChainForRound(subgraph, graph.root, loop.node, loopIndex, endIndex, roundOffset, columnsPerRow);
                render();
                refreshConnectionLayer();
                await runClonedLoopChain(clonedRoot, subgraph.edges, idMap, ctx, runState);
            };
            const roundIndexes = Array.from({length:totalRounds}, (_, round) => startIndex + round * batchSize);
            if(loopMode === 'parallel' && totalRounds > 1){
                // 并行：worker 池，最多 parallelLimit 条同时进行，每条建完即跑，完成后 worker 领下一轮再建再跑。
                await runSmartCascadeRoundsWithLimit(roundIndexes, parallelLimit, (loopIndex, roundOffset) => runOneRound(loopIndex, roundOffset), runState);
            } else {
                // 串行：跑完一条链路再建下一条。
                for(let round = 0; round < roundIndexes.length; round++){
                    throwIfSmartCascadeStopRequested(runState);
                    await runOneRound(roundIndexes[round], round);
                }
            }
            throwIfSmartCascadeStopRequested(runState);
            smartLoopContext = null;
            selectedId = '';
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            activeComposerSubject = null;
            lastComposerNodeId = '';
            composer.classList.remove('open');
            settings = originalSettings;
            promptInput.innerHTML = originalPromptHtml;
            scheduleSave();
            toast(totalRounds > 1
                ? trf(loopMode === 'parallel' ? 'smart.loopParallelRoundsDone' : 'smart.loopRunRoundsDone', {n:totalRounds})
                : tr('smart.loopRunDone'));
        } catch(e) {
            smartLoopContext = null;
            selectedId = originalSelected;
            settings = originalSettings;
            promptInput.innerHTML = originalPromptHtml;
            if(!handleTaskLimitSignal(e)) toast(e?.smartCascadeStopped ? '已停止链路运行' : (e.message || tr('smart.errRunFailed')).slice(0, 160));
        } finally {
            smartCascadeRuns.delete(runKey);
            syncSmartCascadeLegacyState();
            smartCascadeSilentSelection = false;
            runBtn.disabled = smartCascadeAnyRunning();
            cascadeRunBtn.disabled = false;
            scheduleSave();
            render();
        }
        return;
    }
    const precreateSingleSlots = singleNodeLoopRun && loopMode === 'parallel' && totalRounds > 1 && parallelLimit > 1;
    let singleLoopSlots = [];
    if(singleNodeLoopRun){
        runState.runPath = {states:{}};
        smartCascadeRunPath = runState.runPath;
    }
    if(singleNodeLoopRun){
        singleLoopSlots = Array.from({length:totalRounds}, (_, round) => {
            const loopIndex = startIndex + round * batchSize;
            const slot = loopOutputSlotForRound(tail, loop.node, loopIndex, round);
            return slot ? tagLoopOutputSlot(slot, tail, loop.node, loopIndex, round) : null;
        });
        singleLoopSlots.filter(Boolean).forEach(slot => { runState.runPath.states[`${tail.id}->${slot.id}`] = 'wait'; });
        if(precreateSingleSlots){
            for(let slotOffset = 0; slotOffset < totalRounds; slotOffset++){
                if(singleLoopSlots[slotOffset]) continue;
                const loopIndex = startIndex + slotOffset * batchSize;
                singleLoopSlots[slotOffset] = createLoopOutputSlot(tail, loopIndex, slotOffset, {queued:true, loopNode:loop.node, slotIndex:slotOffset, runState});
            }
        }
        render();
    }
    if(!singleNodeLoopRun){
        const runStates = {};
        if(loop?.node?.id && graph.root?.id) runStates[`${loop.node.id}->${graph.root.id}`] = 'wait';
        graph.edges.forEach(edge => { runStates[edge.key] = 'wait'; });
        runState.runPath = {states:runStates};
        smartCascadeRunPath = runState.runPath;
        refreshConnectionLayer();
        updateComposer();
    }
    try {
        const runRound = async (loopIndex=startIndex, options={}) => {
            throwIfSmartCascadeStopRequested(runState);
            const ctx = loop ? {index:loopIndex, total:endIndex, nodeId:loop.node.id, forceWorkflow:chain.length > 1 && !singleNodeLoopRun, runState} : {runState};
            if(parallelLimit === 1) smartLoopContext = ctx;
            if(singleNodeLoopRun){
                const refs = refsForDirectLoopRound(loop.node, loopIndex, endIndex);
                if(directLoopTargetRun && parallelLimit === 1) showDirectLoopRoundPreview(loop.node, tail, refs, loopIndex, endIndex);
                const slotIndex = Math.max(0, Math.floor((loopIndex - startIndex) / batchSize));
                const outputTarget = tagLoopOutputSlot(
                    options.outputTarget || singleLoopSlots[slotIndex] || loopOutputSlotForRound(tail, loop.node, loopIndex, slotIndex) || createLoopOutputSlot(tail, loopIndex, slotIndex, {loopNode:loop.node, slotIndex, runState}),
                    tail,
                    loop.node,
                    loopIndex,
                    slotIndex
                );
                singleLoopSlots[slotIndex] = outputTarget;
                await runLoopRoundIntoSlot(loop.node, tail, outputTarget, loopIndex, ctx);
                return;
            }
            const producedRefs = new Map();
            const runBranch = async (source, incomingRefs=[]) => {
                throwIfSmartCascadeStopRequested(runState);
                let targets = graph.children.get(source.id) || [];
                const loopPrompts = isSmartImageNode(source) ? upstreamLoopPromptNodesFor(source) : [];
                const sourceLoopPrompts = isSmartImageNode(source) ? relayLoopPromptNodesForTarget(source) : [];
                if(runState.runPath && sourceLoopPrompts.length && source?.id){
                    sourceLoopPrompts.forEach(loopNode => {
                        runState.runPath.states[`${loopNode.id}->${source.id}`] = 'done';
                    });
                    refreshConnectionLayer();
                }
                if(loopPrompts.length && targets.length > 1){
                    const firstLoop = loopPrompts[0];
                    const startBase = Math.max(1, Number(firstLoop.loopStart) || 1);
                    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
                    const selectedTarget = targets[(currentIndex - 1) % targets.length];
                    if(runState.runPath && firstLoop?.id && source?.id){
                        runState.runPath.states[`${firstLoop.id}->${source.id}`] = 'done';
                        refreshConnectionLayer();
                    }
                    targets = [selectedTarget].filter(Boolean);
                }
                let sharedRefs = incomingRefs;
                for(let index = 0; index < targets.length; index++){
                    throwIfSmartCascadeStopRequested(runState);
                    const target = targets[index];
                    const edgeKey = `${source.id}->${target.id}`;
                    let outputs = [];
                    const relayLoops = isSmartImageNode(source) && isSmartImageNode(target)
                        ? relayLoopPromptNodesForEdge(source, target)
                        : [];
                    const stepCtx = relayLoops.length && isSmartImageNode(target)
                        ? {...(ctx || {}), relayPromptNodeIds:[...new Set([...(ctx?.relayPromptNodeIds || []), ...relayLoops.map(n => n.id)])]}
                        : ctx;
                    try {
                        if(runState.runPath && relayLoops.length && source?.id && isSmartImageNode(target)){
                            relayLoops.forEach(loopNode => {
                                runState.runPath.states[`${loopNode.id}->${source.id}`] = 'done';
                            });
                            refreshConnectionLayer();
                        }
                        if(runState.runPath){
                            runState.runPath.states[edgeKey] = 'active';
                            refreshConnectionLayer();
                        }
                        if(target.type === 'smart-loop'){
                            outputs = outputImagesForNode(source, true, ctx).filter(img => img?.url);
                            sharedRefs = cascadeRefsFromOutputs(outputs, source);
                        } else if(index === 0){
                            outputs = await runCascadeStepIntoNode(source, target, incomingRefs, stepCtx);
                            sharedRefs = cascadeRefsFromOutputs(outputs, target);
                        } else {
                            outputs = appendCascadeRefsToReceiver(target, sharedRefs, stepCtx);
                        }
                    } catch(err) {
                        if(isSmartAssetImageNode(target) && /缺少提示词|需要输入文本|need prompt/i.test(err.message || '') && incomingRefs.length){
                            outputs = appendCascadeRefsToReceiver(target, incomingRefs, stepCtx);
                            if(index === 0){
                                sharedRefs = cascadeRefsFromOutputs(outputs, target);
                            }
                        } else {
                            throw err;
                        }
                    }
                    if(runState.runPath){
                        runState.runPath.states[edgeKey] = 'done';
                        refreshConnectionLayer();
                    }
                    const refs = target.type === 'smart-loop' ? sharedRefs : (index === 0 ? sharedRefs : cascadeRefsFromOutputs(outputs, target));
                    producedRefs.set(target.id, refs);
                    throwIfSmartCascadeStopRequested(runState);
                    await runBranch(target, refs);
                }
            };
            const rootRefs = defaultReferenceImagesFor(graph.root, true, ctx).filter(img => img?.url);
            producedRefs.set(graph.root.id, rootRefs);
            await runBranch(graph.root, rootRefs);
        };
        const roundIndexes = Array.from({length:totalRounds}, (_, round) => startIndex + round * batchSize);
        if(loopMode === 'parallel' && totalRounds > 1){
            const parallelTargets = singleNodeLoopRun
                ? singleLoopSlots
                : [];
            if(parallelTargets.length) render();
            await runSmartCascadeRoundsWithLimit(roundIndexes, parallelLimit, (loopIndex, roundOffset) => {
                const outputTarget = parallelTargets[roundOffset] || null;
                return runRound(loopIndex, {outputTarget});
            }, runState);
        } else {
            for(const loopIndex of roundIndexes){
                throwIfSmartCascadeStopRequested(runState);
                await runRound(loopIndex);
            }
        }
        throwIfSmartCascadeStopRequested(runState);
        if(parallelLimit === 1) smartLoopContext = null;
        selectedId = '';
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        activeComposerSubject = null;
        lastComposerNodeId = '';
        composer.classList.remove('open');
        settings = originalSettings;
        promptInput.innerHTML = originalPromptHtml;
        scheduleSave();
        toast(totalRounds > 1
            ? trf(loopMode === 'parallel' ? 'smart.loopParallelRoundsDone' : 'smart.loopRunRoundsDone', {n:totalRounds})
            : tr('smart.loopRunDone'));
    } catch(e) {
        if(parallelLimit === 1) smartLoopContext = null;
        selectedId = originalSelected;
        settings = originalSettings;
        promptInput.innerHTML = originalPromptHtml;
        if(!handleTaskLimitSignal(e)) toast(e?.smartCascadeStopped ? '已停止链路运行' : (e.message || tr('smart.errRunFailed')).slice(0, 160));
    } finally {
        smartCascadeRuns.delete(runKey);
        syncSmartCascadeLegacyState();
        smartCascadeSilentSelection = false;
        runBtn.disabled = smartCascadeAnyRunning();
        cascadeRunBtn.disabled = false;
        if(directLoopTargetRun) finishLoopTargetPreviewState(tail);
        scheduleSave();
        render();
    }
}
function runSmartCascadeFromLoop(loopId){
    const loop = nodes.find(n => n.id === loopId && n.type === 'smart-loop');
    if(!loop){ toast('没有找到循环节点'); return; }
    const tail = cascadeTailForLoop(loop.id);
    if(!tail){ toast('请把循环节点连接到下游图片链路'); return; }
    selectedId = tail.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    runSmartCascade(tail);
}
async function runGeneration(){
    const node = selectedNode();
    const request = buildPromptRequest(node, null, true, smartLoopContext);
    const prompt = request.prompt.trim();
    if(!node) return;
    const refs = request.refs;
    const previousSettings = cloneSmartSettings(settings);
    const runSettings = smartSettingsForNode(node);
    settings = {...settings, ...cloneSmartSettings(runSettings || {})};
    if(!prompt && smartPromptInputEnabledForSettings(settings)){
        toast(tr('smart.toastNeedPrompt'));
        settings = previousSettings;
        return;
    }
    const outpaintSize = node?.outpaintSize && Number(node.outpaintSize.width) > 0 && Number(node.outpaintSize.height) > 0
        ? {width:Math.round(Number(node.outpaintSize.width)), height:Math.round(Number(node.outpaintSize.height))}
        : null;
    if(outpaintSize && isApiLikeEngine(settings.engine) && settings.apiKind !== 'video'){
        settings = {
            ...settings,
            resolution:'custom',
            ratio:'',
            customWidth:outpaintSize.width,
            customHeight:outpaintSize.height,
            customSize:`${outpaintSize.width}x${outpaintSize.height}`
        };
    }
    applySourceRatioToSettings('', node, settings);
    const meta = snapshotRunMeta(prompt, node.id, request.displayPrompt, refs);
    const logKind = isApiLikeEngine(settings.engine) && settings.apiKind === 'video' ? 'video' : 'image';
    const runLog = smartRunSnapshot(node, prompt, refs, logKind);
    rememberRecentSmartSettings(settings, node);
    const runLogStart = nowMs();
    const expectedCount = ['runninghub', 'comfy'].includes(settings.engine)
        ? workflowTaskCount(settings)
        : Math.max(1, Math.min(4, Number(settings.count || 1)));
    // 图片 API 任务提交后还会经历服务端排队与轮询。运行态必须持续到该
    // 任务真正结束，不能用短暂的按钮冷却替代，否则用户可以重复提交。
    const apiConcurrentRun = isApiLikeEngine(settings.engine);
    const nodeHasImages = (node.images || []).some(img => img?.url);
    const workflowModeRun = smartImageUsesWorkflowInput(node, smartLoopContext);
    const rerunInPlace = nodeHasImages && !workflowModeRun && isGeneratedResultNode(node);
    const shouldBranchFromImage = nodeHasImages && !workflowModeRun && !rerunInPlace;
    const sourceVisualState = shouldBranchFromImage ? {
        images:(node.images || []).map(img => ({...img})),
        title:node.title,
        w:node.w,
        h:node.h,
        scale:node.scale,
        outputKind:node.outputKind
    } : null;
    pushUndo();
    let extracted = null;
    let branchNode = null;
    const pendingMeta = shouldBranchFromImage ? stripRunInputMeta(meta) : meta;
    undoSuppressed = true;
    if(shouldBranchFromImage) branchNode = createPendingOutputFromSource(node, expectedCount, pendingMeta, {connectSource:false, selectOutput:true, refs, candidatePool:true});
    undoSuppressed = false;
    const pendingNode = branchNode || node;
    if(extracted) pendingNode._runMetaTargetId = extracted.id;
    if(!branchNode){
        if(rerunInPlace){
            const previousImages = (pendingNode.images || []).filter(img => img?.url).map(img => ({...img}));
            pendingNode._rerunPreviousImages = previousImages;
            addGeneratedCandidatesToNode(pendingNode, previousImages, {main:'preserve'});
            pendingNode.images = [];
            candidatePanelNodeId = '';
            candidatePanelIndex = 0;
        }
        pendingNode.pending = Math.max(1, Number(expectedCount) || 1);
        pendingNode.pendingCandidatePool = true;
        pendingNode.runStartedAt = nowMs();
        delete pendingNode.runFinishedAt;
        delete pendingNode.runElapsedMs;
        pendingNode.runTimerHidden = false;
        const pendingBox = pendingBoxSize(pendingNode.pending, {sourceNode:node, refs, candidatePool:pendingNode.pendingCandidatePool});
        pendingNode.w = pendingBox.w;
        pendingNode.h = pendingBox.h;
        attachRunMeta(pendingNode, pendingMeta);
    }
    pendingNode.running = true;
    runBtn.disabled = true;
    render();
    try {
        if(settings.engine === 'comfy'){
            await runComfyGeneration(pendingNode, prompt, refs, pendingNode, pendingMeta);
            if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);
            addSmartGenerationLog({run:runLog, outputs:(pendingNode.images || []).map(img => img.url).filter(Boolean), runMs:nowMs() - runLogStart, tasks:smartLogTasksFromNode(pendingNode)});
            settings = previousSettings;
            return;
        }
        if(isApiLikeEngine(settings.engine) && settings.apiKind === 'video'){
            const videoResult = await runApiVideoGeneration(prompt, refs);
            const outVideos = videoResult.urls || videoResult;
            if(!outVideos.length) throw new Error(tr('smart.errNoOutVideos'));
            finalizePendingNode(pendingNode, outVideos, pendingMeta, 'video');
            if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);
            addSmartGenerationLog({run:runLog, outputs:outVideos, runMs:nowMs() - runLogStart, taskId:videoResult.taskId || '', upstreamTaskId:videoResult.upstreamTaskId || ''});
            clearPromptInput({preserveDraft:true});
            settings = previousSettings;
            scheduleSave();
            return;
        }
        if(settings.engine === 'runninghub'){
            const taskResults = await Promise.all(Array.from({length:workflowTaskCount(settings)}, () => submitRunningHubGeneration(prompt, refs)));
            const taskIds = taskResults.map(task => task.taskId).filter(Boolean);
            if(!taskIds.length) throw new Error(tr('smart.rhNoTaskId'));
            pendingNode.pendingTasks = taskResults.filter(task => task.taskId).map(task => ({taskId:task.taskId, kind:'image', providerId:'runninghub', connectionId:task.connectionId, resourceId:task.resourceId, mode:task.mode}));
            pendingNode.pending = Math.max(taskIds.length, Number(pendingNode.pending || 0) || taskIds.length);
            pendingNode.pendingCandidatePool = true;
            pendingNode.runStartedAt = nowMs();
            pendingNode.runTimerHidden = false;
            pendingNode.running = false;
            render();
            await saveCanvas();
            await resumeSmartPendingNode(pendingNode);
            if(!(pendingNode.images || []).length) throw new Error(tr('smart.errNoOutImages'));
            if(outpaintSize) delete node.outpaintSize;
            if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);
            addSmartGenerationLog({run:runLog, outputs:(pendingNode.images || []).map(img => img.url).filter(Boolean), runMs:nowMs() - runLogStart, tasks:smartLogTasksFromNode(pendingNode)});
            clearPromptInput({preserveDraft:true});
            settings = previousSettings;
            scheduleSave();
            return;
        }
        const outImages = await runApiGeneration(prompt, refs);
        if(isApiLikeEngine(settings.engine)){
            const taskIds = Array.isArray(outImages?.taskIds) ? outImages.taskIds : [];
            if(!taskIds.length) throw new Error(tr('smart.errRunFailed'));
            pendingNode.pendingTasks = taskIds.map(taskId => ({taskId, kind:'image', connectionId:outImages.connectionId, modelId:outImages.modelId, resourceId:outImages.resourceId}));
            pendingNode.pending = Math.max(taskIds.length, Number(pendingNode.pending || 0) || taskIds.length);
            pendingNode.pendingCandidatePool = true;
            pendingNode.runStartedAt = nowMs();
            pendingNode.runTimerHidden = false;
            pendingNode.running = false;
            render();
            await saveCanvas();
            await resumeSmartPendingNode(pendingNode);
            if(!(pendingNode.images || []).length) throw new Error(tr('smart.errNoOutImages'));
            if(outpaintSize) delete node.outpaintSize;
            if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);
            addSmartGenerationLog({run:runLog, outputs:(pendingNode.images || []).map(img => img.url).filter(Boolean), runMs:nowMs() - runLogStart, tasks:smartLogTasksFromNode(pendingNode)});
            clearPromptInput({preserveDraft:true});
            settings = previousSettings;
            scheduleSave();
            return;
        }
        if(!outImages.length) throw new Error(tr('smart.errNoOutImages'));
        if(outpaintSize) delete node.outpaintSize;
        finalizePendingNode(pendingNode, outImages, pendingMeta);
        if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);
        addSmartGenerationLog({run:runLog, outputs:outImages, runMs:nowMs() - runLogStart});
        clearPromptInput({preserveDraft:true});
        settings = previousSettings;
        scheduleSave();
    } catch(e) {
        settings = previousSettings;
        pendingNode.pending = 0;
        delete pendingNode.pendingCandidatePool;
        if(branchNode){
            nodes = nodes.filter(n => n.id !== branchNode.id);
            canvas.connections = (canvas.connections || []).filter(c => c.from !== branchNode.id && c.to !== branchNode.id);
            selectedId = node.id;
        } else {
            pendingNode.pending = 0;
            pendingNode.running = false;
            delete pendingNode.pendingCandidatePool;
            if(rerunInPlace && pendingNode._rerunPreviousImages?.length && !(pendingNode.images || []).length){
                addGeneratedCandidatesToNode(pendingNode, pendingNode._rerunPreviousImages, {main:'preserve'});
                setNodeMainCandidate(pendingNode, Number(pendingNode.candidateIndex) || 0);
            }
            if(rerunInPlace && !(pendingNode.images || []).length && candidateCountForNode(pendingNode)){
                setNodeMainCandidate(pendingNode, Number(pendingNode.candidateIndex) || 0);
            }
            if(!(pendingNode.images || []).length){
                delete pendingNode.w;
                delete pendingNode.h;
            }
        }
        if(extracted) restoreFromExtraction(node, extracted);
        delete pendingNode._runMetaTargetId;
        delete pendingNode._rerunPreviousImages;
        addSmartGenerationLog({run:runLog, outputs:[], runMs:nowMs() - runLogStart, error:e.message || String(e), tasks:smartLogTasksFromNode(pendingNode)});
        if(!handleTaskLimitSignal(e)) toast((e.message || tr('smart.errRunFailed')).slice(0, 160));
    } finally {
        if(!apiConcurrentRun){
            clearNodeRunningState(pendingNode);
            syncPrimaryRunButton(activeSettingsSubject());
        }
        // A user may open another node while this run is in flight. Do not let
        // the completed node's restored settings overwrite that node's panel.
        const activeSubject = activeSettingsSubject();
        if(activeSubject && activeSubject.id !== node.id) settings = smartSettingsForNode(activeSubject);
        render();
    }
}
