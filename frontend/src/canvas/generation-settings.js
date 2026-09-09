// 从 frontend/src/canvas/main.js 剪切出的生成参数设置面板逻辑（M10 拆分批次）。
// 剪切时未改动任何函数签名/内部逻辑，只做了纯粹的位置搬移。
//
// 为什么这里不用 ES module 的 export/import（跟 M1-M9 同一个原因）：
// canvas.js 依赖经典 <script> 的全局作用域语义，
// static/canvas.html 里 57 处内联 onclick="xxx()" 都依赖这一点。
// 所以这里同样只做"物理文件拆分"：generation-settings.js 保持经典脚本
// 语法，通过 <script src="generation-settings.js"> 排在 asset-library.js
// 之后、main.js 之前加载。
//
// 本文件是物理上连续的一整块（1753-3365 行区间，约1600行），覆盖底部
// composer 里"生成参数设置"面板的全部逻辑——不同引擎（api/volcengine/
// comfy/runninghub）的可选模型/尺寸/比例/数量等参数如何渲染
// 成 UI、如何响应用户操作写回 settings：
//   1. 引擎/模型可用性判断：syncEngineOptionsVisibility /
//      smartModelAllowed /
//      providerHasAllowedImageModel / providerHasAllowedVideoModel /
//      sortProvidersByPermission / imageConnections / volcengineConnection /
//      runningHubConnection / runningHubEntries 等
//   2. RunningHub 工作流字段解析与渲染：rhFieldKind / rhFieldRole /
//      rhExtractFieldOptions / rhDefaultValue / rhParamValue /
//      renderRhSettingField / renderRhConfigControl 等
//   4. 通用参数控件渲染：renderProviderControl / renderModelControl /
//      renderSizeControls / renderRatioControl / renderResolutionControl /
//      renderQualityControl / renderCountVisualControl 等
//   5. 各引擎专属参数面板：renderApiParams / renderApiVideoParams /
//      renderVolcengineParams / renderVolcengineVideoParams /
//      renderMsParams / renderRunningHubParams / renderComfyParams /
//      renderVideoGenerationConfig / renderVideoModelSelector 等
//   6. 参数面板总入口与事件绑定：renderDynamicParams（按当前 engine/
//      apiKind 分发到对应渲染函数）/ bindDynamicParams（给面板里所有
//      交互控件绑定 onclick/oninput，回写 settings 并触发重新渲染）/
//      setDynamicSetting / smartParamRoots / closeAllSmartPopovers
//   7. 全局配置加载：loadConfig（拉取 /api/config、/api/workflows）/
//      refreshSmartConfigFromSettings
//
// 这批函数高度自洽：都读写同一个 settings 全局对象，互相调用频繁，
// 但只通过 renderDynamicParams/updateProviderModels 等少数几个入口
// 被外部调用（节点选中变化、引擎下拉切换、应用启动序列等），且外部
// 调用方式都是简单的函数调用（不涉及本文件状态与调用方状态直接互相
// 读写），跟 M7 发现的 window.onmousemove/onmouseup 那种深度状态耦合
// 不是同一类问题——那是"函数体本身写在事件处理器闭包里、涉及十几个
// 互斥状态分支"，这里是"事件处理器只是简单调用了一个本文件里的具名
// 函数"，跟 M9 的 renderAssetLibrary()、M7 的 render() 被外部事件
// 处理器调用是同一种安全模式。
//
// 明确排除、留在 main.js 的内容：
//   - toggleZoomPreview 及其前后的缩放预览函数（物理上紧邻本文件开头，
//     但是画布缩放预览功能，跟生成参数设置无关）。
//   - loadPromptPresets 及其后的提示词模板/预设系统（物理上紧邻本文件
//     结尾，属于已确认暂缓拆分的 prompt-node/composer 范围）。

function syncEngineOptionsVisibility(){
    if(!engineSelect) return;
    const has = id => (aiConnections || []).some(p => p.id === id && p.enabled !== false);
    const runningHubOption = engineSelect.querySelector('option[value="runninghub"]');
    if(runningHubOption) runningHubOption.hidden = !runningHubConnection();
    // api 引擎：至少有一个非特殊 provider 启用且有 image_models
    const apiHidden = !imageConnections().length;
    const apiOption = engineSelect.querySelector('option[value="api"]');
    if(apiOption) apiOption.hidden = apiHidden;
    // 当前选中引擎被隐藏时，回退到第一个可见引擎
    if(engineSelect.selectedOptions[0]?.hidden){
        const visible = engineSelect.querySelector('option:not([hidden])');
        if(visible) { settings.engine = visible.value; engineSelect.value = visible.value; }
    }
}
// 访问控制：window.__canvasAllowedModels 为 Set<"provider_id::model"> 时按白名单过滤；
// null/未设置（未登录探测失败、admin、或用户未被限制）时视为全部放开。
function smartModelAllowed(providerId, model, modelId=''){
    const allowed = window.__canvasAllowedModels;
    if(!allowed) return true;
    if(modelId && allowed.has(`model:${modelId}`)) return true;
    return allowed.has(`${providerId}::${model}`);
}
function providerHasAllowedImageModel(provider){
    const models = provider?.image_models || [];
    if(!models.length) return true;
    return models.some(model => smartModelAllowed(provider?.id || '', model));
}
function providerHasAllowedVideoModel(provider){
    const models = provider?.video_models || [];
    if(!models.length) return true;
    return models.some(model => smartModelAllowed(provider?.id || '', model));
}
function sortProvidersByPermission(providers, kind='image'){
    const list = [...(providers || [])];
    const hasAccess = kind === 'video' ? providerHasAllowedVideoModel : providerHasAllowedImageModel;
    return list.sort((a, b) => {
        const aAllowed = hasAccess(a) ? 0 : 1;
        const bAllowed = hasAccess(b) ? 0 : 1;
        if(aAllowed !== bAllowed) return aAllowed - bAllowed;
        return String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {numeric:true, sensitivity:'base'});
    });
}
function imageConnections(){
    return sortProvidersByPermission((aiConnections || []).filter(p => p.enabled !== false && p.id !== 'runninghub' && connectionImageModels(p.id).length), 'image');
}
function volcengineConnection(){
    return (aiConnections || []).find(p => p.id === 'volcengine' && p.enabled !== false) || {
        id:'volcengine',
        name:'火山引擎',
        image_models:[],
        video_models:[],
        enabled:true
    };
}
function runningHubConnection(){
    return (aiConnections || []).find(p => p.enabled !== false && (p.id === 'runninghub' || p.protocol === 'runninghub')) || null;
}
function runningHubEntries(kind){
    const provider = runningHubConnection();
    const providerApps = Array.isArray(provider?.rh_apps) ? provider.rh_apps : [];
    // The settings API stores executable apps in `resources`; use that
    // authoritative list as a fallback when the connection uses a custom ID.
    const resourceApps = (Array.isArray(aiResourceIndex?.resources) ? aiResourceIndex.resources : [])
        .filter(item => item?.kind === 'runninghub_app')
        .map(item => {
            const id = item.settings?.app_id || item.settings?.id || item.settings?.appId || item.settings?.webappId || item.id;
            return {...(item.settings || {}), id, appId:id, webappId:id, title:item.title || item.settings?.title, name:item.name, enabled:item.enabled !== false};
        });
    const resourceAppsById = new Map(resourceApps.map(entry => [runningHubEntryId(entry, 'app'), entry]));
    // Legacy connection records keep a complete `rh_apps` list but do not
    // carry the media type. Enrich them from resources, which are the
    // authoritative store for the workflow's image/video classification.
    const apps = providerApps.length ? providerApps.map(entry => {
        const resourceEntry = resourceAppsById.get(runningHubEntryId(entry, 'app'));
        const media = entry?.media === 'image' || entry?.media === 'video' ? entry.media : resourceEntry?.media;
        const cover = entry?.cover && typeof entry.cover === 'object' ? entry.cover : resourceEntry?.cover;
        return {...entry, ...(media ? {media} : {}), ...(cover ? {cover} : {})};
    }) : resourceApps;
    return apps.filter(item => item?.enabled !== false && item?.hidden !== true);
}
function runningHubEntryId(entry, kind){
    return String(entry?.app_id || entry?.id || entry?.appId || entry?.webappId || '').trim();
}
function runningHubEntryLabel(entry, kind){
    const id = runningHubEntryId(entry, kind);
    return entry?.title || entry?.name || `AI App ${id}`;
}
function runningHubEntryKey(kind, id){
    return `${kind}:${String(id || '').trim()}`;
}
function parseRunningHubEntryKey(value){
    const text = String(value || '').trim();
    const match = text.match(/^app:(.+)$/);
    return match ? {kind:'app', id:match[1].trim()} : null;
}
function runningHubAllEntries(){
    return runningHubEntries('app').map(entry => ({kind:'app', id:runningHubEntryId(entry, 'app'), entry})).filter(x => x.id);
}
function workflowMediaType(workflow){
    if(workflow?.media === 'image' || workflow?.media === 'video') return workflow.media;
    // Legacy RunningHub apps do not persist `media`. Their parameter fields
    // and tags still identify video workflows, so infer before falling back
    // to the historical image default.
    const fields = [...(workflow?.fields || []), ...(workflow?.raw?.nodeInfoList || [])];
    if(fields.some(field => String(field?.fieldType || field?.type || '').toUpperCase() === 'VIDEO')) return 'video';
    const tags = Array.isArray(workflow?.raw?.tags) ? workflow.raw.tags : [];
    const labels = [workflow?.title, workflow?.name, workflow?.raw?.webappName, ...tags.flatMap(tag => [tag?.name, tag?.nameEn])];
    return labels.some(label => /video|视频/i.test(String(label || ''))) ? 'video' : 'image';
}
function workflowMediaForNode(node){
    return node?.genKind === 'image' || node?.genKind === 'video' ? node.genKind : '';
}
function workflowMatchesNode(workflow, node){
    const media = workflowMediaForNode(node);
    return !media || workflowMediaType(workflow) === media;
}
function comfyWorkflowsForNode(node=activeSettingsSubject()){
    return (Array.isArray(comfyWorkflows) ? comfyWorkflows : []).filter(workflow => workflowMatchesNode(workflow, node));
}
function runningHubWorkflowEntriesForNode(node=activeSettingsSubject()){
    return runningHubAllEntries().filter(ref => workflowMatchesNode(ref.entry, node));
}
function normalizeWorkflowSourceForNode(node=activeSettingsSubject()){
    const media = workflowMediaForNode(node);
    if(!media) return;
    const comfy = comfyWorkflowsForNode(node);
    const runningHub = runningHubWorkflowEntriesForNode(node);
    if(settings.engine === 'comfy'){
        if(!comfy.some(workflow => workflow.name === settings.comfyWorkflow)) settings.comfyWorkflow = comfy[0]?.name || '';
        if(!comfy.length && runningHub.length) settings.engine = 'runninghub';
    } else if(settings.engine === 'runninghub'){
        const selected = parseRunningHubEntryKey(settings.rhConfigKey || '');
        const hasSelected = selected && runningHub.some(ref => ref.kind === selected.kind && ref.id === selected.id);
        if(!hasSelected) settings.rhConfigKey = runningHub[0] ? runningHubEntryKey(runningHub[0].kind, runningHub[0].id) : '';
        if(!runningHub.length && comfy.length) settings.engine = 'comfy';
    }
}
function selectedRunningHubRef(sourceSettings=settings){
    const all = runningHubAllEntries();
    sourceSettings = sourceSettings || settings;
    const parsed = parseRunningHubEntryKey(sourceSettings.rhConfigKey || '');
    let ref = parsed ? all.find(item => item.kind === parsed.kind && item.id === parsed.id) : null;
    if(!ref && all.length) ref = all[0];
    if(ref && sourceSettings === settings) settings.rhConfigKey = runningHubEntryKey(ref.kind, ref.id);
    return ref || null;
}
function runningHubTarget(ref=selectedRunningHubRef(), sourceSettings=settings){
    const resources = Array.isArray(aiResourceIndex?.resources) ? aiResourceIndex.resources : [];
    const appId = String(ref?.id || '').trim();
    const resourceId = String(sourceSettings?.resource_id || '').trim();
    const isMatchingApp = item => {
        if(item?.kind !== 'runninghub_app' || item?.enabled === false) return false;
        const resourceSettings = item.settings && typeof item.settings === 'object' ? item.settings : {};
        return item.id === appId || item.name === appId
            || resourceSettings.app_id === appId || resourceSettings.id === appId || resourceSettings.appId === appId || resourceSettings.webappId === appId;
    };
    // Resolve from the selected app first. A prior API model can leave its
    // connection_id on the settings object, which must never steer RH runs.
    const resource = resources.find(isMatchingApp)
        || resources.find(item => item?.kind === 'runninghub_app' && item?.enabled !== false && item.id === resourceId)
        || null;
    const connectionId = resource?.connection_id || runningHubConnection()?.id || '';
    return stableCanvasTarget('runninghub_app', connectionId, '', resource?.id || appId);
}
function rhEntryFields(entry){
    return Array.isArray(entry?.fields) ? entry.fields : [];
}
function rhActiveFields(sourceSettings=settings){
    const ref = selectedRunningHubRef(sourceSettings);
    let fields = rhEntryFields(ref?.entry);
    fields = fields.filter(f => f.enabled === true);
    return sortRunningHubFields(fields);
}
function sortRunningHubFields(fields){
    return [...(fields || [])].sort((a, b) => {
        const ak = rhFieldKind(a), bk = rhFieldKind(b);
        if(ak === 'image' && bk === 'image'){
            const ao = Number(a.imageOrder) || 9999;
            const bo = Number(b.imageOrder) || 9999;
            if(ao !== bo) return ao - bo;
        }
        if(ak === 'image' && bk !== 'image') return -1;
        if(ak !== 'image' && bk === 'image') return 1;
        return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, {numeric:true}) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
    });
}
function chatApiProviders(){
    return (aiConnections || []).filter(p => p.enabled !== false && (p.chat_models || []).length);
}
function resolveChatProviderId(providerId=''){
    const providers = chatApiProviders();
    if(providers.some(p => p.id === providerId)) return providerId;
    return providers[0]?.id || 'comfly';
}
function providerChatModels(providerId){
    const provider = chatApiProviders().find(p => p.id === providerId);
    return [...new Set((provider?.chat_models || []).filter(model => provider?.model_enabled?.[String(model || '').trim()] !== false))];
}
function resolveChatModel(model='', providerId=''){
    const models = providerChatModels(resolveChatProviderId(providerId));
    return models.includes(model) ? model : (models[0] || model || 'gpt-4o-mini');
}
function modelDisplayName(model, providerId){
    const p = providerId ? (aiConnections || []).find(pp => pp.id === providerId) : null;
    if(p?.model_aliases?.[model]) return p.model_aliases[model];
    return model;
}
function connectionById(providerId){
    if(providerId === 'volcengine') return volcengineConnection();
    return (aiConnections || []).find(p => p.id === providerId) || imageConnections()[0] || null;
}
function connectionImageModels(providerId){
    if(providerId === 'volcengine') return volcengineConnection().image_models || [];
    if(providerId === 'runninghub') return [];
    const provider = (aiConnections || []).find(p => p.id === providerId);
    return (provider?.image_models || []).filter(model => provider?.model_enabled?.[String(model || '').trim()] !== false);
}
let _rhLastAttachedKindsKey = null;
// 接入素材的类型（图片/视频/音频）变化时，重新渲染 RunningHub AI 应用选择列表，
// 以便按新的素材类型过滤掉不支持的条目。
function syncRhConfigForRefs(){
    if(settings.engine !== 'runninghub') { _rhLastAttachedKindsKey = null; return; }
    const key = Array.from(rhAttachedRefKinds()).sort().join(',');
    if(key === _rhLastAttachedKindsKey) return;
    _rhLastAttachedKindsKey = key;
    renderDynamicParams();
}
function sanitizeSmartApiSelection(target=settings){
    if(!target || typeof target !== 'object') return target;
    const modelResources = Array.isArray(aiResourceIndex?.models) ? aiResourceIndex.models : [];
    // Stable IDs are authoritative. Do not derive and persist legacy provider
    // or model fields from them; historical nodes may still be read below.
    const hasStableImageTarget = Boolean(target.connection_id || target.model_id || target.resource_id);
    const hasStableVideoTarget = Boolean(target.videoConnectionId || target.videoModelId || target.videoResourceId);
    if(target.engine === 'volcengine'){
        if(target.apiKind === 'video'){
            target.videoConnectionId = target.videoConnectionId || 'volcengine';
            const models = volcengineVideoModels();
            const selected = modelResources.find(item => item.enabled !== false && item.kind === 'video' && item.connection_id === target.videoConnectionId && models.includes(item.upstream_model));
            if(!target.videoModelId && selected) target.videoModelId = selected.id;
        } else {
            target.connection_id = target.connection_id || 'volcengine';
            const models = connectionImageModels('volcengine');
            const selected = modelResources.find(item => item.enabled !== false && item.kind === 'image' && item.connection_id === target.connection_id && models.includes(item.upstream_model));
            if(!target.model_id && selected) target.model_id = selected.id;
        }
        target.engine = 'api';
    }
    // Legacy selections are intentionally left untouched only when no stable
    // target exists, so old saved nodes remain readable during migration.
    if(!hasStableImageTarget && target.provider_id){
        const models = connectionImageModels(target.provider_id);
        if(models.length && !models.includes(target.model)) target.model = models[0] || '';
    }
    if(!hasStableVideoTarget && target.videoProvider){
        const models = connectionVideoModels(target.videoProvider);
        if(models.length && !models.includes(target.videoModel)) target.videoModel = models[0] || '';
    }
    return target;
}
function videoConnections(){
    const fromConfig = sortProvidersByPermission((aiConnections || []).filter(p => p.enabled !== false && p.id !== 'runninghub' && connectionVideoModels(p.id).length), 'video');
    return fromConfig;
}
function videoProviderById(providerId){
    if(providerId === 'volcengine') return volcengineConnection();
    return videoConnections().find(p => p.id === providerId) || videoConnections()[0] || null;
}
function connectionVideoModels(providerId){
    if(providerId === 'volcengine') return volcengineVideoModels();
    // Read the already-loaded provider list directly. Calling videoConnections
    // here would recurse because videoConnections filters through this helper.
    const provider = (aiConnections || []).find(p => p.id === providerId);
    return [...new Set((provider?.video_models || []).filter(model => provider?.model_enabled?.[String(model || '').trim()] !== false))];
}
// Normalize the mutually-exclusive video input modes used by the API payload
// and by the compact generation settings popover.
function videoGenerationMode(source=settings){
    const value = source || settings || {};
    if(value.videoUseFrameRoles) return 'frames';
    if(value.videoMultimodal) return 'multimodal';
    return 'text';
}

function ratioLabel(prefix=''){
    const source = prefix ? `${prefix}Ratio` : 'ratio';
    const value = String(settings?.[source] || (prefix ? '1:1' : '1:1'));
    if(value === 'custom') return String(settings?.customRatio || settings?.[`${prefix}CustomRatio`] || 'custom');
    return value;
}
function volcengineVideoModels(){
    const provider = (aiConnections || []).find(p => p.id === 'volcengine');
    return [...new Set(provider?.video_models || [])];
}
function renderVideoModelSelector(providers, models, restricted){
    const currentProvider = (providers || []).find(p => p.id === settings.videoProvider) || videoProviderById(settings.videoProvider);
    const modelLabel = settings.videoModel ? modelDisplayName(settings.videoModel, settings.videoProvider) : tr('smart.model');
    const entries = (models || []).map(model => ({
        model,
        locked: restricted && !smartModelAllowed(settings.videoProvider, model, settings.videoModelId)
    }));
    return `<div class="smart-control video-model-control">
        <button class="smart-pill video-model-summary" type="button" title="${escapeAttr(`${currentProvider?.name || settings.videoProvider || ''} · ${modelLabel}`)}">
            <i data-lucide="film"></i><span class="sub">${escapeHtml(modelLabel)}</span><i data-lucide="chevron-up" class="pill-caret"></i>
        </button>
        <div class="smart-popover video-model-popover">
            <div class="video-config-head">
                <div><strong>${escapeHtml(tr('smart.videoModelSelect'))}</strong></div>
            </div>
            <section class="video-config-section">
                <div class="video-config-label">${escapeHtml(tr('smart.videoModel'))}</div>
                <div class="video-config-model-grid">
                    ${entries.map(entry => {
                        const active = entry.model === settings.videoModel;
                        return `<button type="button" class="video-config-option ${active ? 'active' : ''} ${entry.locked ? 'is-locked' : ''}" data-smart-param="videoModel" data-smart-value="${escapeAttr(entry.model)}" ${entry.locked ? `title="${escapeAttr(tr('smart.modelLocked'))}"` : ''}><span>${escapeHtml(modelDisplayName(entry.model, settings.videoProvider))}</span>${entry.locked ? '<i data-lucide="lock"></i>' : ''}</button>`;
                    }).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noVideoModel'))}</div>`}
                </div>
            </section>
        </div>
    </div>`;
}
function renderVideoGenerationConfig(){
    const durationField = canvasSchemaField('video', 'videoDuration');
    const durationName = canvasSchemaFieldName('video', 'videoDuration', tr('smart.videoDuration'));
    const quick = Array.isArray(durationField.options) && durationField.options.length ? durationField.options.map(Number).filter(Number.isFinite) : [5, 10, 15];
    const durationValue = Number(settings.videoDuration);
    const v = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 5;
    settings.videoDuration = v;
    const aspectField = canvasSchemaField('video', 'videoAspect');
    const aspectName = canvasSchemaFieldName('video', 'videoAspect', tr('smart.videoAspect'));
    const aspectOptions = (Array.isArray(aspectField.options) && aspectField.options.length ? aspectField.options : ['16:9','4:3','1:1','3:4','9:16','21:9']).map(value => [value, canvasSchemaOptionLabel(aspectField, value)]);
    const aspect = settings.videoAspect || '16:9';
    const aspectLabels = Object.fromEntries(aspectOptions);
    const resolutionField = canvasSchemaField('video', 'videoResolution');
    const resolutionName = canvasSchemaFieldName('video', 'videoResolution', tr('smart.videoResolution'));
    const resolutionOptions = (Array.isArray(resolutionField.options) && resolutionField.options.length ? resolutionField.options : ['480p','720p','1080p']).map(value => [value, canvasSchemaOptionLabel(resolutionField, value)]);
    const resolution = settings.videoResolution || '480p';
    settings.videoResolution = resolution;
    const resolutionLabels = Object.fromEntries(resolutionOptions);
    const durationLabel = canvasSchemaOptionLabel(durationField, v, String(v));
    const generationMode = videoGenerationMode();
    const generationModeOptions = [
        ['text', tr('smart.videoTextToVideo')],
        ['multimodal', canvasSchemaFieldName('video', 'videoMultimodal', tr('smart.videoMultimodal'))],
        ['frames', canvasSchemaFieldName('video', 'videoUseFrameRoles', tr('smart.videoUseFrameRoles'))]
    ];
    const generationModeLabel = Object.fromEntries(generationModeOptions)[generationMode];
    const summary = `${generationModeLabel}·${aspectLabels[aspect] || aspect}·${resolutionLabels[resolution] || resolution}·${durationLabel}`;
    return `<div class="smart-control video-generation-control">
        <button class="smart-pill video-generation-summary" type="button" title="${escapeAttr(summary)}">
            <i data-lucide="sliders-horizontal"></i>
            <span class="video-config-summary">${escapeHtml(summary)}</span>
            <i data-lucide="chevron-up" class="pill-caret"></i>
        </button>
        <div class="smart-popover video-config-popover">
            <section class="video-config-section">
                <div class="video-config-label">${escapeHtml(tr('smart.videoGenerationMode'))}</div>
                <div class="video-config-mode-single">
                    ${generationModeOptions.map(([value,label]) => `<button type="button" class="video-config-option ${value === generationMode ? 'active' : ''}" data-video-mode="${escapeAttr(value)}"><span>${escapeHtml(label)}</span></button>`).join('')}
                </div>
            </section>
            <section class="video-config-section">
                <div class="video-config-label">${escapeHtml(aspectName)}</div>
                <div class="ratio-grid video-config-ratio-grid">
                    ${aspectOptions.map(([value,label]) => `<button type="button" class="ratio-option ${value === aspect ? 'active' : ''}" data-smart-param="videoAspect" data-smart-value="${escapeAttr(value)}"><span class="ratio-icon ${videoAspectIconClass(value)}"></span><span>${escapeHtml(label)}</span></button>`).join('')}
                </div>
            </section>
            <div class="video-config-detail-grid">
                <section class="video-config-section">
                    <div class="video-config-label">${escapeHtml(resolutionName)}</div>
                    <div class="video-config-resolution-grid">
                        ${resolutionOptions.map(([value,label]) => `<button type="button" class="video-config-option ${value === resolution ? 'active' : ''}" data-smart-param="videoResolution" data-smart-value="${escapeAttr(value)}"><span>${escapeHtml(label)}</span></button>`).join('')}
                    </div>
                </section>
                <section class="video-config-section">
                    <div class="video-config-label">${escapeHtml(durationName)}</div>
                    <div class="duration-grid">
                        ${quick.map(n => `<button type="button" class="duration-option ${n === v ? 'active' : ''}" data-smart-param="videoDuration" data-smart-value="${n}">${escapeHtml(canvasSchemaOptionLabel(durationField, n, n))}</button>`).join('')}
                        <input class="duration-custom-input ${quick.includes(v) ? '' : 'active'}" type="number" min="${escapeAttr(durationField.min ?? 1)}" max="${escapeAttr(durationField.max ?? 60)}" step="${escapeAttr(durationField.step ?? 1)}" value="${quick.includes(v) ? '' : escapeAttr(v)}" placeholder="${escapeAttr(tr('smart.custom'))}" aria-label="${escapeAttr(durationName)}" data-param="videoDuration">
                    </div>
                </section>
            </div>
            <section class="video-config-section video-config-flags">
                <div class="video-config-label">${escapeHtml(canvasSchemaFieldName('video', 'videoGenerateAudio', tr('smart.videoGenerateAudio')))}</div>
                <div class="video-config-toggle-row">
                    <div class="video-config-audio-grid">
                        <button type="button" class="video-config-option ${settings.videoGenerateAudio ? 'active' : ''}" data-video-audio="on"><span>${escapeHtml(tr('smart.audioOn'))}</span></button>
                        <button type="button" class="video-config-option ${settings.videoGenerateAudio ? '' : 'active'}" data-video-audio="off"><span>${escapeHtml(tr('smart.audioOff'))}</span></button>
                    </div>
                </div>
            </section>
        </div>
    </div>`;
}
function renderVideoToggleControl(key, label){
    const on = !!settings[key];
    return `<button type="button" class="setting-check ${on ? 'active' : ''}" data-toggle-param="${escapeHtml(key)}"><span class="check-box"></span><span>${escapeHtml(label)}</span></button>`;
}
function optionHtml(value, label, selected){
    return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${escapeHtml(label ?? value)}</option>`;
}
const canvasParameterSchemaCache = new Map();
const canvasParameterSchemaTarget = {image:'', video:''};
function defaultCanvasParameterSchema(kind){
    if(kind === 'video') return {fields:[
        {id:'videoDuration', default:5, options:[5,10,15], min:1, max:60, step:1},
        {id:'videoAspect', default:'16:9', options:['16:9','4:3','1:1','3:4','9:16','21:9']},
        {id:'videoResolution', default:'480p', options:['480p','720p','1080p']}
    ]};
    return {fields:[
        {id:'resolution', default:'1k', options:['1k','2k','4k','custom']},
        {id:'ratio', default:'1:1', options:['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9','9:21','source','custom']},
        {id:'quality', default:'auto', options:['auto','low','medium','high']},
        {id:'count', default:1, min:1, max:4, step:1}
    ]};
}
function canvasSchemaField(kind, id){
    const schema = canvasParameterSchemaCache.get(`${kind}:active`) || defaultCanvasParameterSchema(kind);
    return (schema.fields || []).find(field => field.id === id) || (defaultCanvasParameterSchema(kind).fields || []).find(field => field.id === id) || {};
}
function canvasSchemaFieldName(kind, id, fallback){
    return String(canvasSchemaField(kind, id).name || fallback || id);
}
function canvasSchemaOptionLabel(field, value, fallback=value){
    const options = Array.isArray(field?.options) ? field.options : [];
    const labels = Array.isArray(field?.option_labels) ? field.option_labels : [];
    const index = options.findIndex(option => String(option) === String(value));
    return index >= 0 && labels[index] !== undefined && labels[index] !== '' ? String(labels[index]) : String(fallback ?? value);
}
function applyCanvasSchemaDefaults(kind, schema){
    for(const field of schema?.fields || []){
        const key = field?.id;
        if(!key || ['provider_id','model','videoProvider','videoModel'].includes(key)) continue;
        const options = Array.isArray(field.options) ? field.options : [];
        const current = settings[key];
        if(current === undefined || current === null || current === '' || (options.length && !options.some(value => String(value) === String(current)))){
            settings[key] = field.default !== undefined ? field.default : (options[0] ?? current);
        }
    }
}
async function refreshCanvasParameterSchema(kind, providerId, model){
    const canonical = kind === 'video'
        ? {connection_id: settings.videoConnectionId || '', model_id: settings.videoModelId || '', resource_id: settings.videoResourceId || ''}
        : {connection_id: settings.connection_id || '', model_id: settings.model_id || '', resource_id: settings.resource_id || ''};
    const target = (canonical.connection_id || canonical.model_id || canonical.resource_id)
        ? canonical
        : stableCanvasTarget(kind, providerId, model);
    if(!target.connection_id && !target.model_id && !target.resource_id) return;
    const key = `${kind}:${target.connection_id}:${target.model_id}:${target.resource_id}`;
    canvasParameterSchemaTarget[kind] = key;
    const activate = schema => {
        // Schema requests are asynchronous while selection changes are not.
        // Only the selected node/model may update the shared rendered schema.
        if(canvasParameterSchemaTarget[kind] !== key) return;
        canvasParameterSchemaCache.set(`${kind}:active`, schema);
        applyCanvasSchemaDefaults(kind, schema);
        renderDynamicParams();
    };
    if(canvasParameterSchemaCache.has(key)){
        activate(canvasParameterSchemaCache.get(key));
        return;
    }
    try {
    const query = new URLSearchParams({capability:kind === 'video' ? 'video.text_to_video' : 'image.text_to_image', connection_id:target.connection_id || '', model_id:target.model_id || '', resource_id:target.resource_id || ''});
    if(!target.connection_id && !target.model_id && !target.resource_id && model) query.set('model', model);
        const response = await fetch(`/api/canvas/capability-parameters?${query.toString()}`, {credentials:'same-origin'});
        if(!response.ok) return;
        const schema = await response.json();
        canvasParameterSchemaCache.set(key, schema);
        activate(schema);
    } catch (_) { /* Keep the backend-compatible default schema on network failure. */ }
}
function parseSizeValue(value){
    const match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    return match ? {width:match[1], height:match[2]} : null;
}
function parseRatioValue(value){
    const raw = String(value || '').trim();
    const parts = raw.includes(':') ? raw.split(':') : raw.split(/[xX*]/);
    if(parts.length !== 2) return 0;
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    return w > 0 && h > 0 ? w / h : 0;
}
function apiImageSize(ratioValue, resolutionValue, customRatioValue='', customSizeValue='', matchedRatioKey=''){
    if(resolutionValue === 'custom') return String(customSizeValue || '').trim();
    const resolutionKey = resolutionValue || '1k';
    if(ratioValue === 'source'){
        // 适配比例：已在 applySourceRatioToSettings 里用原图宽高比匹配好最接近的标准比例档位，
        // 直接取该档位在当前分辨率下的预设尺寸，不再做任何和分辨率相关的比例计算。
        const key = matchedRatioKey && SIZE_MAP[matchedRatioKey] ? matchedRatioKey : '1:1';
        return SIZE_MAP[key]?.[resolutionKey] || SIZE_MAP['1:1'][resolutionKey] || SIZE_MAP['1:1']['1k'];
    }
    if(ratioValue === 'custom'){
        const parsed = parseRatioValue(customRatioValue);
        const longSide = RES_LONG_SIDE[resolutionKey] || 1024;
        if(parsed){
            const pixelLimit = RES_PIXEL_LIMIT[resolutionKey] || (longSide * longSide);
            const rawWidth = parsed >= 1 ? longSide : Math.min(longSide * parsed, Math.sqrt(pixelLimit * parsed));
            const rawHeight = parsed >= 1 ? Math.min(longSide / parsed, Math.sqrt(pixelLimit / parsed)) : longSide;
            const width = Math.floor(rawWidth / 16) * 16;
            const height = Math.floor(rawHeight / 16) * 16;
            return `${Math.max(64, width)}x${Math.max(64, height)}`;
        }
    }
    const ratioKey = ratioValue && SIZE_MAP[ratioValue] ? ratioValue : '1:1';
    return SIZE_MAP[ratioKey]?.[resolutionKey] || SIZE_MAP['1:1'][resolutionKey] || SIZE_MAP['1:1']['1k'];
}
function normalizeApiSizeSettings(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
}
function normalizeComfyWorkflowName(name){
    const value = String(name || '');
    if(!value || !Array.isArray(comfyWorkflows)) return value;
    if(comfyWorkflows.some(item => item?.name === value)) return value;
    const withExtension = `${value}.json`;
    return comfyWorkflows.some(item => item?.name === withExtension) ? withExtension : value;
}
async function ensureComfyWorkflow(name){
    if(!name) return null;
    // Workflow settings are editable from a separate page. Never reuse a
    // response that predates a settings change; loadConfig clears this cache
    // when the workflow list is refreshed.
    if(comfyWorkflowCache[name]) return comfyWorkflowCache[name];
    const data = await fetch(`/api/workflows/${encodeURIComponent(name)}`).then(r => r.ok ? r.json() : null).catch(() => null);
    if(data) comfyWorkflowCache[name] = data;
    return data;
}
function currentComfyFields(sourceSettings=settings){
    const source = sourceSettings || settings;
    return comfyWorkflowCache[source.comfyWorkflow]?.config?.fields || [];
}
function comfyParamValue(field){
    settings.comfyParams = settings.comfyParams || {};
    if(settings.comfyParams[field.id] !== undefined) return settings.comfyParams[field.id];
    return field.default ?? (field.type === 'boolean' ? false : (field.type === 'number' || field.type === 'slider' ? 0 : ''));
}
function updateProviderModels(){ renderDynamicParams(); }
function clearComposerHeadParams(){
    if(composerHeadParams) composerHeadParams.innerHTML = '';
}
function renderDynamicParams(){
    if(!dynamicParams) return;
    clearWorkflowCoverFlyout();
    const node = activeSettingsSubject();
    normalizeWorkflowSourceForNode(node);
    const allowedEngines = allowedEnginesForNode(node);
    const unifiedWorkflowNode = ['image','video','workflow'].includes(node?.genKind);
    if(settings.engine === 'volcengine') settings.engine = 'api';
    settings.engine = ['api','comfy','runninghub'].includes(settings.engine) ? settings.engine : 'api';
    // 定型生成节点：强制引擎落在允许列表内，避免继承到画布默认/最近使用的错误引擎（如图片节点误用工作流配置框）
    if(allowedEngines && !allowedEngines.includes(settings.engine)){
        settings.engine = allowedEngines.includes(defaultEngineForGenKind(node?.genKind)) ? defaultEngineForGenKind(node?.genKind) : allowedEngines[0];
    }
    // 图片生成节点固定 apiKind=image，视频生成节点固定 apiKind=video
    if(node?.genKind === 'image') settings.apiKind = 'image';
    else if(node?.genKind === 'video') settings.apiKind = 'video';
    else settings.apiKind = settings.apiKind === 'video' ? 'video' : 'image';
    // 按节点类型过滤引擎下拉可选项
    Array.from(engineSelect.options).forEach(opt => {
        opt.hidden = unifiedWorkflowNode && opt.value === 'comfy'
            ? true
            : allowedEngines ? !allowedEngines.includes(opt.value) : opt.value === 'comfy';
    });
    // 定型节点把 ComfyUI 与 RH 统一展示为一个“工作流”入口，具体来源在配置框中选择。
    engineSelect.value = unifiedWorkflowNode && ['comfy','runninghub'].includes(settings.engine)
        ? 'runninghub'
        : settings.engine;
    clearComposerHeadParams();
    if(node?.genKind === 'workflow'){
        // 工作流节点在配置框中统一列出 ComfyUI 工作流与 RH 应用，避免再通过引擎下拉切换来源。
        engineSelect.style.display = 'none';
        renderWorkflowNodeParams();
        bindDynamicParams();
        updatePromptPlaceholder();
        syncComposerPromptVisibility();
        renderInputThumbsRow(selectedNode());
        renderInputPromptPreview(selectedNode());
        persistActiveSmartSettings();
        if(window.lucide) lucide.createIcons();
        return;
    }
    // 图片和视频节点保留引擎选择；可选项由各自的 allowedEngines 过滤。
    engineSelect.style.display = '';
    if(settings.engine === 'api'){
        if(node?.genKind === 'video') renderApiVideoParams();
        else if(node?.genKind === 'image') renderApiParams();
        else if(settings.apiKind === 'video') renderApiVideoParams();
        else renderApiParams();
    }
    else if(settings.engine === 'runninghub') renderRunningHubParams();
    else renderComfyParams();
    bindDynamicParams();
    updatePromptPlaceholder();
    syncComposerPromptVisibility();
    renderInputThumbsRow(selectedNode());
    renderInputPromptPreview(selectedNode());
    persistActiveSmartSettings();
    if(reopenVideoControlAfterRender){
        const selector = reopenVideoControlAfterRender === 'model' ? '.video-model-control' : '.video-generation-control';
        dynamicParams.querySelector(selector)?.classList.add('pinned');
        reopenVideoControlAfterRender = '';
    }
    if(window.lucide) lucide.createIcons();
}
function renderApiParams(){
    const entries = apiImageModelEntries();
    const selected = entries.find(entry => entry.connectionId === settings.connection_id && entry.modelId === settings.model_id && !entry.locked)
        || entries.find(entry => entry.providerId === settings.provider_id && entry.model === settings.model && !entry.locked)
        || entries.find(entry => !entry.locked)
        || entries[0];
    settings.provider_id = selected?.providerId || '';
    settings.model = selected?.model || '';
    Object.assign(settings, stableCanvasTarget('image', settings.provider_id, settings.model));
    normalizeApiSizeSettings('');
    const outpaintLocked = settings.outpaintResolutionLocked === true;
    dynamicParams.innerHTML = `
        ${renderApiImageModelControl(entries, true)}
        ${renderResolutionControl('', false)}
        ${outpaintLocked ? '' : renderRatioControl('', true, false)}
        ${renderQualityControl()}
        ${renderCountVisualControl()}
    `;
}
function renderApiVideoParams(){
    const entries = apiVideoModelEntries();
    const selected = entries.find(entry => entry.connectionId === settings.videoConnectionId && entry.modelId === settings.videoModelId && !entry.locked)
        || entries.find(entry => entry.providerId === settings.videoProvider && entry.model === settings.videoModel && !entry.locked)
        || entries.find(entry => !entry.locked)
        || entries[0];
    settings.videoProvider = selected?.providerId || '';
    settings.videoModel = selected?.model || '';
    const videoTarget = stableCanvasTarget('video', settings.videoProvider, settings.videoModel);
    settings.videoConnectionId = videoTarget.connection_id;
    settings.videoModelId = videoTarget.model_id;
    settings.videoResourceId = videoTarget.resource_id;
    dynamicParams.innerHTML = `
        ${renderApiVideoModelControl(entries, true)}
        ${renderVideoGenerationConfig()}
    `;
}
function renderVolcengineParams(){
    const provider = volcengineConnection();
    const providers = [provider];
    const models = connectionImageModels('volcengine');
    settings.provider_id = 'volcengine';
    if(!settings.model || !models.includes(settings.model)) settings.model = models[0] || '';
    normalizeApiSizeSettings('');
    const outpaintLocked = settings.outpaintResolutionLocked === true;
    dynamicParams.innerHTML = `
        ${renderProviderControl(providers)}
        ${renderModelControl(models)}
        ${renderResolutionControl('')}
        ${outpaintLocked ? '' : renderRatioControl('', true)}
        ${outpaintLocked ? '' : renderInlineCustomSizeFields('')}
        ${outpaintLocked ? '' : renderInlineCustomRatioFields('')}
        ${renderQualityControl()}
        ${renderCountVisualControl()}
    `;
}
function renderVolcengineVideoParams(){
    const provider = volcengineConnection();
    const providers = [provider];
    const models = volcengineVideoModels();
    settings.videoProvider = 'volcengine';
    if(!settings.videoModel || !models.includes(settings.videoModel)) settings.videoModel = models[0] || '';
    dynamicParams.innerHTML = `
        ${renderVideoModelSelector(providers, models, false)}
        ${renderVideoGenerationConfig()}
    `;
}
function renderRunningHubParams(){
    const ref = selectedRunningHubRef();
    const fields = rhActiveFields();
    settings.rhParams = settings.rhParams || {};
    settings.rhRandomActive = settings.rhRandomActive || {};
    if(composerHeadParams) composerHeadParams.innerHTML = '';
    if(!ref){
        dynamicParams.innerHTML = `${renderWorkflowSourceControl()}<div class="muted-note">${escapeHtml(tr('smart.rhNeedConfig'))}</div>${renderCountVisualControl()}`;
        return;
    }
    const params = fields.filter(field => {
        const role = rhFieldRole(field);
        return !['image','video','audio','prompt'].includes(role);
    });
    dynamicParams.innerHTML = `
        ${renderWorkflowSourceControl()}
        ${renderRhMachineControl()}
        ${params.length ? params.map(renderRhSettingField).join('') : `<div class="muted-note">${escapeHtml(fields.length ? tr('smart.rhNoParams') : tr('smart.rhNeedFields'))}</div>`}
        ${renderCountVisualControl()}
    `;
}
function rhEntryMediaFields(entry, kind){
    return rhEntryFields(entry).filter(f => f.enabled === true);
}
// 根据当前生成节点已接入的素材类型（图片/视频），过滤掉不支持该素材类型输入的 AI 应用。
// 若素材类型信息不足（字段未加载）则不过滤，避免误隐藏。
function rhEntrySupportsAttachedRefs(entry, kind, attachedKinds){
    if(!attachedKinds.size) return true;
    const fields = rhEntryMediaFields(entry, kind);
    if(!fields.length) return true; // 字段未知（可能未加载），不做过滤
    const supported = new Set(fields.map(f => rhFieldRole(f)).filter(role => ['image', 'video', 'audio'].includes(role)));
    if(!supported.size) return true; // 该应用不接受任何媒体输入字段，保留（比如纯文本参数）
    for(const kindNeeded of attachedKinds){
        if(supported.has(kindNeeded)) return true;
    }
    return false;
}
function rhAttachedRefKinds(){
    const node = activeComposerNode() || selectedNode();
    const refs = node ? visibleReferenceImagesFor(node) : [];
    const kinds = new Set();
    if(imageRefsOnly(refs).length) kinds.add('image');
    if(videoRefsOnly(refs).length) kinds.add('video');
    if(audioRefsOnly(refs).length) kinds.add('audio');
    return kinds;
}
function renderRhConfigControl(ref){
    const attachedKinds = rhAttachedRefKinds();
    const apps = runningHubWorkflowEntriesForNode().map(ref => ref.entry)
        .filter(entry => rhEntrySupportsAttachedRefs(entry, 'app', attachedKinds));
    const selected = ref ? runningHubEntryKey(ref.kind, ref.id) : '';
    const groupHtml = (kind, entries, label) => entries.length ? `
        <div class="model-list-label rh-list-label">${escapeHtml(label)}<span class="count">${entries.length}</span></div>
        ${entries.map(entry => {
            const id = runningHubEntryId(entry, kind);
            const key = runningHubEntryKey(kind, id);
            return `<button type="button" class="direct-option rh-entry-option ${key === selected ? 'active' : ''}" data-smart-param="rhConfigKey" data-smart-value="${escapeHtml(key)}"><i data-lucide="sparkles"></i><span>${escapeHtml(runningHubEntryLabel(entry, kind))}</span></button>`;
        }).join('')}
    ` : '';
    return `<div class="smart-control rh-config-control">
        <button class="smart-pill" type="button"><i data-lucide="workflow"></i><span class="sub">${escapeHtml(ref ? runningHubEntryLabel(ref.entry, ref.kind) : tr('smart.rhConfig'))}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover rh-picker-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.rhConfig'))}</div>
            <div class="model-list rh-config-list">
                ${groupHtml('app', apps, 'AI 应用')}
            </div>
        </div>
    </div>`;
}
function renderRhMachineControl(){
    const value = settings.rhInstanceType === 'plus' ? 'plus' : '';
    const labels = {'':'24G', plus:'48G'};
    return `<div class="smart-control rh-machine-control">
        <button class="smart-pill" type="button"><i data-lucide="cpu"></i><span>${escapeHtml(labels[value])}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover rh-picker-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.rhMachine'))}</div>
            <div class="model-list">
                ${Object.entries(labels).map(([key, label]) => `<button type="button" class="direct-option ${key === value ? 'active' : ''}" data-smart-param="rhInstanceType" data-smart-value="${escapeHtml(key)}"><span>${escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}
function renderComfyParams(){
    const workflows = comfyWorkflowsForNode();
    if(!settings.comfyWorkflow || !workflows.some(w => w.name === settings.comfyWorkflow)) settings.comfyWorkflow = workflows[0]?.name || '';
    if(settings.comfyWorkflow && !comfyWorkflowCache[settings.comfyWorkflow]) ensureComfyWorkflow(settings.comfyWorkflow).then(renderDynamicParams);
    const wf = comfyWorkflowCache[settings.comfyWorkflow];
    const fields = (wf?.config?.fields || []).filter(f => comfyFieldKind(f) === 'setting');
    dynamicParams.innerHTML = `
        ${renderWorkflowSourceControl()}
        ${fields.length ? fields.map(renderComfySettingField).join('') : (settings.comfyWorkflow ? '' : `<div class="muted-note">${escapeHtml(tr('smart.noWorkflow'))}</div>`)}
        ${renderCountVisualControl()}
    `;
}
function renderWorkflowNodeParams(){
    // Workflow nodes can retain the last selected engine in persisted canvas
    // settings. If that source is no longer configured, prefer the other
    // available workflow source instead of showing the RH-only "add workflow"
    // hint for a perfectly valid ComfyUI workflow.
    const workflows = comfyWorkflowsForNode();
    const runningHubWorkflows = runningHubWorkflowEntriesForNode();
    const hasComfy = workflows.length > 0;
    const hasRunningHub = runningHubWorkflows.length > 0;
    if(settings.engine === 'runninghub' && !hasRunningHub && hasComfy) settings.engine = 'comfy';
    else if(settings.engine === 'comfy' && !hasComfy && hasRunningHub) settings.engine = 'runninghub';
    const isComfy = settings.engine === 'comfy';
    let fields = [];
    let body = '';
    if(isComfy){
        if(!settings.comfyWorkflow || !workflows.some(w => w.name === settings.comfyWorkflow)) settings.comfyWorkflow = workflows[0]?.name || '';
        if(settings.comfyWorkflow && !comfyWorkflowCache[settings.comfyWorkflow]) ensureComfyWorkflow(settings.comfyWorkflow).then(renderDynamicParams);
        fields = (comfyWorkflowCache[settings.comfyWorkflow]?.config?.fields || []).filter(f => comfyFieldKind(f) === 'setting');
        body = fields.length ? fields.map(renderComfySettingField).join('') : (settings.comfyWorkflow ? '' : `<div class="muted-note">${escapeHtml(tr('smart.noWorkflow'))}</div>`);
    } else {
        const ref = selectedRunningHubRef();
        settings.rhParams = settings.rhParams || {};
        settings.rhRandomActive = settings.rhRandomActive || {};
        if(!ref) body = `${renderRhMachineControl()}<div class="muted-note">${escapeHtml(hasComfy ? tr('smart.noWorkflow') : tr('smart.rhNeedConfig'))}</div>`;
        else {
            fields = rhActiveFields().filter(field => !['image','video','audio','prompt'].includes(rhFieldRole(field)));
            body = `${renderRhMachineControl()}${fields.length ? fields.map(renderRhSettingField).join('') : `<div class="muted-note">${escapeHtml(tr('smart.rhNoParams'))}</div>`}`;
        }
    }
    // Workflow engines submit one task per requested result. Keep this control
    // alongside the workflow-specific parameters so both ComfyUI and RH use
    // the same 1-4 task selection as image generation.
    dynamicParams.innerHTML = `${renderWorkflowSourceControl()}${body}${renderCountVisualControl()}`;
}
function renderWorkflowSourceControl(){
    const node = activeSettingsSubject();
    const comfyItems = comfyWorkflowsForNode(node).map(workflow => ({
        value:`comfy:${workflow.name}`,
        label:workflow.title || workflow.name.replace('.json', ''),
        cover:workflow.cover,
        active:settings.engine === 'comfy' && workflow.name === settings.comfyWorkflow
    }));
    const rhItems = runningHubWorkflowEntriesForNode(node).map(ref => ({
        value:`runninghub:${runningHubEntryKey(ref.kind, ref.id)}`,
        label:runningHubEntryLabel(ref.entry, ref.kind),
        cover:ref.entry?.cover,
        active:settings.engine === 'runninghub' && settings.rhConfigKey === runningHubEntryKey(ref.kind, ref.id)
    }));
    const active = comfyItems.find(item => item.active) || rhItems.find(item => item.active);
    const label = active?.label || tr('smart.workflow');
    const group = (title, icon, items) => items.length ? `
        <div class="model-list-label rh-list-label">${escapeHtml(title)}<span class="count">${items.length}</span></div>
        ${items.map(item => `<button type="button" class="direct-option workflow-source-option ${item.active ? 'active' : ''}" data-smart-param="workflowSource" data-smart-value="${escapeHtml(item.value)}"${workflowCoverDataAttr(item.cover, item.label)}><i data-lucide="${icon}"></i><span>${escapeHtml(item.label)}</span></button>`).join('')}
    ` : '';
    return `<div class="smart-control workflow-control">
        <button class="smart-pill" type="button"><i data-lucide="layers"></i><span class="sub">${escapeHtml(label)}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
        <div class="smart-popover compact-popover rh-picker-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.workflow'))}</div>
            <div class="model-list rh-config-list">
                ${group('ComfyUI 工作流', 'layers', comfyItems)}
                ${group('RH 应用', 'sparkles', rhItems)}
            </div>
        </div>
    </div>`;
}
function workflowCoverDataAttr(cover, label=''){
    const item = cover && typeof cover === 'object' ? cover : {};
    const url = String(item.url || (item.file_id ? `/api/files/${encodeURIComponent(item.file_id)}/preview` : '') || '').trim();
    return url ? ` data-workflow-cover="${escapeAttr(url)}" data-workflow-cover-label="${escapeAttr(label)}"` : '';
}
let workflowCoverFlyout = null;
let workflowCoverFlyoutHideTimer = null;
function clearWorkflowCoverFlyout(){
    if(workflowCoverFlyoutHideTimer) clearTimeout(workflowCoverFlyoutHideTimer);
    workflowCoverFlyoutHideTimer = null;
    workflowCoverFlyout?.remove();
    workflowCoverFlyout = null;
}
function showWorkflowCoverFlyout(option){
    const url = option?.dataset?.workflowCover;
    if(!url) return clearWorkflowCoverFlyout();
    clearWorkflowCoverFlyout();
    const flyout = document.createElement('aside');
    flyout.className = 'workflow-cover-flyout';
    flyout.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.src = url;
    image.alt = option.dataset.workflowCoverLabel || '';
    const label = document.createElement('span');
    label.textContent = tr('smart.workflow');
    flyout.append(image, label);
    document.body.appendChild(flyout);
    const optionRect = option.getBoundingClientRect();
    const flyoutWidth = 180;
    const flyoutHeight = 240;
    const inset = 12;
    const left = Math.max(inset, Math.min(optionRect.right + 14, window.innerWidth - flyoutWidth - inset));
    const top = Math.max(inset, Math.min(optionRect.top + optionRect.height / 2 - flyoutHeight / 2, window.innerHeight - flyoutHeight - inset));
    flyout.style.left = `${left}px`;
    flyout.style.top = `${top}px`;
    workflowCoverFlyout = flyout;
}
function scheduleWorkflowCoverFlyoutHide(){
    if(workflowCoverFlyoutHideTimer) clearTimeout(workflowCoverFlyoutHideTimer);
    workflowCoverFlyoutHideTimer = setTimeout(clearWorkflowCoverFlyout, 80);
}
function bindWorkflowCoverFlyouts(){
    smartParamRoots().flatMap(root => Array.from(root.querySelectorAll('.workflow-source-option[data-workflow-cover]'))).forEach(option => {
        option.onpointerenter = () => showWorkflowCoverFlyout(option);
        option.onpointerleave = scheduleWorkflowCoverFlyoutHide;
        option.onfocus = () => showWorkflowCoverFlyout(option);
        option.onblur = scheduleWorkflowCoverFlyoutHide;
    });
}
function renderComfyWorkflowControl(){
    const workflows = comfyWorkflowsForNode();
    if(!workflows.length) return `<div class="muted-note">${escapeHtml(tr('smart.noWorkflow'))}</div>`;
    const current = workflows.find(w => w.name === settings.comfyWorkflow) || workflows[0];
    const label = current?.title || (current?.name || '').replace('.json','') || tr('smart.workflow');
    return `<div class="smart-control workflow-control">
        <button class="smart-pill" type="button"><i data-lucide="layers"></i><span class="sub">${escapeHtml(label)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.workflow'))}</div>
            <div class="model-list">
                ${workflows.map(w => `<button type="button" class="direct-option ${w.name === settings.comfyWorkflow ? 'active' : ''}" data-smart-param="comfyWorkflow" data-smart-value="${escapeHtml(w.name)}"><span>${escapeHtml(w.title || w.name.replace('.json',''))}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}
function renderSizeControls(prefix='', includeSource=false){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const ratios = [
        ['1:1','1:1'], ['2:3','2:3'], ['3:2','3:2'], ['3:4','3:4'], ['4:3','4:3'], ['9:16','9:16'], ['16:9','16:9'], ['21:9','21:9'], ['9:21','9:21'],
        ...(includeSource ? [['source', tr('canvas.adaptiveRatio') || '适配比例']] : []),
        ['custom', tr('canvas.custom') || '自定义']
    ];
    return `<select data-param="${resKey}">
            ${['1k','2k','4k','custom'].map(v => optionHtml(v, v === 'custom' ? (tr('canvas.custom') || '自定义') : v.toUpperCase(), settings[resKey] || '1k')).join('')}
        </select>
        <select data-param="${ratioKey}" ${settings[resKey] === 'custom' ? 'disabled' : ''}>
            ${ratios.map(([v,l]) => `<option value="${escapeHtml(v)}" ${v === (settings[ratioKey] || '1:1') ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
        </select>`;
}
function gcdInt(a, b){
    a = Math.abs(Math.round(Number(a) || 0));
    b = Math.abs(Math.round(Number(b) || 0));
    while(b){ const t = b; b = a % b; a = t; }
    return a || 1;
}
function imageSizeForRatio(img){
    const w = Math.round(Number(img?.natural_w || img?.width || img?.w || 0));
    const h = Math.round(Number(img?.natural_h || img?.height || img?.h || 0));
    return w > 0 && h > 0 ? {w, h} : null;
}
function sourceRatioImageForNode(node){
    const images = (node?.images || []).filter(img => img?.url && !isAudioMediaItem(img));
    if(!images.length) return null;
    if(selectedImage.nodeId === node?.id && selectedImage.index >= 0 && imagesForNode(node)[selectedImage.index]){
        const selected = imagesForNode(node)[selectedImage.index];
        if(imageSizeForRatio(selected)) return selected;
    }
    return images.find(img => imageSizeForRatio(img)) || images[0];
}
function sourceRatioCandidateImageForNode(node){
    const self = sourceRatioImageForNode(node);
    if(self) return self;
    const refs = defaultReferenceImagesFor(node).filter(img => img?.url && !isAudioMediaItem(img));
    if(!refs.length) return null;
    return refs.find(img => imageSizeForRatio(img)) || refs[0];
}
// 标准比例表：与 SIZE_MAP / renderRatioControl 保持一致的 9 个预设档位
const STANDARD_RATIO_CHOICES = [
    ['1:1', 1, 1], ['2:3', 2, 3], ['3:2', 3, 2], ['3:4', 3, 4], ['4:3', 4, 3],
    ['9:16', 9, 16], ['16:9', 16, 9], ['21:9', 21, 9], ['9:21', 9, 21]
];
// 直接用原图宽高比匹配最接近的标准比例档位（不经过任何分辨率相关的计算），
// 避免比例匹配结果随所选分辨率（1K/2K/4K）漂移。
function closestStandardRatioKey(width, height){
    const w = Number(width) || 0, h = Number(height) || 0;
    if(!w || !h) return '1:1';
    const ratio = w / h;
    let best = STANDARD_RATIO_CHOICES[0];
    let bestDiff = Infinity;
    for(const item of STANDARD_RATIO_CHOICES){
        const diff = Math.abs(ratio - item[1] / item[2]);
        if(diff < bestDiff){ bestDiff = diff; best = item; }
    }
    return best[0];
}
function reducedRatioForImage(img){
    const size = imageSizeForRatio(img);
    if(!size) return null;
    const d = gcdInt(size.w, size.h);
    return {w:Math.max(1, Math.round(size.w / d)), h:Math.max(1, Math.round(size.h / d))};
}
function sourceImageRatioLabel(prefix=''){
    const node = activeComposerNode() || selectedNode();
    const ratio = reducedRatioForImage(sourceRatioCandidateImageForNode(node));
    if(!ratio) return '';
    return `${ratio.w}:${ratio.h}`;
}
function applySourceRatioToSettings(prefix='', node=activeComposerNode() || selectedNode(), targetSettings=settings){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(targetSettings[ratioKey] !== 'source') return false;
    const size = imageSizeForRatio(sourceRatioCandidateImageForNode(node));
    if(!size) return false;
    const matchedKey = closestStandardRatioKey(size.w, size.h);
    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    targetSettings[wKey] = '';
    targetSettings[hKey] = '';
    targetSettings[customKey] = '';
    targetSettings[`${ratioKey}Matched`] = matchedKey;
    return true;
}
function ratioIconClass(value){
    if(value === '2:3') return 'r-portrait';
    if(value === '3:4') return 'r-portrait43';
    if(value === '3:2') return 'r-landscape';
    if(value === '4:3') return 'r-landscape43';
    if(value === '16:9' || value === '21:9') return 'r-wide';
    if(value === '9:16' || value === '9:21') return 'r-story';
    if(value === 'source') return 'r-source';
    if(value === 'custom') return 'r-custom';
    return '';
}
function videoAspectIconClass(value){
    if(value === '16:9' || value === '21:9') return 'r-wide';
    if(value === '9:16' || value === '9:21') return 'r-story';
    if(value === '4:3') return 'r-landscape43';
    if(value === '3:4') return 'r-portrait43';
    if(value === 'keep_ratio' || value === 'adaptive') return 'r-source';
    return '';
}
function renderProviderControl(providers, restricted){
    const current = (providers || []).find(p => p.id === settings.provider_id) || connectionById(settings.provider_id);
    return `<div class="smart-control provider-control">
        <button class="smart-pill" type="button"><i data-lucide="plug-zap"></i><span class="sub">${escapeHtml(settings.provider_id || tr('smart.platform'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.apiPlatform'))}</div>
            <div class="model-list">
                ${providers.map(p => {
                    const locked = restricted && (p.image_models || []).length > 0 && !(p.image_models || []).some(m => smartModelAllowed(p.id, m));
                    return `<button type="button" class="direct-option ${p.id === settings.provider_id ? 'active' : ''} ${locked ? 'is-locked' : ''}" data-smart-param="provider_id" data-smart-value="${escapeHtml(p.id)}" ${locked ? `title="${escapeHtml(tr('smart.modelLocked'))}"` : ''}><span>${escapeHtml(p.id)}</span>${locked ? '<i data-lucide="lock" class="lock-icon"></i>' : ''}</button>`;
                }).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noApiPlatform'))}</div>`}
            </div>
        </div>
    </div>`;
}
function renderModelControl(models, restricted){
    return `<div class="smart-control model-control">
        <button class="smart-pill" type="button"><i data-lucide="sparkles"></i><span class="sub">${escapeHtml(settings.model ? modelDisplayName(settings.model, settings.provider_id) : tr('smart.model'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.imageModel'))}</div>
            <div class="model-list">
                ${models.map(m => {
                    const modelRef = (aiResourceIndex?.models || []).find(item => item.enabled !== false && item.kind === 'image' && item.connection_id === settings.connection_id && (item.upstream_model === m || item.alias === m));
                    const locked = restricted && !smartModelAllowed(settings.provider_id, m, modelRef?.id);
                    return `<button type="button" class="direct-option ${m === settings.model ? 'active' : ''} ${locked ? 'is-locked' : ''}" data-smart-param="model" data-smart-value="${escapeHtml(m)}" ${locked ? `title="${escapeHtml(tr('smart.modelLocked'))}"` : ''}><span>${escapeHtml(modelDisplayName(m, settings.provider_id))}</span>${locked ? '<i data-lucide="lock" class="lock-icon"></i>' : ''}</button>`;
                }).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noImageModel'))}</div>`}
            </div>
        </div>
    </div>`;
}
function renderRatioControl(prefix='', includeSource=false, allowCustom=true){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(!allowCustom && settings[ratioKey] === 'custom') settings[ratioKey] = '1:1';
    const ratioField = canvasSchemaField('image', 'ratio');
    const ratioName = canvasSchemaFieldName('image', 'ratio', tr('smart.ratio'));
    const ratioValues = Array.isArray(ratioField.options) && ratioField.options.length ? ratioField.options : ['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9','9:21','source','custom'];
    const ratios = ratioValues.filter(value => (includeSource || value !== 'source') && (allowCustom || value !== 'custom')).map(value => [value, canvasSchemaOptionLabel(ratioField, value, value)]);
    const ratioValue = settings[ratioKey] || '1:1';
    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';
    const ratioSummary = canvasSchemaOptionLabel(ratioField, ratioValue, ratioValue === 'custom' ? (settings[customKey] || ratioValue) : ratioValue);
    return `<div class="smart-control ratio-control">
        <button class="smart-pill" type="button" title="${escapeAttr(ratioName)}"><i data-lucide="scan"></i><span>${escapeHtml(ratioSummary)}</span></button>
        <div class="smart-popover">
            <div class="smart-popover-title">${escapeHtml(ratioName)}</div>
            <div class="ratio-grid">
                ${ratios.map(([value, label]) => `<button type="button" class="ratio-option ${value === (settings[ratioKey] || '1:1') ? 'active' : ''}" data-smart-param="${ratioKey}" data-smart-value="${escapeHtml(value)}"><span class="ratio-icon ${ratioIconClass(value)}"></span><span>${escapeHtml(label)}</span></button>`).join('')}
            </div>
        </div>
    </div>`;
}
function renderResolutionControl(prefix='', allowCustom=true){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    const resolutionField = canvasSchemaField('image', 'resolution');
    const resolutionName = canvasSchemaFieldName('image', 'resolution', tr('smart.resolution'));
    const configured = Array.isArray(resolutionField.options) && resolutionField.options.length ? resolutionField.options : ['1k','2k','4k','custom'];
    const options = configured.filter(value => allowCustom || value !== 'custom');
    if(!allowCustom && settings[resKey] === 'custom') settings[resKey] = '1k';
    const resolutionValue = settings[resKey] || '1k';
    const customSizeKey = prefix ? `${prefix}CustomSize` : 'customSize';
    const resolutionSummary = canvasSchemaOptionLabel(resolutionField, resolutionValue, resolutionValue === 'custom' ? (settings[customSizeKey] || resolutionValue) : resolutionValue);
    return `<div class="smart-control resolution-control">
        <button class="smart-pill" type="button" title="${escapeAttr(resolutionName)}"><i data-lucide="monitor"></i><span>${escapeHtml(resolutionSummary)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(resolutionName)}</div>
            <div class="seg-row">
                ${options.map(value => `<button type="button" class="${value === (settings[resKey] || '1k') ? 'active' : ''}" data-smart-param="${resKey}" data-smart-value="${value}">${escapeHtml(canvasSchemaOptionLabel(resolutionField, value, value))}</button>`).join('')}
            </div>
        </div>
    </div>`;
}
function renderInlineCustomRatioFields(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(settings[ratioKey] === 'source') return '';
    if(settings[ratioKey] !== 'custom') return '';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    return `<div class="inline-fields">
        <span class="inline-label">${escapeHtml(tr('smart.ratio'))}</span>
        <input type="number" data-param="${wKey}" value="${escapeHtml(settings[wKey] || '')}" placeholder="W">
        <span class="inline-divider">:</span>
        <input type="number" data-param="${hKey}" value="${escapeHtml(settings[hKey] || '')}" placeholder="H">
    </div>`;
}
function renderInlineCustomSizeFields(prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    if(settings[resKey] !== 'custom') return '';
    const wKey = prefix ? `${prefix}CustomWidth` : 'customWidth';
    const hKey = prefix ? `${prefix}CustomHeight` : 'customHeight';
    return `<div class="inline-fields">
        <span class="inline-label">${escapeHtml(tr('smart.size'))}</span>
        <input type="number" data-param="${wKey}" value="${escapeHtml(settings[wKey] || '')}" placeholder="${escapeHtml(tr('smart.width'))}">
        <span class="inline-divider">×</span>
        <input type="number" data-param="${hKey}" value="${escapeHtml(settings[hKey] || '')}" placeholder="${escapeHtml(tr('smart.height'))}">
    </div>`;
}
function renderQualityControl(){
    const value = settings.quality || 'auto';
    const qualityField = canvasSchemaField('image', 'quality');
    const qualityName = canvasSchemaFieldName('image', 'quality', tr('smart.quality'));
    const options = Array.isArray(qualityField.options) && qualityField.options.length ? qualityField.options : ['auto','low','medium','high'];
    const qualitySummary = canvasSchemaOptionLabel(qualityField, value, value);
    return `<div class="smart-control quality-control">
        <button class="smart-pill" type="button" title="${escapeAttr(qualityName)}"><i data-lucide="sliders-horizontal"></i><span>${escapeHtml(qualitySummary)}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(qualityName)}</div>
            <div class="seg-row">
                ${options.map(k => `<button type="button" class="${k === value ? 'active' : ''}" data-smart-param="quality" data-smart-value="${escapeHtml(k)}">${escapeHtml(canvasSchemaOptionLabel(qualityField, k, k))}</button>`).join('')}
            </div>
        </div>
    </div>`;
}
function renderCountVisualControl(){
    const value = Number(settings.count || 1);
    const field = canvasSchemaField('image', 'count');
    const countName = canvasSchemaFieldName('image', 'count', tr('smart.count'));
    const min = Number(field.min ?? 1), max = Number(field.max ?? 4), step = Number(field.step ?? 1);
    const values = [];
    for(let n=min; n<=max; n+=step) values.push(n);
    const countSummary = canvasSchemaOptionLabel(field, value, value);
    return `<div class="smart-control count-control">
        <button class="smart-pill" type="button" title="${escapeAttr(countName)}"><i data-lucide="copy"></i><span>${escapeHtml(countSummary)}</span></button>
        <div class="smart-popover compact-popover" style="min-width:170px">
            <div class="smart-popover-title">${escapeHtml(countName)}</div>
            <div class="count-grid">
                ${values.map(n => `<button type="button" class="count-cell ${n === value ? 'active' : ''}" data-smart-param="count" data-smart-value="${n}">${escapeHtml(canvasSchemaOptionLabel(field, n, n))}</button>`).join('')}
            </div>
        </div>
    </div>`;
}
function renderCountControl(){
    return `<select data-param="count">${[1,2,3,4].map(n => optionHtml(n, `${n} 张`, Number(settings.count || 1))).join('')}</select>`;
}
function apiImageModelEntries(){
    return imageConnections().flatMap(provider => connectionImageModels(provider.id).map(model => {
        const stable = (aiResourceIndex?.models || []).find(item => item.enabled !== false && item.connection_id === provider.id && item.kind === 'image' && (item.upstream_model === model || item.alias === model));
        return {
        providerId: provider.id,
        connectionId: stable?.connection_id || provider.id,
        modelId: stable?.id || '',
        model,
        label: modelDisplayName(model, provider.id),
        locked: !smartModelAllowed(provider.id, model, stable?.id)
        };
    }));
}
function apiVideoModelEntries(){
    return videoConnections().flatMap(provider => connectionVideoModels(provider.id).map(model => {
        const stable = (aiResourceIndex?.models || []).find(item => item.enabled !== false && item.connection_id === provider.id && item.kind === 'video' && (item.upstream_model === model || item.alias === model));
        return {
        providerId: provider.id,
        connectionId: stable?.connection_id || provider.id,
        modelId: stable?.id || '',
        model,
        label: modelDisplayName(model, provider.id),
        locked: !smartModelAllowed(provider.id, model, stable?.id)
        };
    }));
}
function renderApiImageModelControl(entries, restricted){
    const current = entries.find(entry => entry.connectionId === settings.connection_id && entry.modelId === settings.model_id)
        || entries.find(entry => entry.providerId === settings.provider_id && entry.model === settings.model);
    return `<div class="smart-control model-control">
        <button class="smart-pill" type="button"><i data-lucide="sparkles"></i><span class="sub">${escapeHtml(current?.label || tr('smart.model'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.imageModel'))}</div>
            <div class="model-list">
                ${entries.map(entry => {
                    const locked = restricted && entry.locked;
                    const active = (entry.connectionId === settings.connection_id && entry.modelId === settings.model_id)
                        || (entry.providerId === settings.provider_id && entry.model === settings.model);
                    return `<button type="button" class="direct-option ${active ? 'active' : ''} ${locked ? 'is-locked' : ''}" data-smart-param="model" data-smart-value="${escapeAttr(entry.model)}" data-smart-provider-id="${escapeAttr(entry.providerId)}" data-smart-connection-id="${escapeAttr(entry.connectionId)}" data-smart-model-id="${escapeAttr(entry.modelId)}" ${locked ? `title="${escapeAttr(tr('smart.modelLocked'))}"` : ''}><span>${escapeHtml(entry.label)}</span>${locked ? '<i data-lucide="lock" class="lock-icon"></i>' : ''}</button>`;
                }).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noImageModel'))}</div>`}
            </div>
        </div>
    </div>`;
}
function renderApiVideoModelControl(entries, restricted){
    const current = entries.find(entry => entry.connectionId === settings.videoConnectionId && entry.modelId === settings.videoModelId)
        || entries.find(entry => entry.providerId === settings.videoProvider && entry.model === settings.videoModel);
    return `<div class="smart-control model-control video-model-control">
        <button class="smart-pill" type="button"><i data-lucide="sparkles"></i><span class="sub">${escapeHtml(current?.label || tr('smart.model'))}</span></button>
        <div class="smart-popover compact-popover">
            <div class="smart-popover-title">${escapeHtml(tr('smart.videoModel'))}</div>
            <div class="model-list">
                ${entries.map(entry => {
                    const locked = restricted && entry.locked;
                    const active = (entry.connectionId === settings.videoConnectionId && entry.modelId === settings.videoModelId)
                        || (entry.providerId === settings.videoProvider && entry.model === settings.videoModel);
                    return `<button type="button" class="direct-option ${active ? 'active' : ''} ${locked ? 'is-locked' : ''}" data-smart-param="videoModel" data-smart-value="${escapeAttr(entry.model)}" data-smart-provider-id="${escapeAttr(entry.providerId)}" data-smart-connection-id="${escapeAttr(entry.connectionId)}" data-smart-model-id="${escapeAttr(entry.modelId)}" ${locked ? `title="${escapeAttr(tr('smart.modelLocked'))}"` : ''}><span>${escapeHtml(entry.label)}</span>${locked ? '<i data-lucide="lock" class="lock-icon"></i>' : ''}</button>`;
                }).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noVideoModel'))}</div>`}
            </div>
        </div>
    </div>`;
}
function renderCustomRatioControls(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    if(settings[ratioKey] !== 'custom' && settings[ratioKey] !== 'source') return '';
    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';
    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';
    const disabled = settings[ratioKey] === 'source' ? 'disabled' : '';
    return `<input type="number" data-param="${wKey}" value="${escapeHtml(settings[wKey] || '')}" placeholder="比例宽" ${disabled}>
            <input type="number" data-param="${hKey}" value="${escapeHtml(settings[hKey] || '')}" placeholder="比例高" ${disabled}>`;
}
function renderCustomSizeControls(prefix=''){
    const resKey = prefix ? `${prefix}Resolution` : 'resolution';
    if(settings[resKey] !== 'custom') return '';
    const wKey = prefix ? `${prefix}CustomWidth` : 'customWidth';
    const hKey = prefix ? `${prefix}CustomHeight` : 'customHeight';
    return `<input type="number" data-param="${wKey}" value="${escapeHtml(settings[wKey] || '')}" placeholder="宽度">
            <input type="number" data-param="${hKey}" value="${escapeHtml(settings[hKey] || '')}" placeholder="高度">`;
}
function renderComfySettingField(field){
    const value = comfyParamValue(field);
    const label = field.name || field.input || field.id;
    if(field.type === 'boolean') return `<button type="button" class="setting-check ${value ? 'active' : ''}" data-comfy-bool="${escapeHtml(field.id)}"><span class="check-box"></span><span>${escapeHtml(label)}</span></button>`;
    if(field.type === 'dropdown'){
        const opts = field.options || [];
        const curLabel = String(value || opts[0] || label);
        return `<div class="smart-control comfy-dropdown-control" title="${escapeHtml(label)}">
            <button class="smart-pill" type="button"><span class="sub">${escapeHtml(curLabel)}</span></button>
            <div class="smart-popover compact-popover">
                <div class="smart-popover-title">${escapeHtml(label)}</div>
                <div class="model-list">
                    ${opts.map(o => `<button type="button" class="direct-option ${String(o) === String(value) ? 'active' : ''}" data-comfy-pick="${escapeHtml(field.id)}" data-comfy-value="${escapeHtml(o)}"><span>${escapeHtml(o)}</span></button>`).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noOption'))}</div>`}
                </div>
            </div>
        </div>`;
    }
    if(field.type === 'textarea') return `<textarea class="wide" data-comfy-param="${escapeHtml(field.id)}" placeholder="${escapeHtml(label)}" style="width:160px">${escapeHtml(value)}</textarea>`;
    const type = (field.type === 'number' || field.type === 'slider') ? 'number' : 'text';
    const min = field.min !== undefined ? ` min="${escapeHtml(field.min)}"` : '';
    const max = field.max !== undefined ? ` max="${escapeHtml(field.max)}"` : '';
    const step = field.step !== undefined ? ` step="${escapeHtml(field.step)}"` : '';
    const isNumeric = type === 'number';
    const inputHtml = `<input type="${type}" data-comfy-param="${escapeHtml(field.id)}" value="${escapeHtml(value)}"${min}${max}${step}>`;
    if(isNumeric && comfyRandomEnabledField(field)){
        const active = smartComfyRandomActive(field.id);
        return `<div class="num-with-dice" title="${escapeHtml(label)}">
            <span class="num-label">${escapeHtml(label)}</span>
            ${inputHtml}
            <button type="button" class="dice-btn ${active ? 'active' : ''}" data-comfy-random="${escapeHtml(field.id)}" title="${escapeHtml(active ? tr('smart.diceOn') : tr('smart.diceOff'))}"><i data-lucide="dice-5"></i></button>
        </div>`;
    }
    if(isNumeric){
        return `<div class="num-compact" title="${escapeHtml(label)}"><span class="num-label">${escapeHtml(label)}</span>${inputHtml}</div>`;
    }
    return `<div class="num-compact" title="${escapeHtml(label)}"><span class="num-label">${escapeHtml(label)}</span>${inputHtml}</div>`;
}
const RH_KNOWN_FIELD_OPTIONS = {
    aspectRatio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    aspect_ratio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    ratio:['1:1','16:9','9:16','21:9','9:21','4:3','3:4','4:5','5:4','3:2','2:3'],
    resolution:['1k','2k','4k','8k'],
    size:['512','768','1024','1280','1536','2048'],
    quality:['low','medium','high','best'],
    scheduler:['normal','karras','exponential','sgm_uniform','simple','ddim_uniform'],
    sampler:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc']
};
function rhParamKey(nodeId, fieldName){
    return `${nodeId ?? ''}::${fieldName ?? ''}`;
}
function rhFieldKind(field){
    const type = String(field?.fieldType || '').trim().toUpperCase();
    if(type === 'IMAGE') return 'image';
    if(type === 'VIDEO') return 'video';
    if(type === 'AUDIO') return 'audio';
    if(type === 'PROMPT' || type === 'TEXTAREA') return 'prompt';
    if(type === 'SLIDER') return 'slider';
    if(['NUMBER','FLOAT','INTEGER','INT'].includes(type)) return 'number';
    if(['BOOLEAN','BOOL'].includes(type)) return 'boolean';
    if(['SELECT','LIST','DROPDOWN','COMBO','ENUM'].includes(type)) return 'dropdown';
    return 'text';
}
function rhFieldRole(field){
    return rhFieldKind(field);
}
function rhExtractFieldOptions(field){
    const candidates = [field?.fieldData, field?.options, field?.list, field?.values, field?.enum, field?.choices, field?.items, field?.selectOptions, field?.dropdown];
    for(const candidate of candidates){
        if(!Array.isArray(candidate) || !candidate.length) continue;
        if(candidate.every(x => ['string','number'].includes(typeof x))) return candidate.map(String);
        if(candidate.every(x => x && typeof x === 'object' && ('value' in x || 'label' in x || 'name' in x))){
            return candidate.map(x => x.value ?? x.label ?? x.name).filter(v => v !== undefined && v !== null).map(String);
        }
    }
    const fieldType = String(field?.fieldType || '').toUpperCase();
    if(['LIST','SELECT','DROPDOWN','COMBO','ENUM'].includes(fieldType) && Array.isArray(field?.fieldValue)){
        return field.fieldValue.filter(x => ['string','number'].includes(typeof x)).map(String);
    }
    const name = String(field?.fieldName || '').trim();
    if(name){
        if(RH_KNOWN_FIELD_OPTIONS[name]) return RH_KNOWN_FIELD_OPTIONS[name].map(String);
        const hit = Object.keys(RH_KNOWN_FIELD_OPTIONS).find(k => k.toLowerCase() === name.toLowerCase());
        if(hit) return RH_KNOWN_FIELD_OPTIONS[hit].map(String);
    }
    return null;
}
function rhDefaultValue(field){
    let value = field?.fieldValue;
    if(Array.isArray(value)) value = value[0];
    if(value === undefined || value === null || typeof value === 'object') return '';
    return String(value);
}
function rhRandomEnabled(field){
    return rhFieldKind(field) === 'number' && field?.random_enabled === true;
}
function smartRhRandomActive(key){
    return smartRhRandomActiveFor(settings, key);
}
function smartRhRandomActiveFor(sourceSettings=settings, key){
    sourceSettings = sourceSettings || settings;
    sourceSettings.rhRandomActive = sourceSettings.rhRandomActive || {};
    return sourceSettings.rhRandomActive[key] !== false;
}
function toggleSmartRhRandom(key){
    const field = rhActiveFields().find(f => rhParamKey(f.nodeId, f.fieldName) === key);
    if(!rhRandomEnabled(field)) return;
    settings.rhRandomActive = settings.rhRandomActive || {};
    settings.rhRandomActive[key] = !smartRhRandomActive(key);
    persistActiveSmartSettings();
    renderDynamicParams();
    scheduleSave();
}
function smartRhRandomValue(field){
    return smartComfyRandomValue({
        input:field.fieldName,
        name:field.label || field.fieldName,
        min:field.min,
        max:field.max,
        step:field.step,
        type:'number'
    });
}
function rhParamValue(field, media=null, sourceSettings=settings, fields=null, randomValues=smartRhRandomValues){
    sourceSettings = sourceSettings || settings;
    sourceSettings.rhParams = sourceSettings.rhParams || {};
    const key = rhParamKey(field.nodeId, field.fieldName);
    const param = sourceSettings.rhParams[key];
    const kind = rhFieldKind(field);
    if(['image','video','audio'].includes(kind)){
        const idx = rhFieldIndexes(fields || rhActiveFields(sourceSettings))[key] || 0;
        const up = media?.[kind]?.[idx]?.url || '';
        return up || param?.value || rhDefaultValue(field);
    }
    if(rhRandomEnabled(field) && smartRhRandomActiveFor(sourceSettings, key)){
        if(randomValues[key] === undefined) randomValues[key] = smartRhRandomValue(field);
        return randomValues[key];
    }
    if(rhFieldRole(field) === 'prompt') return param?.value ?? (media?.prompt || rhDefaultValue(field));
    return param?.value ?? rhDefaultValue(field);
}
function rhUserParamValue(field){
    settings.rhParams = settings.rhParams || {};
    const key = rhParamKey(field.nodeId, field.fieldName);
    return settings.rhParams[key]?.value ?? '';
}
function rhPromptPlaceholder(field){
    return rhDefaultValue(field) || field?.label || field?.fieldName || tr('smart.promptPlaceholder');
}
function rhDefaultPromptSuggestion(){
    if(settings.engine !== 'runninghub') return '';
    const fields = rhActiveFields().filter(field => rhFieldRole(field) === 'prompt');
    for(const field of fields){
        const value = rhDefaultValue(field).trim();
        if(value) return value;
    }
    return '';
}
function rhPromptFields(sourceSettings=settings){
    if((sourceSettings || settings).engine !== 'runninghub') return [];
    return rhActiveFields(sourceSettings).filter(field => rhFieldRole(field) === 'prompt');
}
function rhRequiresPrompt(sourceSettings=settings){
    return rhPromptFields(sourceSettings).length > 0;
}
function smartPromptInputEnabledForSettings(sourceSettings=settings){
    const source = sourceSettings || settings;
    if(source.engine === 'runninghub') return rhRequiresPrompt(source);
    if(source.engine === 'comfy') return currentComfyFields(source).some(field => comfyFieldKind(field) === 'prompt');
    return true;
}
function updatePromptPlaceholder(){
    if(!promptInput) return;
    const suggestion = rhDefaultPromptSuggestion();
    if(suggestion){
        promptInput.dataset.placeholder = suggestion;
        return;
    }
    const node = activeSettingsSubject();
    const isVideo = node?.genKind === 'video' || settings.apiKind === 'video';
    // 视频生成节点：无论有无输入，均使用基础文案。
    if(isVideo){
        promptInput.dataset.placeholder = tr('smart.promptPlaceholderBasic');
        return;
    }
    // 图片生成节点：有输入素材时提示可用 @ 引用，否则用基础文案。
    const hasInput = node ? visibleReferenceImagesFor(node).length > 0 : false;
    promptInput.dataset.placeholder = hasInput
        ? tr('smart.promptPlaceholderWithMention')
        : tr('smart.promptPlaceholderBasic');
}
function syncComposerPromptVisibility(){
    const row = promptInput?.closest?.('.prompt-row');
    if(!row) return;
    const hidden = !smartPromptInputEnabledForSettings(settings);
    row.classList.toggle('prompt-row-hidden', hidden);
    if(hidden) closeMentionPicker();
}
function rhFieldIndexes(fields){
    const counters = {image:0, video:0, audio:0};
    const map = {};
    sortRunningHubFields(fields).forEach(field => {
        const kind = rhFieldKind(field);
        if(['image','video','audio'].includes(kind)){
            map[rhParamKey(field.nodeId, field.fieldName)] = counters[kind]++;
        }
    });
    return map;
}
function rhMediaForRun(prompt, refs){
    const cleanRefs = (refs || []).filter(ref => ref?.url);
    return {
        refs:cleanRefs,
        image:imageRefsOnly(cleanRefs),
        video:videoRefsOnly(cleanRefs),
        audio:audioRefsOnly(cleanRefs),
        prompt:String(prompt || '').trim()
    };
}
function normalizeRhTextValue(value){
    return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
async function rhUploadValueIfNeeded(value, sourceSettings=settings){
    const text = String(value || '').trim();
    if(!text) return '';
    if(!/^https?:\/\//i.test(text)
        && !text.startsWith('/output/')
        && !text.startsWith('/assets/')
        && !text.startsWith('/api/files/')) return text;
    // Uploads precede submitRunningHubGeneration(). Resolve here as well so
    // persisted API settings from an earlier engine cannot reach the RH API.
    const target = runningHubTarget(selectedRunningHubRef(sourceSettings), sourceSettings);
    const res = await fetch('/api/runninghub/upload-asset', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:text, connection_id:target.connection_id, resource_id:target.resource_id})
    });
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.detail || data.error || tr('smart.rhUploadFailed'));
    return data.data?.fileName || text;
}
async function rhBuildNodeInfoList(media, sourceSettings=settings, randomValues=smartRhRandomValues){
    const fields = rhActiveFields(sourceSettings);
    const result = [];
    for(const field of fields){
        const kind = rhFieldKind(field);
        let value = rhParamValue(field, media, sourceSettings, fields, randomValues);
        if(rhFieldRole(field) === 'prompt' && !String(value || '').trim()) value = rhDefaultValue(field);
        if(['image','video','audio'].includes(kind)) value = await rhUploadValueIfNeeded(value, sourceSettings);
        if(['number','slider'].includes(kind) && String(value ?? '').trim() !== '' && !Number.isNaN(Number(value))) value = Number(value);
        if(typeof value === 'string') value = normalizeRhTextValue(value);
        result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
    }
    return result;
}
function renderRhSettingField(field){
    const key = rhParamKey(field.nodeId, field.fieldName);
    const kind = rhFieldRole(field);
    const label = field.label || field.fieldName || 'Field';
    const value = rhParamValue(field, null);
    const options = rhExtractFieldOptions(field);
    if(kind === 'boolean'){
        const active = String(value).toLowerCase() === 'true';
        return `<button type="button" class="setting-check ${active ? 'active' : ''}" data-rh-bool="${escapeHtml(key)}"><span class="check-box"></span><span>${escapeHtml(label)}</span></button>`;
    }
    if(kind === 'slider'){
        const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
        const max = Number.isFinite(Number(field.max)) && Number(field.max) > min ? Number(field.max) : 1;
        const step = Number.isFinite(Number(field.step)) && Number(field.step) > 0 ? Number(field.step) : 0.01;
        const numericValue = Number.isFinite(Number(value)) ? Number(value) : min;
        return `<div class="smart-control rh-slider-control" title="${escapeHtml(label)}">
            <button class="smart-pill" type="button"><span class="sub">${escapeHtml(label)}</span><span class="rh-slider-pill-value">${escapeHtml(numericValue)}</span></button>
            <div class="smart-popover compact-popover rh-picker-popover rh-param-popover rh-slider-popover">
                <div class="smart-popover-title"><span>${escapeHtml(label)}</span><span class="rh-slider-value">${escapeHtml(numericValue)}</span></div>
                <input type="range" class="smart-range rh-slider-input" data-rh-param="${escapeHtml(key)}" data-rh-type="slider" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" value="${escapeHtml(numericValue)}">
            </div>
        </div>`;
    }
    if(options?.length){
        const curLabel = String(value || options[0] || label);
        return `<div class="smart-control rh-dropdown-control" title="${escapeHtml(label)}">
            <button class="smart-pill" type="button"><span class="sub">${escapeHtml(curLabel)}</span><i data-lucide="chevron-down" class="pill-caret"></i></button>
            <div class="smart-popover compact-popover rh-picker-popover rh-param-popover">
                <div class="smart-popover-title">${escapeHtml(label)}</div>
                <div class="model-list rh-param-list">
                    ${options.map(o => `<button type="button" class="direct-option ${String(o) === String(value) ? 'active' : ''}" data-rh-pick="${escapeHtml(key)}" data-rh-value="${escapeHtml(o)}"><span>${escapeHtml(o)}</span></button>`).join('') || `<div class="muted-note">${escapeHtml(tr('smart.noOption'))}</div>`}
                </div>
            </div>
        </div>`;
    }
    const type = kind === 'number' ? 'number' : 'text';
    const inputHtml = `<input type="${type}" data-rh-param="${escapeHtml(key)}" value="${escapeHtml(value)}">`;
    if(kind === 'number' && rhRandomEnabled(field)){
        const active = smartRhRandomActive(key);
        return `<div class="num-with-dice" title="${escapeHtml(label)}">
            <span class="num-label">${escapeHtml(label)}</span>
            ${inputHtml}
            <button type="button" class="dice-btn ${active ? 'active' : ''}" data-rh-random="${escapeHtml(key)}" title="${escapeHtml(active ? tr('smart.diceOn') : tr('smart.diceOff'))}"><i data-lucide="dice-5"></i></button>
        </div>`;
    }
    return `<div class="num-compact ${type === 'text' ? 'rh-text-param' : ''}" title="${escapeHtml(label)}"><span class="num-label">${escapeHtml(label)}</span>${inputHtml}</div>`;
}
function comfyRandomEnabledField(field){ return field?.type === 'number' && field.random_enabled === true; }
function smartComfyRandomActive(fieldId){
    return smartComfyRandomActiveFor(settings, fieldId);
}
function smartComfyRandomActiveFor(source, fieldId){
    const active = source?.comfyRandomActive || {};
    return active[fieldId] !== false;
}
function toggleSmartComfyRandom(fieldId){
    settings.comfyRandomActive = settings.comfyRandomActive || {};
    settings.comfyRandomActive[fieldId] = !smartComfyRandomActive(fieldId);
    persistActiveSmartSettings();
    renderDynamicParams();
    scheduleSave();
}
function smartComfyRandomValue(field){
    const isFloat = Number(field.step) > 0 && Number(field.step) < 1;
    let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
    let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
    const name = `${field.input || ''} ${field.name || ''}`.toLowerCase();
    const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('噪');
    if(min === null) min = looksSeed ? 1 : 0;
    if(max === null || max <= min) max = looksSeed ? 1000000000000000 : 999999;
    const value = min + Math.random() * (max - min);
    if(isFloat){
        const precision = Math.min(8, Math.max(1, String(field.step).split('.')[1]?.length || 2));
        return Number(value.toFixed(precision));
    }
    return Math.floor(value);
}
function setDynamicSetting(key, value, providerId='', connectionId='', modelId=''){
    const numericKeys = new Set(['count','videoDuration','customRatioWidth','customRatioHeight','customWidth','customHeight','msCustomRatioWidth','msCustomRatioHeight','msCustomWidth','msCustomHeight']);
    const layoutKeys = new Set(['provider_id','model','resolution','ratio','msgenModel','msCustomModel','msResolution','msRatio','videoProvider','videoModel','videoAspect','videoResolution','workflowSource','comfyWorkflow','quality','count','rhConfigKey','rhInstanceType']);
    if(key === 'model' && providerId) settings.provider_id = providerId;
    if(key === 'model' && connectionId) { settings.connection_id = connectionId; settings.model_id = modelId || ''; }
    if(key === 'videoModel' && providerId) settings.videoProvider = providerId;
    if(key === 'videoModel' && connectionId) { settings.videoConnectionId = connectionId; settings.videoModelId = modelId || ''; }
    settings[key] = numericKeys.has(key) && value !== '' ? Number(value) : value;
    if(key === 'provider_id') settings.model = '';
    if(key === 'provider_id' || key === 'model') Object.assign(settings, stableCanvasTarget('image', settings.provider_id, settings.model));
    if(key === 'videoProvider' || key === 'videoModel') {
        const target = stableCanvasTarget('video', settings.videoProvider, settings.videoModel);
        settings.videoConnectionId = target.connection_id;
        settings.videoModelId = target.model_id;
        settings.videoResourceId = target.resource_id;
    }
    if(key === 'videoProvider') settings.videoModel = '';
    if(key === 'provider_id' || key === 'model') void refreshCanvasParameterSchema('image', settings.provider_id, settings.model);
    if(key === 'videoProvider' || key === 'videoModel') void refreshCanvasParameterSchema('video', settings.videoProvider, settings.videoModel);
    if(key === 'videoMultimodal' && settings.videoMultimodal) settings.videoUseFrameRoles = false;
    if(key === 'videoUseFrameRoles' && settings.videoUseFrameRoles) settings.videoMultimodal = false;
    if(key === 'workflowSource'){
        const match = String(value || '').match(/^(comfy|runninghub):(.*)$/);
        if(match){
            settings.engine = match[1];
            if(match[1] === 'comfy') settings.comfyWorkflow = match[2];
            else settings.rhConfigKey = match[2];
            settings.comfyParams = {};
            settings.rhParams = {};
            settings.rhRandomActive = {};
        }
    }
    if(key === 'resolution'){
        if(settings.resolution === 'custom') settings.ratio = '';
        else if(!settings.ratio) settings.ratio = '1:1';
    }
    if(key === 'ratio') applySourceRatioToSettings('');
    if(key === 'msResolution'){
        if(settings.msResolution === 'custom') settings.msRatio = '';
        else if(!settings.msRatio) settings.msRatio = '1:1';
    }
    if(key === 'msRatio') applySourceRatioToSettings('ms');
    if(key === 'customRatioWidth' || key === 'customRatioHeight') settings.customRatio = settings.customRatioWidth && settings.customRatioHeight ? `${settings.customRatioWidth}:${settings.customRatioHeight}` : '';
    if(key === 'msCustomRatioWidth' || key === 'msCustomRatioHeight') settings.msCustomRatio = settings.msCustomRatioWidth && settings.msCustomRatioHeight ? `${settings.msCustomRatioWidth}:${settings.msCustomRatioHeight}` : '';
    if(key === 'customWidth' || key === 'customHeight') settings.customSize = settings.customWidth && settings.customHeight ? `${settings.customWidth}x${settings.customHeight}` : '';
    if(key === 'msCustomWidth' || key === 'msCustomHeight') settings.msCustomSize = settings.msCustomWidth && settings.msCustomHeight ? `${settings.msCustomWidth}x${settings.msCustomHeight}` : '';
    const sizeKeys = new Set(['resolution','ratio','customRatio','customRatioWidth','customRatioHeight','customWidth','customHeight','customSize']);
    const unlockOutpaintSize = settings.outpaintResolutionLocked && sizeKeys.has(key);
    if(unlockOutpaintSize){
        delete settings.outpaintResolutionLocked;
        const subject = activeSettingsSubject();
        if(subject) delete subject.outpaintSize;
    }
    if(key === 'comfyWorkflow') {
        settings.comfyParams = {};
        const target = stableCanvasTarget('comfyui_workflow', 'comfyui', settings.comfyWorkflow);
        settings.connection_id = target.connection_id;
        settings.resource_id = target.resource_id;
        ensureComfyWorkflow(settings.comfyWorkflow).then(renderDynamicParams);
    }
    if(key === 'rhConfigKey'){
        settings.rhParams = {};
        settings.rhRandomActive = {};
        const ref = selectedRunningHubRef(settings);
        const target = runningHubTarget(ref, settings);
        settings.connection_id = target.connection_id;
        settings.resource_id = target.resource_id;
    }
    persistActiveSmartSettings();
    rememberRecentSmartSettings(settings, activeSettingsSubject());
    if(layoutKeys.has(key)) renderDynamicParams();
    scheduleSave();
}
function closeAllSmartPopovers(){
    document.querySelectorAll('.smart-control.pinned').forEach(c => c.classList.remove('pinned'));
}
function smartParamRoots(){
    return [dynamicParams, composerHeadParams].filter(Boolean);
}
function bindDynamicParams(){
    const queryAll = selector => smartParamRoots().flatMap(root => Array.from(root.querySelectorAll(selector)));
    bindWorkflowCoverFlyouts();
    queryAll('.smart-control > .smart-pill').forEach(pill => {
        pill.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const ctrl = pill.parentElement;
            const wasPinned = ctrl.classList.contains('pinned');
            closeAllSmartPopovers();
            if(!wasPinned) ctrl.classList.add('pinned');
            else pill.blur();
        };
    });
    queryAll('[data-smart-param]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            if(btn.classList.contains('is-locked')){
                toast(tr('smart.modelLocked'));
                return;
            }
            if(btn.closest('.video-model-control')) reopenVideoControlAfterRender = 'model';
            else if(btn.closest('.video-generation-control')) reopenVideoControlAfterRender = 'config';
            setDynamicSetting(btn.dataset.smartParam, btn.dataset.smartValue, btn.dataset.smartProviderId || '', btn.dataset.smartConnectionId || '', btn.dataset.smartModelId || '');
            if(btn.dataset.smartParam === 'videoDuration') renderDynamicParams();
        };
    });
    queryAll('[data-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            if(event?.type === 'change' && input.closest('.video-generation-control')) reopenVideoControlAfterRender = 'config';
            setDynamicSetting(input.dataset.param, input.value);
            if(input.dataset.param === 'videoDuration' && event?.type === 'change') renderDynamicParams();
        };
    });
    queryAll('[data-video-audio]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            settings.videoGenerateAudio = btn.dataset.videoAudio === 'on';
            reopenVideoControlAfterRender = 'config';
            persistActiveSmartSettings();
            renderDynamicParams();
            scheduleSave();
        };
    });
    queryAll('[data-video-mode]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const mode = btn.dataset.videoMode;
            setVideoGenerationMode(mode);
            reopenVideoControlAfterRender = 'config';
            persistActiveSmartSettings();
            renderDynamicParams();
            scheduleSave();
        };
    });
    queryAll('[data-toggle-param]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            if(btn.closest('.video-generation-control')) reopenVideoControlAfterRender = 'config';
            settings[btn.dataset.toggleParam] = !settings[btn.dataset.toggleParam];
            if(btn.dataset.toggleParam === 'videoMultimodal' && settings.videoMultimodal) settings.videoUseFrameRoles = false;
            if(btn.dataset.toggleParam === 'videoUseFrameRoles' && settings.videoUseFrameRoles) settings.videoMultimodal = false;
            persistActiveSmartSettings();
            renderDynamicParams();
            scheduleSave();
        };
    });
    queryAll('[data-comfy-bool]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            settings.comfyParams = settings.comfyParams || {};
            const id = btn.dataset.comfyBool;
            const field = currentComfyFields().find(f => f.id === id);
            settings.comfyParams[id] = !Boolean(settings.comfyParams[id] ?? field?.default ?? false);
            persistActiveSmartSettings();
            renderDynamicParams();
            scheduleSave();
        };
    });
    queryAll('[data-comfy-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            settings.comfyParams = settings.comfyParams || {};
            const field = currentComfyFields().find(f => f.id === input.dataset.comfyParam);
            if(field?.type === 'number' || field?.type === 'slider') settings.comfyParams[input.dataset.comfyParam] = Number(input.value) || 0;
            else settings.comfyParams[input.dataset.comfyParam] = input.value;
            persistActiveSmartSettings();
            scheduleSave();
        };
    });
    queryAll('[data-comfy-pick]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            settings.comfyParams = settings.comfyParams || {};
            const fieldId = btn.dataset.comfyPick;
            const value = btn.dataset.comfyValue;
            settings.comfyParams[fieldId] = value;
            const popover = btn.closest('.smart-popover');
            const control = btn.closest('.smart-control');
            const pillSub = control?.querySelector('.smart-pill .sub');
            if(pillSub) pillSub.textContent = value;
            if(popover){
                popover.querySelectorAll(`[data-comfy-pick="${fieldId}"]`).forEach(b => b.classList.toggle('active', b.dataset.comfyValue === value));
            }
            closeAllSmartPopovers();
            persistActiveSmartSettings();
            scheduleSave();
        };
    });
    queryAll('[data-comfy-random]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            toggleSmartComfyRandom(btn.dataset.comfyRandom);
        };
    });
    queryAll('[data-rh-bool]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            settings.rhParams = settings.rhParams || {};
            const key = btn.dataset.rhBool;
            const field = rhActiveFields().find(f => rhParamKey(f.nodeId, f.fieldName) === key);
            const cur = settings.rhParams[key] || {};
            const on = String(rhParamValue(field, null)).toLowerCase() === 'true';
            settings.rhParams[key] = {...cur, value:String(!on)};
            persistActiveSmartSettings();
            renderDynamicParams();
            scheduleSave();
        };
    });
    queryAll('[data-rh-param]').forEach(input => {
        input.onclick = event => event.stopPropagation();
        input.oninput = input.onchange = event => {
            event?.stopPropagation?.();
            const key = input.dataset.rhParam;
            settings.rhParams = settings.rhParams || {};
            const cur = settings.rhParams[key] || {};
            settings.rhParams[key] = {...cur, value:input.value};
            const control = input.closest('.smart-control');
            const valueText = control?.querySelector('.rh-slider-value');
            const pillValue = control?.querySelector('.rh-slider-pill-value');
            if(valueText) valueText.textContent = input.value;
            if(pillValue) pillValue.textContent = input.value;
            persistActiveSmartSettings();
            scheduleSave();
        };
        if(input.dataset.rhType === 'slider'){
            input.onpointerup = () => input.blur();
            input.onmouseleave = () => {
                if(!input.closest('.smart-control')?.matches(':hover')) input.blur();
            };
        }
    });
    queryAll('[data-rh-pick]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            const key = btn.dataset.rhPick;
            const value = btn.dataset.rhValue;
            settings.rhParams = settings.rhParams || {};
            const cur = settings.rhParams[key] || {};
            settings.rhParams[key] = {...cur, value};
            const popover = btn.closest('.smart-popover');
            const control = btn.closest('.smart-control');
            const pillSub = control?.querySelector('.smart-pill .sub');
            if(pillSub) pillSub.textContent = value;
            if(popover){
                popover.querySelectorAll('[data-rh-pick]').forEach(b => {
                    if(b.dataset.rhPick === key) b.classList.toggle('active', b.dataset.rhValue === value);
                });
            }
            closeAllSmartPopovers();
            persistActiveSmartSettings();
            scheduleSave();
        };
    });
    queryAll('[data-rh-random]').forEach(btn => {
        btn.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            toggleSmartRhRandom(btn.dataset.rhRandom);
        };
    });
}
let configRefreshPromise = null;
let lastConfigErrorKey = '';
let lastConfigErrorAt = 0;
async function loadConfigOnce({invalidateParameterSchemas=false}={}){
    let stableCfg;
    try {
        // Canvas users may not have the API settings management page permission.
        // Read the public, read-only resource projection instead of the protected
        // editing endpoint; management pages continue to use configuration.
        const configurationResponse = await fetch('/api/ai/resources', {credentials:'same-origin'});
        if(!configurationResponse.ok) throw new Error(`配置接口返回 ${configurationResponse.status}`);
        stableCfg = await configurationResponse.json();
    } catch(e) {
        const key = String(e?.message || e);
        console.error('[canvas] API settings request failed', e);
        if(key !== lastConfigErrorKey || Date.now() - lastConfigErrorAt > 8000){
            lastConfigErrorKey = key;
            lastConfigErrorAt = Date.now();
            toast(`${tr('smart.toastApiSettingsFail')}：${key}`);
        }
        return false;
    }
    try {
        const cfg = {comfy_instances:[]};
        aiResourceIndex = stableCfg || {connections:[], models:[], resources:[]};
        aiConnections = (stableCfg.connections || []).map(c => {
            const connectionModels = (stableCfg.models || []).filter(m => m.connection_id === c.id && m.enabled !== false);
            return {...c, id:c.id, connection_id:c.id,
            image_models:connectionModels.filter(m => m.kind === 'image').map(m => m.upstream_model),
            chat_models:connectionModels.filter(m => m.kind === 'chat').map(m => m.upstream_model),
            video_models:connectionModels.filter(m => m.kind === 'video').map(m => m.upstream_model),
            model_aliases:Object.fromEntries(connectionModels.map(m => [m.upstream_model, m.alias || m.upstream_model])),
            // Executable workflows/apps live in `resources` in the authoritative
            // configuration. Attach them to their connection for the legacy
            // provider-shaped canvas selectors.
            rh_apps:(stableCfg.resources || []).filter(r => r.connection_id === c.id && r.kind === 'runninghub_app').map(r => {
                const id = r.settings?.app_id || r.settings?.id || r.settings?.appId || r.settings?.webappId || r.id;
                return {...(r.settings || {}), id, appId:id, webappId:id, title:r.title || r.settings?.title || r.name, name:r.name, enabled:r.enabled !== false};
            }),
            comfy_workflows:(stableCfg.resources || []).filter(r => r.connection_id === c.id && r.kind === 'comfyui_workflow').map(r => ({
                ...(r.settings || {}),
                name: r.settings?.name || r.name,
                enabled: r.enabled !== false,
            }))
        }});
        if(invalidateParameterSchemas) canvasParameterSchemaCache.clear();
        const imageProvider = imageConnections().find(provider => provider.id === settings.provider_id) || imageConnections()[0];
        const videoProvider = videoConnections().find(provider => provider.id === settings.videoProvider) || videoConnections()[0];
        await Promise.all([
            refreshCanvasParameterSchema('image', imageProvider?.id || '', settings.model || imageProvider?.image_models?.[0] || ''),
            refreshCanvasParameterSchema('video', videoProvider?.id || '', settings.videoModel || videoProvider?.video_models?.[0] || ''),
        ]);
        comfyInstanceCount = Math.max(1, (Array.isArray(cfg.comfy_instances) ? cfg.comfy_instances : []).filter(Boolean).length || 1);
        // 根据 provider 启用状态隐藏引擎选项
        syncEngineOptionsVisibility();
        // 提供商配置就绪后立即刷新参数面板。
        sanitizeSmartApiSelection(settings);
        updateProviderModels();
        const workflowResponse = await fetch('/api/workflows', {credentials:'same-origin'});
        if(workflowResponse.ok){
            const wf = await workflowResponse.json();
            const legacyWorkflows = Array.isArray(wf.workflows) ? wf.workflows : [];
            // /api/workflows is the authoritative list shown by Workflow Settings.
            // Do not merge legacy comfyui_workflow resources from AI configuration:
            // those records can survive migration without an actual workflow and
            // would make the canvas show entries that cannot be opened or deleted.
            comfyWorkflows = legacyWorkflows.filter(item => item?.enabled !== false);
        } else {
            console.warn('[canvas] workflow refresh skipped', workflowResponse.status);
        }
        // The workflow settings page broadcasts `workflows-changed` after
        // saving fields. Drop cached per-workflow configs so the canvas reads
        // the newly saved `config.fields` instead of rendering stale controls.
        comfyWorkflowCache = {};
        // Older canvas payloads stored custom workflow names without the
        // `.json` suffix. Match them to the current API names when possible.
        const workflowNames = new Set(comfyWorkflows.map(item => item?.name).filter(Boolean));
        const legacyName = String(settings.comfyWorkflow || '');
        if(legacyName && !workflowNames.has(legacyName) && workflowNames.has(`${legacyName}.json`)){
            settings.comfyWorkflow = `${legacyName}.json`;
        }
        lastConfigRefreshAt = Date.now();
        sanitizeSmartApiSelection(settings);
        updateProviderModels();
    } catch(e) {
        console.error('[canvas] API settings apply failed', e);
        return false;
    }
    return true;
}
async function loadConfig(options={}){
    if(configRefreshPromise) return configRefreshPromise;
    configRefreshPromise = loadConfigOnce(options).catch(e => {
        console.error('[canvas] API settings refresh pipeline failed', e);
        return false;
    }).finally(() => { configRefreshPromise = null; });
    return configRefreshPromise;
}

function stableCanvasTarget(kind, providerId, model, resourceName=''){
    const connections = Array.isArray(aiResourceIndex?.connections) ? aiResourceIndex.connections : [];
    const models = Array.isArray(aiResourceIndex?.models) ? aiResourceIndex.models : [];
    const resources = Array.isArray(aiResourceIndex?.resources) ? aiResourceIndex.resources : [];
    const connection = connections.find(item => item.enabled !== false && (item.id === providerId || item.runtime_id === providerId || item.settings?.runtime_id === providerId));
    const targetModel = models.find(item => item.enabled !== false && item.kind === kind && (!connection || item.connection_id === connection.id) && (item.upstream_model === model || item.alias === model));
    const targetResource = resourceName ? resources.find(item => {
        if(item.enabled === false || (connection && item.connection_id !== connection.id)) return false;
        const settings = item.settings && typeof item.settings === 'object' ? item.settings : {};
        return item.id === resourceName || item.name === resourceName
            || settings.app_id === resourceName || settings.webappId === resourceName || settings.appId === resourceName
            || settings.workflow_name === resourceName || settings.workflowName === resourceName;
    }) : null;
    return {connection_id: targetModel?.connection_id || targetResource?.connection_id || connection?.id || '', model_id: targetModel?.id || '', resource_id: targetResource?.id || ''};
}
async function refreshSmartConfigFromSettings({invalidateParameterSchemas=false}={}){
    await loadConfig({invalidateParameterSchemas});
    renderDynamicParams();
    const node = selectedNode();
    if(node?.type === 'smart-prompt') {
        applySettingsToNode(node);
        render();
    }
}
