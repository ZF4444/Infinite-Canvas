const params = new URLSearchParams(location.search);
let canvasId = params.get('id') || '';
const shell = document.getElementById('shell');
const canvasManagerBtn = document.getElementById('canvasManagerBtn');
const bootLoadingOverlay = document.getElementById('bootLoadingOverlay');
const bootLoadingRingProgress = document.getElementById('bootLoadingRingProgress');
const bootLoadingPercent = document.getElementById('bootLoadingPercent');
const bootLoadingSub = document.getElementById('bootLoadingSub');
const world = document.getElementById('world');
const composer = document.getElementById('composer');
const nodeShortcutOverlay = document.getElementById('nodeShortcutOverlay');
const nodeContextMenu = document.getElementById('nodeContextMenu');
const createMenu = document.getElementById('createMenu');
const portDropMenu = document.getElementById('portDropMenu');
const promptInput = document.getElementById('promptInput');
const mentionPicker = document.getElementById('mentionPicker');
const mentionPreview = document.getElementById('mentionPreview');
const engineSelect = document.getElementById('engineSelect');
const composerHeadParams = document.getElementById('composerHeadParams');
const dynamicParams = document.getElementById('dynamicParams');
const runBtn = document.getElementById('runBtn');
const cascadeRunBtn = document.getElementById('cascadeRunBtn');
const promptComposer = document.getElementById('promptComposer');
const promptTaskSelect = document.getElementById('promptTaskSelect');
const promptComposerParams = document.getElementById('promptComposerParams');
const promptComposerThumbs = document.getElementById('promptComposerThumbs');
const promptComposerInputPreview = document.getElementById('promptComposerInputPreview');
const promptComposerInstructionRow = document.getElementById('promptComposerInstructionRow');
const promptComposerInstruction = document.getElementById('promptComposerInstruction');
const promptComposerRunBtn = document.getElementById('promptComposerRunBtn');
const fileInput = document.getElementById('fileInput');
const inputThumbsRow = document.getElementById('inputThumbsRow');
const inputPromptPreview = document.getElementById('inputPromptPreview');
const minimap = document.getElementById('minimap');
const minimapContent = document.getElementById('minimapContent');
const imageEditModal = document.getElementById('imageEditModal');
const canvasLogModal = document.getElementById('canvasLogModal');
const canvasLogList = document.getElementById('canvasLogList');
const canvasShortcutModal = document.getElementById('canvasShortcutModal');
const canvasWorkflowToggle = document.getElementById('canvasWorkflowToggle');
const canvasUsageToggle = document.getElementById('canvasUsageToggle');
const canvasUsagePanel = document.getElementById('canvasUsagePanel');
const canvasUsageClose = document.getElementById('canvasUsageClose');
const canvasUsageDetails = document.getElementById('canvasUsageDetails');
const canvasWorkflowTransferModal = document.getElementById('canvasWorkflowTransferModal');
const canvasWorkflowTransferSub = document.getElementById('canvasWorkflowTransferSub');
const canvasWorkflowExportMeta = document.getElementById('canvasWorkflowExportMeta');
const canvasWorkflowImportInput = document.getElementById('canvasWorkflowImportInput');
const canvasWorkflowImportDropZone = document.getElementById('canvasWorkflowImportDropZone');
const selectionBox = document.getElementById('selectionBox');
const selectionActions = document.getElementById('selectionActions');
const assetToggle = document.getElementById('assetToggle');
const assetPanel = document.getElementById('assetPanel');
const assetCloseBtn = document.getElementById('assetCloseBtn');
const assetLibrarySelect = document.getElementById('assetLibrarySelect');
const assetCategorySelect = document.getElementById('assetCategorySelect');
const assetGrid = document.getElementById('assetGrid');
const assetDropZone = document.getElementById('assetDropZone');
const workflowEmpty = document.getElementById('workflowEmpty');
const assetImageControls = document.getElementById('assetImageControls');
const assetDialogBackdrop = document.getElementById('assetDialogBackdrop');
const assetDialogTitle = document.getElementById('assetDialogTitle');
const assetDialogInput = document.getElementById('assetDialogInput');
const assetDialogCancel = document.getElementById('assetDialogCancel');
const assetDialogOk = document.getElementById('assetDialogOk');
const nodeAssetSaveModal = document.getElementById('nodeAssetSaveModal');
const nodeAssetSaveClose = document.getElementById('nodeAssetSaveClose');
const nodeAssetSaveLibraries = document.getElementById('nodeAssetSaveLibraries');
const nodeAssetSaveNewFolder = document.getElementById('nodeAssetSaveNewFolder');
const nodeAssetSaveFolders = document.getElementById('nodeAssetSaveFolders');
const nodeAssetSaveName = document.getElementById('nodeAssetSaveName');
const nodeAssetSaveCancel = document.getElementById('nodeAssetSaveCancel');
const nodeAssetSaveConfirm = document.getElementById('nodeAssetSaveConfirm');
const assetHoverPreview = document.getElementById('assetHoverPreview');
const promptPresetPanel = document.getElementById('promptPresetPanel');
const promptPresetClose = document.getElementById('promptPresetClose');
const promptPresetStatus = document.getElementById('promptPresetStatus');
const promptPresetSelect = document.getElementById('promptPresetSelect');
const promptPresetName = document.getElementById('promptPresetName');
const promptPresetText = document.getElementById('promptPresetText');
const promptPresetApply = document.getElementById('promptPresetApply');
const promptPresetDelete = document.getElementById('promptPresetDelete');
const promptPresetNew = document.getElementById('promptPresetNew');
const promptPresetSave = document.getElementById('promptPresetSave');
const promptTemplatePanel = document.getElementById('promptTemplatePanel');
const promptTemplateClose = document.getElementById('promptTemplateClose');
const promptTemplateSearch = document.getElementById('promptTemplateSearch');
const promptTemplateLibrarySelect = document.getElementById('promptTemplateLibrarySelect');
const promptTemplateCats = document.getElementById('promptTemplateCats');
const promptTemplateBody = document.getElementById('promptTemplateBody');
const composerTemplateBtn = document.getElementById('composerTemplateBtn');
function showBootLoadingOverlay(){
    if(shell) shell.classList.add('boot-loading');
    if(!bootLoadingOverlay) return;
    bootLoadingOverlay.classList.remove('is-hidden', 'is-fading');
    bootLoadingOverlay.setAttribute('aria-busy', 'true');
    updateBootLoadingProgress(0, 0, '正在准备画布');
}
function updateBootLoadingProgress(completed=0, total=0, label=''){
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeCompleted = Math.max(0, Math.min(safeTotal, Number(completed) || 0));
    const percent = safeTotal ? Math.round(safeCompleted / safeTotal * 100) : 0;
    updateBootLoadingPercent(percent, label);
}
function updateBootLoadingPercent(percent=0, label=''){
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if(bootLoadingRingProgress) bootLoadingRingProgress.style.strokeDashoffset = `${263.9 * (1 - safePercent / 100)}`;
    if(bootLoadingPercent) bootLoadingPercent.textContent = `${safePercent}%`;
    if(bootLoadingSub && label) bootLoadingSub.textContent = label;
}
function hideBootLoadingOverlay(onHidden){
    if(!bootLoadingOverlay){
        if(typeof onHidden === 'function') onHidden();
        return;
    }
    bootLoadingOverlay.classList.add('is-fading');
    bootLoadingOverlay.setAttribute('aria-busy', 'false');
    const finalize = () => {
        bootLoadingOverlay.removeEventListener('transitionend', finalize);
        bootLoadingOverlay.classList.add('is-hidden');
        bootLoadingOverlay.classList.remove('is-fading');
        if(shell) shell.classList.remove('boot-loading');
        if(typeof onHidden === 'function') onHidden();
    };
    bootLoadingOverlay.addEventListener('transitionend', finalize, {once:true});
}
function isBootLoadingActive(){
    return Boolean(shell?.classList.contains('boot-loading') && bootLoadingOverlay && !bootLoadingOverlay.classList.contains('is-hidden'));
}
function nextFrame(){
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}
function visibleWorldBounds(){
    return {
        left:(-viewport.x) / viewport.scale,
        top:(-viewport.y) / viewport.scale,
        right:(-viewport.x + shell.clientWidth) / viewport.scale,
        bottom:(-viewport.y + shell.clientHeight) / viewport.scale
    };
}
function rectIntersects(a, b){
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function bootVisibleNodeIds(){
    if(!shell || !nodes.length) return [];
    const view = visibleWorldBounds();
    return nodes.filter(node => {
        const rect = nodeRect(node);
        return rectIntersects(
            {left:rect.x, top:rect.y, right:rect.x + rect.width, bottom:rect.y + rect.height},
            view
        );
    }).map(node => node.id);
}
function mediaReadyPromise(el){
    if(!el) return Promise.resolve();
    if(el.tagName?.toLowerCase() === 'img'){
        if(el.complete && (el.naturalWidth > 0 || !el.currentSrc)) return Promise.resolve();
        return new Promise(resolve => {
            const done = () => {
                el.removeEventListener('load', done);
                el.removeEventListener('error', done);
                resolve();
            };
            el.addEventListener('load', done, {once:true});
            el.addEventListener('error', done, {once:true});
        });
    }
    if(el.tagName?.toLowerCase() === 'video'){
        if((el.readyState || 0) >= 1) return Promise.resolve();
        return new Promise(resolve => {
            const done = () => {
                el.removeEventListener('loadedmetadata', done);
                el.removeEventListener('error', done);
                resolve();
            };
            el.addEventListener('loadedmetadata', done, {once:true});
            el.addEventListener('error', done, {once:true});
        });
    }
    return Promise.resolve();
}
async function waitForVisibleBootMedia(timeoutMs=2500, startPercent=0, endPercent=100){
    const updateMediaProgress = (completed, total, label) => {
        const ratio = total ? Math.max(0, Math.min(1, completed / total)) : 1;
        updateBootLoadingPercent(startPercent + (endPercent - startPercent) * ratio, label);
    };
    await nextFrame();
    const idSet = new Set(bootVisibleNodeIds());
    if(!idSet.size){
        updateMediaProgress(1, 1, '画布已准备就绪');
        return;
    }
    const media = [...world.querySelectorAll('.image-node img, .image-node video')].filter(el => {
        const nodeEl = el.closest('.image-node');
        return nodeEl?.dataset?.id && idSet.has(nodeEl.dataset.id);
    });
    const uniqueMedia = [...new Map(media.map(el => [
        `${el.tagName}:${el.currentSrc || el.getAttribute('src') || el.dataset?.originalSrc || ''}`,
        el
    ])).values()];
    const total = uniqueMedia.length;
    if(!total){
        updateMediaProgress(1, 1, '画布已准备就绪');
        return;
    }
    let completed = 0;
    updateMediaProgress(completed, total, `正在加载资源 ${completed} / ${total}`);
    await nextFrame();
    let progressQueue = Promise.resolve();
    await Promise.all(uniqueMedia.map(async el => {
        await Promise.race([
            mediaReadyPromise(el),
            new Promise(resolve => setTimeout(resolve, timeoutMs))
        ]);
        progressQueue = progressQueue.then(async () => {
            completed += 1;
            updateMediaProgress(completed, total, `正在加载资源 ${completed} / ${total}`);
            await nextFrame();
        });
        await progressQueue;
    }));
    updateMediaProgress(total, total, '画布已准备就绪');
}
let minimapViewport = document.getElementById('minimapViewport');
// M22 拆分：canvas / nodes / selectedId / selectedIds / selectedImage / viewport
// 核心状态变量已迁移到 frontend/src/canvas/state.js（经典 <script>，
// 排在最前面加载，非 ES module，原因同 M1-M21）。
let dragState = null;
let loopInsertPreview = null;
let selectionState = null;
let selectionJustFinished = false;
let thumbDragState = null;
let uploadTargetId = '';
let pendingGroupUploadPoint = null;
let mentionRange = null;
let panState = null;
let spacePanActive = false;
let didPan = false;
let rightMouseDownPoint = null;
let rightMouseDownViewport = null;
let portDragState = null;
let saveTimer = null;
let suppressAutoSave = false;
let deferredAutoSaveNeeded = false;
let suppressAutoSaveReleaseTimer = null;
let viewportInteractionReleaseTimer = null;
let minimapRenderQueued = false;
let connectionLayerRefreshQueued = false;
let viewportInteractionActive = false;
let pendingMinimapRefreshAfterInteraction = false;
let lastConnectionLayerRefreshAt = 0;
let aiConnections = [];
let aiResourceIndex = {connections:[], models:[], resources:[]};
let comfyWorkflows = [];
let comfyInstanceCount = 1;
let assetLibrary = {categories:[]};
let assetLibraryOpen = false;
let assetTab = 'image';
let activeAssetCategoryId = '';
let activeAssetLibraryId = '';
let mentionSource = 'input';
let mentionAssetCategoryId = '';
let assetLibraryUpdatedAt = 0;
let assetLibraryRefreshTimer = null;
let nodeAssetSaveState = {open:false, fileId:'', name:'', items:[], useOriginalNames:false, libraryId:'', categoryId:''};
const PROMPT_PRESETS_KEY = 'smart_canvas_prompt_presets_v1';
const PROMPT_TEMPLATE_GROUPS_KEY = 'smart_canvas_prompt_template_groups_v1';
const PROMPT_TEMPLATE_OVERRIDES_KEY = 'smart_canvas_prompt_template_overrides_v1';
let promptPresets = [];
let builtinPromptTemplates = [];
let promptLibraries = [];
let activePromptLibraryId = 'system';
let promptTemplateGroups = [];
let promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};
let promptTemplateCategory = 'all';
let promptTemplateSelectedId = '';
let promptTemplateEditing = false;
let promptTemplateGroupEditMode = false;
let promptPresetDeleteArmed = false;
let createMenuPoint = {x:0, y:0};
let nodeClipboard = null;
let imageClickTimer = null;
let suppressImageClickUntil = 0;
let candidatePanelNodeId = '';
let candidatePanelIndex = 0;
let candidatePanelAttentionNodeId = '';
let expandedCandidateNodeIds = new Set();
let suppressComposerForCandidateNodeId = '';
let lastMouseWorld = null;
let lastConfigRefreshAt = 0;
let smartMinimapState = null;
let smartMinimapDrag = false;
let zoomPreviewState = null;
let runTimerInterval = null;
let smartCascadeRunning = false;
let smartCascadeActiveLoopId = '';
let smartCascadeStopRequested = false;
let smartCascadeSilentSelection = false;
let smartCascadeRunPath = null;
const smartCascadeRuns = new Map();
let smartLoopContext = null;
let runBtnCooldownToken = 0;
let smartRunStateToken = 0;
let reopenVideoControlAfterRender = '';
const activeSmartTaskPolls = new Map();
const activeRunningHubTaskPolls = new Map();
const smartNodeRunTokens = new Map();
let smartRhRandomValues = {};
let lastImagePasteAt = 0;
let lastNodePasteAt = 0;
let lastNodeCopyAt = 0;
let lastClipImageSig = null;
let suppressNodeClickUntil = 0;
let textSelectionGuard = null;
const UNDO_LIMIT = 40;
const undoStack = [];
let undoSuppressed = false;
let pendingUndoSnapshot = null;
function activeSmartCascadeCount(){ return smartCascadeRuns.size; }
function smartCascadeRunForLoop(loopId){ return loopId ? smartCascadeRuns.get(loopId) || null : null; }
function smartCascadeIsLoopRunning(loopId){ return Boolean(smartCascadeRunForLoop(loopId)); }
function syncSmartCascadeLegacyState(preferredLoopId=''){
    const activeIds = [...smartCascadeRuns.keys()];
    smartCascadeRunning = activeIds.length > 0;
    smartCascadeActiveLoopId = preferredLoopId && smartCascadeRuns.has(preferredLoopId)
        ? preferredLoopId
        : (activeIds[0] || '');
    const activeRun = smartCascadeActiveLoopId ? smartCascadeRuns.get(smartCascadeActiveLoopId) : null;
    smartCascadeStopRequested = Boolean(activeRun?.stopRequested);
    smartCascadeRunPath = activeRun?.runPath || null;
}
function smartCascadeAnyRunning(){ return smartCascadeRunning || activeSmartCascadeCount() > 0; }
function syncPrimaryRunButton(node=selectedNode()){
    if(!runBtn) return;
    // The primary run control belongs to the selected node. A Comfy task on a
    // different node must not leave the current node's AI run button locked.
    if(smartCascadeAnyRunning()){
        runBtn.disabled = true;
        return;
    }
    runBtn.disabled = Boolean(node?.running || node?.pending || node?.queued);
}
function smartCascadeEdgeState(edgeKey){
    for(const run of smartCascadeRuns.values()){
        const state = run?.runPath?.states?.[edgeKey];
        if(state) return state;
    }
    return smartCascadeRunPath?.states?.[edgeKey] || '';
}
function smartCascadePathForCtx(ctx=null){
    return ctx?.runState?.runPath || ctx?.runPath || smartCascadeRunPath;
}
function capturePendingUndo(){ pendingUndoSnapshot = snapshotForUndo(); }
function commitPendingUndo(){
    if(pendingUndoSnapshot){
        undoStack.push(pendingUndoSnapshot);
        if(undoStack.length > UNDO_LIMIT) undoStack.shift();
        pendingUndoSnapshot = null;
    }
}
function discardPendingUndo(){ pendingUndoSnapshot = null; }
function snapshotForUndo(){
    return {
        nodes: JSON.parse(JSON.stringify(nodes)),
        connections: JSON.parse(JSON.stringify(canvas?.connections || [])),
        selectedId,
        selectedIds: selectedIds.slice(),
        selectedImage: {...selectedImage}
    };
}
function pushUndo(){
    if(undoSuppressed) return;
    if(!canvas) return;
    undoStack.push(snapshotForUndo());
    if(undoStack.length > UNDO_LIMIT) undoStack.shift();
}
function performUndo(){
    if(!undoStack.length){ toast(tr('smart.toastNoUndo')); return; }
    const snap = undoStack.pop();
    undoSuppressed = true;
    nodes = snap.nodes;
    if(canvas) canvas.connections = snap.connections;
    selectedId = snap.selectedId;
    selectedIds = snap.selectedIds;
    selectedImage = snap.selectedImage;
    candidatePanelNodeId = '';
    candidatePanelIndex = 0;
    suppressComposerForCandidateNodeId = '';
    activeComposerSubject = null;
    lastComposerNodeId = '';
    render();
    scheduleSave();
    undoSuppressed = false;
    toast(tr('smart.toastUndone'));
}
let comfyWorkflowCache = {};
let cropState = null;
let cropDrag = null;
let imageEditMode = 'crop';
let imageEditModeTouched = false;
let editDrawState = null;
let editTextItems = [];
let editTextSelectedId = '';
let editTextDrag = null;
let editTextDirty = false;
let editTextInlineEditor = null;
let editDrawUndoStack = [];
let editDrawRedoStack = [];
const EDIT_DRAW_HISTORY_MAX = 40;
let brushTool = 'free';
let brushLabelCounter = 1;
let gridCustomMode = false;
let gridCustomLines = [];
let gridCustomOrientation = 'h';
let gridCustomHistory = [];
let gridCustomDrag = null;
let gridOperationMode = 'split';
let gridJoinLayout = null;
let gridJoinDrag = null;
let gridJoinImageCache = new Map();
let gridJoinOutputSize = 2048;
let imageEditZoom = 1.0;
let imageEditBaseW = 0;
let imageEditBaseH = 0;
let previewZoom = 1.0;
let previewPan = {x:0, y:0};
let gridJoinZoom = 1.0;
let gridJoinPan = {x:0, y:0};
let previewPanDrag = null;
let previewCompareDrag = false;
let previewComparePos = 50;
let imageEditPanDrag = null;
let previewNavState = {nodeId:'', index:0, count:0, source:'images'};
const PANORAMA_RATIO_PRESETS = {
    '1:1':{w:1, h:1}, '2:3':{w:2, h:3}, '3:2':{w:3, h:2},
    '3:4':{w:3, h:4}, '4:3':{w:4, h:3}, '9:16':{w:9, h:16},
    '16:9':{w:16, h:9}, '21:9':{w:21, h:9}, '9:21':{w:9, h:21}
};
let panoramaState = {
    enabled:false,
    ratio:'16:9',
    customW:16,
    customH:9,
    fov:75,
    yaw:0,
    pitch:0,
    drag:null,
    three:null,
    renderer:null,
    scene:null,
    camera:null,
    sphere:null,
    texture:null,
    threeLoadPromise:null,
    image:null,
    ctx:null,
    animationId:0,
    loadedSrc:'',
    loadToken:0
};
window.__canvasPanoramaState = panoramaState;
let settings = {
    engine:'api',
    apiKind:'image',
    connection_id:'',
    model_id:'',
    resource_id:'',
    videoConnectionId:'',
    videoModelId:'',
    videoResourceId:'',
    ratio:'1:1',
    resolution:'1k',
    customRatio:'',
    customRatioWidth:'',
    customRatioHeight:'',
    customSize:'',
    customWidth:'',
    customHeight:'',
    quality:'auto',
    count:1,
    videoDuration:5,
    videoAspect:'16:9',
    videoResolution:'',
    videoGenerateAudio:false,
    videoMultimodal:true,
    videoUseFrameRoles:false,
    msgenModel:'zimage',
    msCustomModel:'',
    msRatio:'1:1',
    msResolution:'1k',
    msCustomRatio:'',
    msCustomRatioWidth:'',
    msCustomRatioHeight:'',
    msCustomSize:'',
    msCustomWidth:'',
    msCustomHeight:'',
    comfyWorkflow:'',
    comfyParams:{},
    rhConfigKey:'',
    rhInstanceType:'',
    rhParams:{},
    rhRandomActive:{},
    promptH:124
};
const MS_GEN_MODELS = {
    zimage: { label:'ZImage', modelId:'Tongyi-MAI/Z-Image-Turbo', supportsImage:false, endpoint:'/generate' },
    qwen_edit: { label:'Qwen Edit', modelId:'Qwen/Qwen-Image-Edit-2511', supportsImage:true, endpoint:'/api/angle/generate' },
    klein_edit: { label:'Klein', modelId:'black-forest-labs/FLUX.2-klein-9B', supportsImage:true, endpoint:'/api/ms/generate' },
    custom: { label:tr('smart.custom') || '自定义', modelId:'', acceptsImage:true, endpoint:'/api/ms/generate' }
};
const SIZE_MAP = {
    '1:1': {'1k':'1024x1024','2k':'2048x2048','4k':'4096x4096'},
    '3:2': {'1k':'1536x1024','2k':'2048x1360','4k':'3520x2336'},
    '2:3': {'1k':'1024x1536','2k':'1360x2048','4k':'2336x3520'},
    '4:3': {'1k':'1024x768','2k':'2048x1536','4k':'3312x2480'},
    '3:4': {'1k':'768x1024','2k':'1536x2048','4k':'2480x3312'},
    '16:9': {'1k':'1536x864','2k':'2048x1152','4k':'3840x2160'},
    '9:16': {'1k':'864x1536','2k':'1152x2048','4k':'2160x3840'},
    '21:9': {'1k':'1536x656','2k':'2048x880','4k':'3840x1648'},
    '9:21': {'1k':'656x1536','2k':'880x2048','4k':'1648x3840'}
};
const RES_LONG_SIDE = { '1k':1024, '2k':2048, '4k':3840 };
const RES_PIXEL_LIMIT = { '1k':2359296, '2k':4194304, '4k':8294400 };
// M1 拆分：tr/trf/refreshIcons/uid/escapeHtml/escapeAttr 已迁移到
// frontend/src/canvas/utils.js（经典 <script>，非 ES module，
// 顶层声明仍挂到 window，构建产物里通过 <script src> 排在本文件之前
// 加载，此处调用方式不变，无需 import）。
function cloneSmartSettings(source=settings){
    try {
        const cloned = JSON.parse(JSON.stringify(source || {}));
        if(cloned.engine === 'comfy'){
            delete cloned.comfyMode;
            delete cloned.width;
            delete cloned.height;
            delete cloned.enhanceStrength;
            delete cloned.enhanceUpscale;
            delete cloned.enhanceUpscaleRes;
            delete cloned.editUpscale;
            delete cloned.editUpscaleRes;
        }
        return normalizeStoredImageRatios(cloned);
    } catch(e) {
        return normalizeStoredImageRatios({...((source || {}))});
    }
}
function normalizeStoredImageRatios(target){
    const legacy = {square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4', landscape43:'4:3', story:'9:16', wide:'16:9', ultrawide:'21:9', ultratall:'9:21'};
    for(const key of ['ratio','ratioMatched','msRatio','msRatioMatched']){
        if(legacy[target?.[key]]) target[key] = legacy[target[key]];
    }
    return target;
}
function settingsForStorage(source=settings){
    const clean = cloneSmartSettings(source);
    // Canonical canvas settings are identified by stable Connection/Model/
    // Resource IDs. Legacy provider fields remain readable for unmigrated
    // historical nodes, but must never be persisted for new targets.
    const hasStableTarget = ['connection_id', 'model_id', 'resource_id', 'videoConnectionId', 'videoModelId', 'videoResourceId']
        .some(key => String(clean?.[key] || '').trim());
    if(hasStableTarget){
        delete clean.provider_id;
        delete clean.provider;
        delete clean.model;
        delete clean.videoProvider;
        delete clean.videoModel;
    }
    return clean;
}
function isApiLikeEngine(engine){
    return ['api', 'volcengine'].includes(String(engine || '').toLowerCase());
}
function mediaItemForStorage(item){
    if(!item || typeof item !== 'object') return item;
    const clean = {...item};
    delete clean.cloudUrl;
    delete clean.uploadedUrl;
    delete clean.originalRemoteUrl;
    delete clean.tempCloudUrl;
    delete clean.runInputRefs;
    if(clean.runSettings) clean.runSettings = settingsForStorage(clean.runSettings);
    return clean;
}
function stripNodeScaleFieldsForStorage(node){
    if(!isSmartImageNode(node)) return;
    delete node.scale;
    const keepPendingSize = Number(node.pending) > 0 || Boolean(node.queued || (Array.isArray(node.pendingTasks) && node.pendingTasks.length));
    if(!keepPendingSize){
        delete node.w;
        delete node.h;
    }
}
function canvasForStorage(){
    const clean = JSON.parse(JSON.stringify(canvas || {}));
    clean.settings = settingsForStorage(canvasDefaultSmartSettings || initialSmartSettings);
    (clean.nodes || []).forEach(node => {
        if(Array.isArray(node.images)) node.images = node.images.map(mediaItemForStorage);
        if(Array.isArray(node.candidateImages)) node.candidateImages = node.candidateImages.map(mediaItemForStorage);
        if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
        stripNodeScaleFieldsForStorage(node);
        delete node.pendingCandidatePool;
        delete node._rerunPreviousImages;
    });
    return clean;
}
// M15 拆分：工作流导入导出全部逻辑（apiErrorMessage 到
// importCanvasWorkflowFile，约200行）已迁移到
// frontend/src/canvas/workflow-transfer.js（经典 <script>，非 ES
// module，原因同 M1-M14）。
const RECENT_SMART_SETTINGS_KEY = 'smart_canvas_recent_run_settings_v1';
const initialSmartSettings = cloneSmartSettings(settings);
let canvasDefaultSmartSettings = cloneSmartSettings(settings);
let recentSmartSettingsByMode = {};
function smartSettingsModeKey(source=settings){
    const engine = ['api','volcengine','comfy','runninghub'].includes(source?.engine) ? source.engine : 'api';
    if(engine === 'api') return `api:${source?.apiKind === 'video' ? 'video' : 'image'}`;
    if(engine === 'volcengine') return `api:${source?.apiKind === 'video' ? 'video' : 'image'}`;
    if(engine === 'comfy') return 'comfy';
    if(engine === 'runninghub') return 'runninghub';
    return 'api';
}
function loadRecentSmartSettings(){
    try {
        const data = JSON.parse(localStorage.getItem(RECENT_SMART_SETTINGS_KEY) || '{}');
        recentSmartSettingsByMode = data && typeof data === 'object' ? data : {};
    } catch(e) {
        recentSmartSettingsByMode = {};
    }
}
function saveRecentSmartSettings(){
    localStorage.setItem(RECENT_SMART_SETTINGS_KEY, JSON.stringify(recentSmartSettingsByMode));
}
function recentSmartSettingsForMode(modeKey=''){
    const key = modeKey || recentSmartSettingsByMode.__lastKey || smartSettingsModeKey(settings);
    const saved = recentSmartSettingsByMode[key];
    return saved && typeof saved === 'object' ? cloneSmartSettings(saved) : {};
}
function rememberRecentSmartSettings(source=settings, node=null){
    const clean = stripOutpaintDisplaySettings(settingsForStorage(source), node);
    sanitizeSmartApiSelection(clean);
    if(clean.outpaintResolutionLocked === true && clean.resolution === 'custom'){
        clean.resolution = '1k';
        clean.ratio = clean.ratio || '1:1';
        clean.customWidth = '';
        clean.customHeight = '';
        clean.customSize = '';
    }
    delete clean.outpaintResolutionLocked;
    const key = smartSettingsModeKey(clean);
    recentSmartSettingsByMode[key] = settingsForStorage(clean);
    recentSmartSettingsByMode.__lastKey = key;
    saveRecentSmartSettings();
}
function applyRecentSmartSettingsForCurrentMode(){
    const requestedEngine = settings.engine === 'volcengine' ? 'api' : (['api','comfy','runninghub'].includes(settings.engine) ? settings.engine : 'api');
    const requestedApiKind = settings.apiKind === 'video' ? 'video' : 'image';
    const key = smartSettingsModeKey(settings);
    const saved = recentSmartSettingsForMode(key);
    if(!Object.keys(saved).length){
        settings.engine = requestedEngine;
        if(isApiLikeEngine(requestedEngine)) settings.apiKind = requestedApiKind;
        sanitizeSmartApiSelection(settings);
        return;
    }
    settings = {...settings, ...saved, engine:requestedEngine};
    if(isApiLikeEngine(requestedEngine)) settings.apiKind = requestedApiKind;
    sanitizeSmartApiSelection(settings);
}
function clearVolcengineSelectionOutsideVolcengine(target=settings){
    if(!target || typeof target !== 'object') return target;
    if(target.engine === 'volcengine') target.engine = 'api';
    return target;
}
function isSmartImageNode(node){
    return Boolean(node && (
        node.type === 'smart-image' ||
        node.type === 'smart-asset-image' ||
        ['image', 'video', 'workflow'].includes(node.genKind) ||
        !node.type
    ));
}
function genKindLabel(node){
    if(node?.genKind === 'video') return '视频生成';
    if(node?.genKind === 'workflow') return '工作流生成';
    return '图片生成';
}
function genKindIcon(node){
    if(node?.genKind === 'video') return 'play-square';
    if(node?.genKind === 'workflow') return 'workflow';
    return 'image';
}
/* 各类生成节点允许的引擎：
   图片生成 / 视频生成 → AI生成(api)、ComfyUI 工作流(comfy) 与 RH 应用(runninghub)；
   工作流生成 → ComfyUI 工作流(comfy) 与 RH 应用(runninghub)。
   返回 null 表示不限制（非定型节点，保留全部引擎）。 */
function allowedEnginesForNode(node){
    if(node?.genKind === 'image') return ['api','comfy','runninghub'];
    if(node?.genKind === 'video') return ['api','comfy','runninghub'];
    if(node?.genKind === 'workflow') return ['comfy','runninghub'];
    return null;
}
/* 根据生成节点类型返回默认引擎 */
function defaultEngineForGenKind(kind){
    if(kind === 'workflow') return 'comfy';
    return 'api';
}
/* 统一创建"图片生成/视频生成/工作流生成"三类生成节点，供左键创建菜单与拉线菜单共用 */
function createGenerationNodeByKind(kind, point, options={}){
    const node = createImageNodeAt(point, [], options);
    if(kind === 'video'){
        node.genKind = 'video';
        // 视频生成节点创建后默认使用「AI生成」(api)，不继承最近使用的工作流等设置
        node.runSettings = {engine:'api', apiKind:'video'};
    } else if(kind === 'workflow'){
        node.genKind = 'workflow';
        node.runSettings = {engine:'comfy', comfyWorkflow:'', comfyParams:{}};
    } else {
        node.genKind = 'image';
        // 图片生成节点创建后默认使用「AI生成」(api)，不继承最近使用的工作流等设置
        node.runSettings = {engine:'api', apiKind:'image'};
    }
    // createImageNodeAt 内部会在 genKind/runSettings 赋值之前先渲染一次，
    // 此时节点卡片（图标/标题/hint）和 composer（toggle/engine下拉）都还读不到最新的 genKind，
    // 需要在赋值后强制刷新一次，保证创建瞬间显示的状态就是正确的。
    render();
    // createImageNodeAt 已经保存过一次，但此时还没有 genKind/runSettings；
    // 类型赋值后必须再次保存，否则刷新页面后视频节点会退化成图片节点。
    scheduleSave();
    if(options.select !== false && selectedId === node.id){
        lastComposerNodeId = '';
        updateComposer();
    }
    return node;
}
function isSmartAssetImageNode(node){
    return Boolean(node && (node.type === 'smart-asset-image' || node.assetOnly === true));
}
function isUploadedImageOnlyNode(node){
    if(!isSmartImageNode(node) || isHistoryGroupNode(node)) return false;
    if(isSmartAssetImageNode(node)) return true;
    const images = (node.images || []).filter(img => img?.url);
    if(!images.length || node.pending || node.running || node.queued) return false;
    if(node.runPrompt || node.runModelPrompt || node.sourceNodeId || node.runAt || node.runFinishedAt || node.runElapsedMs) return false;
    if((node.inputNodeIds || []).length) return false;
    if((node.runPromptRefs || []).length || (node.runInputRefs || []).length) return false;
    if(images.some(img => img?.generatedResult || img?.runPrompt || img?.runModelPrompt || img?.runSettings || img?.sourceNodeId || img?.runAt)) return false;
    return !(canvas?.connections || []).some(conn => conn.to === node.id && ['input', 'flow'].includes(conn.kind || 'flow'));
}
// M12 拆分：候选图池全部逻辑（normalizeGeneratedCandidateImage 到
// expandedCandidateGridHtml，约260行）已迁移到
// frontend/src/canvas/candidate-pool.js（经典 <script>，非 ES
// module，原因同 M1-M11）。
function isSmartGroupNode(node){
    return Boolean(node && node.type === 'smart-group');
}
function isHistoryGroupNode(node){
    return Boolean(isSmartImageNode(node) && (node.isHistoryGroup || node.historyFor));
}
function normalizeSmartImageMode(mode){
    return 'self';
}
function smartImageMode(node){
    return 'self';
}
function setSmartImageMode(node, mode){
    if(!isSmartImageNode(node)) return;
    delete node.imageMode;
}
function smartImageUsesWorkflowInput(node, ctx=smartLoopContext){
    return Boolean(isSmartImageNode(node) && ctx?.forceWorkflow);
}
// M3 拆分：normalizeLegacySmartNode 已迁移到
// frontend/src/canvas/node-model.js（经典 <script>，同上）。
function validOutpaintSize(node){
    const w = Math.round(Number(node?.outpaintSize?.width || 0));
    const h = Math.round(Number(node?.outpaintSize?.height || 0));
    return w > 0 && h > 0 ? {width:w, height:h} : null;
}
function parseSizePair(value){
    const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
    return match ? {width:Number(match[1]), height:Number(match[2])} : null;
}
function nearestFourKSizeFor(width, height){
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const ratio = w / h;
    let best = null;
    Object.entries(SIZE_MAP).forEach(([key, values]) => {
        const size = parseSizePair(values?.['4k']);
        if(!size) return;
        const score = Math.abs(Math.log(ratio / (size.width / size.height)));
        if(!best || score < best.score) best = {...size, key, score};
    });
    return best;
}
function exceedsFourKStandard(width, height){
    const standard = nearestFourKSizeFor(width, height);
    if(!standard) return false;
    return Number(width) > standard.width || Number(height) > standard.height;
}
function withOutpaintDisplaySettings(node, baseSettings){
    const size = validOutpaintSize(node);
    if(!size) return baseSettings;
    const engine = baseSettings?.engine === 'volcengine' ? 'api' : (['api','comfy','runninghub'].includes(baseSettings?.engine) ? baseSettings.engine : 'api');
    const next = {
        ...baseSettings,
        resolution:'custom',
        ratio:'',
        customWidth:size.width,
        customHeight:size.height,
        customSize:`${size.width}x${size.height}`,
        outpaintResolutionLocked:true
    };
    if(isApiLikeEngine(engine)) next.apiKind = 'image';
    if(engine === 'comfy'){
        next.width = size.width;
        next.height = size.height;
    }
    return next;
}
function stripOutpaintDisplaySettings(settingsObj, node=null){
    const clean = cloneSmartSettings(settingsObj);
    const size = validOutpaintSize(node);
    const matchesOutpaintSize = size && clean.resolution === 'custom' && String(clean.customSize || '') === `${size.width}x${size.height}`;
    if(matchesOutpaintSize){
        clean.resolution = '1k';
        clean.ratio = clean.ratio || '1:1';
        clean.customWidth = '';
        clean.customHeight = '';
        clean.customSize = '';
    }
    const matchesMsOutpaintSize = size && clean.msResolution === 'custom' && String(clean.msCustomSize || '') === `${size.width}x${size.height}`;
    if(matchesMsOutpaintSize){
        clean.msResolution = '1k';
        clean.msRatio = clean.msRatio || '1:1';
        clean.msCustomWidth = '';
        clean.msCustomHeight = '';
        clean.msCustomSize = '';
    }
    if(size && Number(clean.width) === size.width && Number(clean.height) === size.height){
        clean.width = 1024;
        clean.height = 1024;
    }
    delete clean.outpaintResolutionLocked;
    return clean;
}
function smartSettingsForNode(node){
    const nodeSettings = normalizeStoredImageRatios(stripOutpaintDisplaySettings(node?.runSettings || {}, node));
    const recentSettings = Object.keys(nodeSettings).length ? {} : recentSmartSettingsForMode();
    const base = {
        ...cloneSmartSettings(canvasDefaultSmartSettings || initialSmartSettings),
        ...recentSettings,
        ...nodeSettings
    };
    if(base.comfyWorkflow) base.comfyWorkflow = normalizeComfyWorkflowName(base.comfyWorkflow);
    // Keep settings mode aligned with the node type after reload or legacy
    // migration, so stale workflow settings cannot drive an API node panel.
    if(node?.genKind === 'video' && isApiLikeEngine(base.engine)) base.apiKind = 'video';
    if(node?.genKind === 'image' && isApiLikeEngine(base.engine)) base.apiKind = 'image';
    if(node?.genKind === 'workflow' && !['comfy', 'runninghub'].includes(base.engine)) base.engine = 'comfy';
    return withOutpaintDisplaySettings(node, base);
}
function activeSettingsSubject(){
    const active = activeComposerSubject?.id
        ? (nodes.find(n => n.id === activeComposerSubject.id) || activeComposerSubject)
        : selectedNode();
    if(!isSmartImageNode(active)) return null;
    return active;
}
function activeComposerNode(){
    if(!lastComposerNodeId) return null;
    const id = String(lastComposerNodeId).split(':')[0] || '';
    const node = nodes.find(n => n.id === id);
    return isSmartImageNode(node) ? node : null;
}
function persistActiveSmartSettings(){
    if(!composer?.classList?.contains('open')) return;
    const subject = activeComposerNode();
    if(!subject) return;
    subject.runSettings = settingsForStorage(settings);
    rememberRecentSmartSettings(settings, subject);
}
function promptPlainText(){
    return promptInput.innerText.replace(/\u00a0/g, ' ').trim();
}
function setPromptInputLocked(locked){
    promptInput.dataset.promptLocked = locked ? '1' : '0';
    promptInput.setAttribute('contenteditable', locked ? 'false' : 'true');
    promptInput.classList.toggle('prompt-input-locked', Boolean(locked));
    if(locked) closeMentionPicker();
}
function setPromptText(text){
    promptInput.textContent = text || '';
}
function clearPromptInput(options={}){
    if(options.preserveDraft){
        promptInput.dataset.preserveDraftOnce = '1';
        closeMentionPicker();
        return;
    }
    promptInput.textContent = '';
    closeMentionPicker();
    if(activeComposerSubject){
        activeComposerSubject.promptDraftHtml = '';
        activeComposerSubject.promptDraftText = '';
    }
}
function applyTheme(theme){
    const dark = theme === 'dark';
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('studio-theme-dark', dark);
    document.body?.classList.toggle('theme-dark', dark);
    document.body?.classList.toggle('studio-theme-dark', dark);
}
const uploadProgressEl = document.getElementById('uploadProgress');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressLabel = document.getElementById('uploadProgressLabel');
const uploadProgressPercent = document.getElementById('uploadProgressPercent');
let uploadProgressHideTimer = null;
let uploadProgressActiveCount = 0;
function showUploadProgress(fileCount=1){
    if(!uploadProgressEl) return;
    uploadProgressActiveCount += 1;
    clearTimeout(uploadProgressHideTimer);
    uploadProgressBar?.classList.remove('indeterminate');
    if(uploadProgressBar) uploadProgressBar.style.width = '0%';
    if(uploadProgressPercent) uploadProgressPercent.textContent = '0%';
    if(uploadProgressLabel) uploadProgressLabel.textContent = uploadProgressLabelText(fileCount);
    uploadProgressEl.classList.add('show');
}
function uploadProgressLabelText(fileCount){
    if(fileCount > 1){
        const template = tr('smart.uploadProgressMulti') || `正在上传 ${fileCount} 个素材…`;
        return template.replace('{total}', fileCount);
    }
    return tr('smart.uploadProgressSingle') || '正在上传素材…';
}
function updateUploadProgress(loaded, total, fileCount=1){
    if(!uploadProgressEl) return;
    if(!Number.isFinite(total) || total <= 0){
        uploadProgressBar?.classList.add('indeterminate');
        return;
    }
    uploadProgressBar?.classList.remove('indeterminate');
    const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
    if(uploadProgressBar) uploadProgressBar.style.width = `${pct}%`;
    if(uploadProgressPercent) uploadProgressPercent.textContent = `${pct}%`;
}
function hideUploadProgress(){
    if(!uploadProgressEl) return;
    uploadProgressActiveCount = Math.max(0, uploadProgressActiveCount - 1);
    if(uploadProgressActiveCount > 0) return;
    if(uploadProgressBar) uploadProgressBar.style.width = '100%';
    if(uploadProgressPercent) uploadProgressPercent.textContent = '100%';
    clearTimeout(uploadProgressHideTimer);
    uploadProgressHideTimer = setTimeout(() => {
        uploadProgressEl.classList.remove('show');
        uploadProgressBar?.classList.remove('indeterminate');
    }, 260);
}
function toast(text, options={}){
    const el = document.getElementById('toast');
    const value = String(text || '');
    const type = typeof options === 'string' ? options : (options.type || '');
    const persistent = Boolean(options.persistent)
        || ['warning', 'warn', 'error'].includes(type)
        || /失败|错误|异常|缺少|请输入|请选择|请先|没有|无法|不能|不支持|超时|未|fail|failed|error|need|required|invalid/i.test(value);
    clearTimeout(toast._timer);
    el.innerHTML = `<span class="toast-text">${escapeHtml(text)}</span><button class="toast-close" onclick="this.parentElement.classList.remove('show')">&times;</button>`;
    el.classList.toggle('toast-persistent', persistent);
    el.classList.add('show');
    if(!persistent){
        toast._timer = setTimeout(() => {
            el.classList.remove('show');
        }, Number(options.duration || 4000));
    }
}
function selectedNode(){ return nodes.find(n => n.id === selectedId) || null; }
function clearSelection(){
    savePromptDraftForCurrent();
    selectedId = '';
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    candidatePanelNodeId = '';
    candidatePanelIndex = 0;
    suppressComposerForCandidateNodeId = '';
}
function clearImageClickTimer(){
    if(imageClickTimer){
        clearTimeout(imageClickTimer);
        imageClickTimer = null;
    }
}
function syncSelectionUi(){
    world.querySelectorAll('.image-node').forEach(el => {
        const id = el.dataset.id || '';
        el.classList.toggle('selected', isNodeSelected(id));
        el.querySelectorAll('.thumb-item,.image-wrap').forEach(item => {
            const index = Number(item.dataset.imageIndex || 0);
            item.classList.toggle('image-selected', selectedImage.nodeId === id && selectedImage.index === index);
        });
    });
}
function isNodeSelected(id){
    return selectedId === id || selectedIds.includes(id);
}
function selectedNodeIds(){
    return selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
}
function isEditableTarget(target){
    const el = target || document.activeElement;
    return !!el?.closest?.('input, textarea, select, option, [contenteditable="true"], .prompt-node-control, .prompt-input');
}
// M3 拆分：safeScale / nodeScale / mediaNodeDefaultScale 已迁移到
// frontend/src/canvas/node-layout.js（经典 <script>，同上）。
// M3 拆分：createImageNodeAt 已迁移到 frontend/src/canvas/node-model.js；
// smartGroupLayoutSize 已迁移到 frontend/src/canvas/node-layout.js
// （均为经典 <script>，非 ES module，原因同 M1/M2）。
const MEDIA_NODE_DEFAULT_SCALE = 2;
const MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE = 1.6;
const MEDIA_GROUP_DEFAULT_SCALE = 0.8;
const MEDIA_GROUP_THUMB_BASE = 224;
const EMPTY_GENERATION_NODE_WIDTH = 316;
const EMPTY_GENERATION_NODE_HEIGHT = 194;
const SMART_GROUP_DEFAULT_WIDTH = 340;
const SMART_GROUP_DEFAULT_HEIGHT = 286;
const SMART_GROUP_LEGACY_HEIGHT = 220;
const SMART_GROUP_MIN_WIDTH = 150;
const SMART_GROUP_MIN_HEIGHT = 130;
function smartGroupMembers(node){
    if(!isSmartGroupNode(node)) return [];
    const ids = Array.isArray(node.items) ? node.items : [];
    const seen = new Set([node.id]);
    return ids.map(id => nodes.find(n => n.id === id)).filter(member => {
        if(!member || seen.has(member.id) || isSmartGroupNode(member)) return false;
        seen.add(member.id);
        return true;
    });
}
function smartGroupCompactMembers(node){
    return smartGroupMembers(node).filter(member => member?.type === 'smart-prompt' || member?.type === 'smart-loop');
}
function smartGroupContainingNode(nodeId){
    if(!nodeId) return null;
    return nodes.find(n => isSmartGroupNode(n) && Array.isArray(n.items) && n.items.includes(nodeId)) || null;
}
function isSmartGroupCompactMember(node){
    return Boolean(node && (node.type === 'smart-prompt' || node.type === 'smart-loop') && smartGroupContainingNode(node.id));
}
function rerouteSmartConnections(fromId, toId){
    if(canvas){
        canvas.connections = (canvas.connections || []).map(c => {
            let conn = c;
            if(c.from === fromId) conn = {...conn, from:toId};
            if(c.to === fromId) conn = {...conn, to:toId};
            return conn;
        }).filter((c, i, arr) => c.from !== c.to && arr.findIndex(x => x.from === c.from && x.to === c.to && (x.kind || 'flow') === (c.kind || 'flow')) === i);
    }
    nodes.forEach(n => {
        if(Array.isArray(n.inputNodeIds)) n.inputNodeIds = Array.from(new Set(n.inputNodeIds.map(id => id === fromId ? toId : id).filter(id => id !== n.id)));
    });
}
function absorbImageNodeIntoSmartGroup(group, child){
    const add = (child.images || []).map(img => stripImageGenerationMeta({...img}));
    if(!add.length) return false;
    group.images = [...(group.images || []), ...add];
    delete group.w;
    delete group.h;
    rerouteSmartConnections(child.id, group.id);
    nodes = nodes.filter(n => n.id !== child.id);
    nodes.forEach(g => { if(isSmartGroupNode(g) && Array.isArray(g.items)) g.items = g.items.filter(id => id !== child.id); });
    return true;
}
function addNodeToSmartGroup(group, child){
    if(!isSmartGroupNode(group) || !child || child.id === group.id) return false;
    const items = Array.isArray(group.items) ? group.items.slice() : [];
    if(isSmartGroupNode(child)){
        const mergedImages = (child.images || []).map(img => stripImageGenerationMeta({...img}));
        group.images = [...(group.images || []), ...mergedImages];
        if(mergedImages.length){ delete group.w; delete group.h; }
        const childMemberIds = smartGroupMembers(child).map(m => m.id).filter(id => id !== group.id && !items.includes(id));
        group.items = [...items, ...childMemberIds];
        rerouteSmartConnections(child.id, group.id);
        nodes = nodes.filter(n => n.id !== child.id);
        nodes.forEach(g => { if(isSmartGroupNode(g) && Array.isArray(g.items)) g.items = g.items.filter(id => id !== child.id); });
        return true;
    }
    if(isSmartImageNode(child)) return absorbImageNodeIntoSmartGroup(group, child);
    if(items.includes(child.id)) return false;
    group.items = [...items, child.id];
    return true;
}
function smartGroupImageRefs(group){
    if(!isSmartGroupNode(group)) return [];
    const refs = [];
    (group.images || []).forEach((img, index) => {
        const item = imageForDisplay(img);
        if(item?.url) refs.push({nodeId:group.id, index, source:img, item});
    });
    const members = smartGroupMembers(group)
        .filter(isSmartImageNode)
        .slice()
        .sort((a, b) => {
            const ra = nodeRect(a), rb = nodeRect(b);
            const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
            if(Math.abs(dy) > 24) return dy;
            return (Number(ra.x) || 0) - (Number(rb.x) || 0);
        });
    members.forEach(node => {
        (node.images || []).forEach((img, index) => {
            const item = imageForDisplay(img);
            if(item?.url) refs.push({nodeId:node.id, index, source:img, item});
        });
    });
    return refs;
}
// M3 拆分：smartGroupThumbLayout 已迁移到
// frontend/src/canvas/node-layout.js（经典 <script>，同上）。
const SMART_GROUP_ARRANGE_PADDING = 18;
const SMART_GROUP_ARRANGE_GAP = 16;
const SMART_GROUP_ARRANGE_HEADER = 44;
function arrangeSmartGroupMembers(group, options={}){
    if(!isSmartGroupNode(group)) return false;
    const hasThumbImages = smartGroupImageRefs(group).some(ref => ref.item?.url);
    if(hasThumbImages){
        const compactMembers = smartGroupCompactMembers(group);
        if(!options.skipUndo) pushUndo();
        const layout = smartGroupThumbLayout(group);
        if(!layout) return true;
        const refs = layout.refs || [];
        const thumb = Math.max(28, Math.round(Number(layout.thumb) || 96));
        const gap = 8;
        const cols = Math.max(1, Number(layout.cols) || 1);
        const gridW = cols * thumb + Math.max(0, cols - 1) * gap;
        const contentW = Math.max(0, Math.round(Number(layout.width) || SMART_GROUP_DEFAULT_WIDTH) - 32);
        const originX = (Number(group.x) || 0) + 16 + Math.max(0, Math.round((contentW - gridW) / 2));
        const originY = (Number(group.y) || 0) + 16 + 28;
        group.w = Math.max(SMART_GROUP_MIN_WIDTH, Math.round(Number(layout.width) || SMART_GROUP_DEFAULT_WIDTH));
        group.h = Math.max(SMART_GROUP_MIN_HEIGHT, Math.round(Number(layout.height) || SMART_GROUP_DEFAULT_HEIGHT));
        compactMembers.slice().sort((a, b) => {
            const ra = nodeRect(a), rb = nodeRect(b);
            const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
            if(Math.abs(dy) > 24) return dy;
            return (Number(ra.x) || 0) - (Number(rb.x) || 0);
        }).forEach((member, memberIndex) => {
            const index = refs.length + memberIndex;
            const col = index % cols;
            const row = Math.floor(index / cols);
            member.x = Math.round(originX + col * (thumb + gap));
            member.y = Math.round(originY + row * (thumb + gap));
            member.w = thumb;
            member.h = thumb;
            member.scale = 1;
        });
        return true;
    }
    const members = smartGroupMembers(group);
    if(!members.length) return false;
    if(!options.skipUndo) pushUndo();
    const ordered = members.slice().sort((a, b) => {
        const ra = nodeRect(a), rb = nodeRect(b);
        const dy = (Number(ra.y) || 0) - (Number(rb.y) || 0);
        if(Math.abs(dy) > 24) return dy;
        return (Number(ra.x) || 0) - (Number(rb.x) || 0);
    });
    ordered.forEach(node => {
        if(isSmartImageNode(node)){
            delete node.w;
            delete node.h;
        }
    });
    const sizes = ordered.map(node => {
        const r = nodeRect(node);
        return {node, w:Math.max(40, Number(r.width) || 120), h:Math.max(40, Number(r.height) || 120)};
    });
    const count = sizes.length;
    const pad = SMART_GROUP_ARRANGE_PADDING;
    const gap = SMART_GROUP_ARRANGE_GAP;
    const headerH = SMART_GROUP_ARRANGE_HEADER;
    const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count)) || 1));
    const rows = Math.ceil(count / cols);
    const colW = new Array(cols).fill(0);
    const rowH = new Array(rows).fill(0);
    sizes.forEach((s, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        colW[c] = Math.max(colW[c], s.w);
        rowH[r] = Math.max(rowH[r], s.h);
    });
    const colX = [];
    let accX = 0;
    for(let c = 0; c < cols; c++){ colX[c] = accX; accX += colW[c] + gap; }
    const rowY = [];
    let accY = 0;
    for(let r = 0; r < rows; r++){ rowY[r] = accY; accY += rowH[r] + gap; }
    const originX = (Number(group.x) || 0) + pad;
    const originY = (Number(group.y) || 0) + headerH + pad;
    sizes.forEach((s, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        s.node.x = Math.round(originX + colX[c] + (colW[c] - s.w) / 2);
        s.node.y = Math.round(originY + rowY[r] + (rowH[r] - s.h) / 2);
    });
    const totalW = colW.reduce((a, b) => a + b, 0) + gap * (cols - 1) + pad * 2;
    const totalH = rowH.reduce((a, b) => a + b, 0) + gap * (rows - 1) + pad * 2 + headerH;
    group.w = Math.max(SMART_GROUP_MIN_WIDTH, Math.round(totalW));
    group.h = Math.max(SMART_GROUP_MIN_HEIGHT, Math.round(totalH));
    return true;
}
// M3 拆分：singleImageLayout / groupImageGridLayout 已迁移到
// frontend/src/canvas/node-layout.js（经典 <script>，同上）。
// M3 拆分：smartNodeInputThumbRows / smartNodeInputThumbsHeight /
// smartNodeInputThumbsHtml 已迁移到 frontend/src/canvas/node-layout.js
// （经典 <script>，同上）。
// M3 拆分：promptNodeLayoutSize / imageLayout 已迁移到
// frontend/src/canvas/node-layout.js（经典 <script>，同上）。
// M2 拆分：smartLoopCount / smartLoopWidth / smartLoopHeight / fitSmartLoopNode
// 已迁移到 frontend/src/canvas/loop-node.js（经典 <script>，同上）。
// M3 拆分：nodeRect 已迁移到 frontend/src/canvas/node-layout.js
// （经典 <script>，非 ES module，原因同 M1/M2）。
function applyViewport(){
    world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    // Ports live inside the scaled world, so compensate their size and edge
    // offset to keep them visually stable in screen space while zooming.
    const portScale = 1 / Math.max(0.01, viewport.scale);
    world.style.setProperty('--node-port-scale', String(portScale));
    world.style.setProperty('--node-port-hover-scale', String(1.22 * portScale));
    world.style.setProperty('--node-port-edge-offset', `${-16 * portScale}px`);
    shell.style.backgroundSize = '24px 24px';
    shell.style.backgroundPosition = '0 0';
    const active = selectedNode();
    if(active && composer?.classList?.contains('open')) positionComposerForNode(active);
    if(active && promptComposer?.classList?.contains('open')) positionPromptComposerForNode(active);
    updateNodeShortcutBar();
    updateSelectionActions();
    requestRenderMinimap();
}
function screenToWorld(event){
    const rect = shell.getBoundingClientRect();
    return {
        x:(event.clientX - rect.left - viewport.x) / viewport.scale,
        y:(event.clientY - rect.top - viewport.y) / viewport.scale
    };
}
function viewportCenter(){
    return {
        x:(shell.clientWidth / 2 - viewport.x) / viewport.scale,
        y:(shell.clientHeight / 2 - viewport.y) / viewport.scale
    };
}
function renderMinimap(){
    if(!minimapContent || !minimapViewport) return;
    const width = minimapContent.clientWidth || 170;
    const height = minimapContent.clientHeight || 108;
    const viewW = shell.clientWidth / viewport.scale;
    const viewH = shell.clientHeight / viewport.scale;
    const viewX = -viewport.x / viewport.scale;
    const viewY = -viewport.y / viewport.scale;
    const rects = nodes.map(nodeRect);
    rects.push({x:viewX, y:viewY, width:viewW, height:viewH});
    const minX = Math.min(...rects.map(r => r.x), -200);
    const minY = Math.min(...rects.map(r => r.y), -200);
    const maxX = Math.max(...rects.map(r => r.x + r.width), viewX + viewW + 200);
    const maxY = Math.max(...rects.map(r => r.y + r.height), viewY + viewH + 200);
    const scale = Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));
    const offsetX = (width - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxY - minY) * scale) / 2;
    smartMinimapState = {minX, minY, scale, offsetX, offsetY, width, height};
    const project = r => ({
        left:offsetX + (r.x - minX) * scale,
        top:offsetY + (r.y - minY) * scale,
        width:Math.max(4, r.width * scale),
        height:Math.max(4, r.height * scale)
    });
    const nodeHtml = rects.slice(0, -1).map(r => {
        const p = project(r);
        return `<div class="minimap-node" style="left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px"></div>`;
    }).join('');
    const view = project({x:viewX, y:viewY, width:viewW, height:viewH});
    minimapContent.innerHTML = `${nodeHtml}<div id="minimapViewport" class="canvas-minimap-viewport" style="left:${view.left}px;top:${view.top}px;width:${view.width}px;height:${view.height}px"></div>`;
    minimapViewport = document.getElementById('minimapViewport');
}
function requestRenderMinimap(){
    if(viewportInteractionActive || dragState || panState || smartMinimapDrag){
        pendingMinimapRefreshAfterInteraction = true;
        return;
    }
    if(minimapRenderQueued) return;
    minimapRenderQueued = true;
    requestAnimationFrame(() => {
        minimapRenderQueued = false;
        renderMinimap();
    });
}
function minimapEventToWorld(event){
    if(!smartMinimapState) renderMinimap();
    const state = smartMinimapState;
    if(!state) return viewportCenter();
    const rect = minimapContent.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    return {
        x:state.minX + (mx - state.offsetX) / Math.max(0.0001, state.scale),
        y:state.minY + (my - state.offsetY) / Math.max(0.0001, state.scale)
    };
}
function centerViewportOnWorldPoint(point){
    viewport.x = shell.clientWidth / 2 - point.x * viewport.scale;
    viewport.y = shell.clientHeight / 2 - point.y * viewport.scale;
    applyViewport();
    scheduleSave();
}
function focusCanvasNode(nodeId){
    const node = nodes.find(item => String(item?.id || '') === String(nodeId || ''));
    if(!node) return false;
    selectedId = node.id;
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    render();
    const rect = nodeRect(node);
    centerViewportOnWorldPoint({x:rect.x + rect.width / 2, y:rect.y + rect.height / 2});
    syncSelectionUi();
    return true;
}
window.focusCanvasNode = focusCanvasNode;
function flushDeferredViewportRendering(){
    viewportInteractionActive = false;
    if(pendingMinimapRefreshAfterInteraction){
        pendingMinimapRefreshAfterInteraction = false;
        renderMinimap();
    }
}
function fitAllNodesViewport(){
    if(!nodes.length){
        viewport.scale = 0.45;
        viewport.x = shell.clientWidth / 2;
        viewport.y = shell.clientHeight / 2;
        applyViewport();
        scheduleSave();
        return;
    }
    const rects = nodes.map(nodeRect);
    const minX = Math.min(...rects.map(r => r.x));
    const minY = Math.min(...rects.map(r => r.y));
    const maxX = Math.max(...rects.map(r => r.x + r.width));
    const maxY = Math.max(...rects.map(r => r.y + r.height));
    const pad = 160;
    const width = Math.max(1, maxX - minX + pad * 2);
    const height = Math.max(1, maxY - minY + pad * 2);
    const nextScale = Math.max(0.06, Math.min(0.82, (shell.clientWidth - 80) / width, (shell.clientHeight - 80) / height));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    viewport.scale = nextScale;
    viewport.x = shell.clientWidth / 2 - cx * viewport.scale;
    viewport.y = shell.clientHeight / 2 - cy * viewport.scale;
    applyViewport();
    scheduleSave();
}
function enterZoomPreview(){
    if(zoomPreviewState) return;
    zoomPreviewState = {...viewport};
    shell.classList.add('zoom-preview');
    closeCreateMenu();
    fitAllNodesViewport();
}
function exitZoomPreview(point=null){
    if(!zoomPreviewState) return false;
    const prev = zoomPreviewState;
    zoomPreviewState = null;
    shell.classList.remove('zoom-preview');
    viewport.scale = prev.scale;
    if(point){
        viewport.x = shell.clientWidth / 2 - point.x * viewport.scale;
        viewport.y = shell.clientHeight / 2 - point.y * viewport.scale;
    } else {
        viewport.x = prev.x;
        viewport.y = prev.y;
    }
    applyViewport();
    scheduleSave();
    return true;
}
function exitZoomPreviewToNode(nodeId){
    if(!zoomPreviewState) return false;
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return exitZoomPreview();
    const prev = zoomPreviewState;
    const rect = nodeRect(node);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const fitScale = Math.min(
        1.15,
        (shell.clientWidth - 160) / Math.max(1, rect.width),
        (shell.clientHeight - 160) / Math.max(1, rect.height)
    );
    const readableScale = Math.min(1.15, Math.max(0.72, fitScale));
    zoomPreviewState = null;
    shell.classList.remove('zoom-preview');
    viewport.scale = Math.max(safeScale(prev.scale), readableScale);
    viewport.x = shell.clientWidth / 2 - cx * viewport.scale;
    viewport.y = shell.clientHeight / 2 - cy * viewport.scale;
    applyViewport();
    scheduleSave();
    return true;
}
function toggleZoomPreview(){
    if(zoomPreviewState) exitZoomPreview();
    else enterZoomPreview();
}
// M10 拆分：生成参数设置面板全部逻辑（syncEngineOptionsVisibility 到
// refreshSmartConfigFromSettings，约1600行）已迁移到
// frontend/src/canvas/generation-settings.js（经典 <script>，
// 非 ES module，原因同 M1-M9）。
// M17 拆分：loadPromptPresets / savePromptPresets / defaultPromptTemplateGroups /
// loadPromptTemplateGroups / savePromptTemplateGroups / loadPromptTemplateOverrides /
// savePromptTemplateOverrides / loadPromptTemplates / activePromptLibrary /
// renderPromptLibrarySelect / promptTemplateItems / promptTemplateText /
// promptTemplateName / promptTemplateScene / promptTemplateSearchText /
// activePromptTemplateGroups / promptTemplateCategoryLabel /
// promptTemplateSelectedItem / currentPromptPreset / defaultPromptPresetName /
// promptPresetPanelNode / setPromptPresetStatus / resetPromptPresetDeleteState /
// createPromptPresetFromNode / createPromptPresetFromComposer / savePromptNodeAsPreset /
// renderPromptPresetPanel / openPromptPresetPanel / closePromptPresetPanel /
// promptTemplateScrollSnapshot / restorePromptTemplateScroll / renderPromptTemplatePanel /
// activePromptTemplateNodeId / syncComposerTemplateButton / openPromptTemplatePanel /
// closePromptTemplatePanel / applyPromptTemplateToNode / saveCurrentPromptAsTemplate /
// createBlankPromptTemplate / savePromptTemplateEdit / deletePromptTemplate /
// createPromptTemplateGroup / renamePromptTemplateGroup / deletePromptTemplateGroup /
// editPromptPresetForNode 已迁移到
// frontend/src/canvas/prompt-templates.js（经典 <script>，非 ES module，
// 原因同 M1-M16）。状态变量（promptPresets/promptLibraries/promptTemplateCategory
// 等）及 selectedId/selectedIds/selectedImage 刻意留在这里，原因同 M16。
// M9 拆分：assetCategories / assetLibraries / activeAssetLibrary / activeAssetCategory /
// assetCategoriesForLibrary 已迁移到
// frontend/src/canvas/asset-library.js（经典 <script>，非 ES module，
// 原因同 M1-M8）。
// M14 拆分：节点悬浮快捷栏 + 右键菜单全部逻辑（nodeShortcutTargetFor
// 到 triggerNodeShortcutAction，约320行）已迁移到
// frontend/src/canvas/node-context-ui.js（经典 <script>，非 ES
// module，原因同 M1-M13）。
// M9 拆分：loadAssetLibrary 已迁移到
// frontend/src/canvas/asset-library.js（经典 <script>，非 ES module，
// 原因同 M1-M8）。
function refreshAssetLibrarySoon(delay=120){
    clearTimeout(assetLibraryRefreshTimer);
    assetLibraryRefreshTimer = setTimeout(async () => {
        await loadAssetLibrary();
        if(mentionPicker?.classList?.contains('open') && mentionSource === 'asset') renderMentionPicker('asset');
    }, delay);
}
function handleAssetLibraryUpdatedMessage(data={}){
    const remoteUpdatedAt = Number(data.updated_at || 0);
    if(remoteUpdatedAt && remoteUpdatedAt <= Number(assetLibraryUpdatedAt || 0)) return;
    refreshAssetLibrarySoon();
}
// 多人协作同步：一个稳定的客户端 id，既用于 WS 连接，也随 saveCanvas 上报，
// 服务器广播 canvas_updated 时带回 client_id，自己发的就忽略，避免自我刷新。
const smartClientId = `canvas_smart_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
let canvasSyncInFlight = false;
let canvasSaveDirty = false;
let canvasSaveAgain = false;
let canvasSyncTimer = null;
let canvasMetaPollTimer = null;
// M16 拆分：mergeSmartImageLists / smartNodeInFlight / mergeSmartNode /
// mergeSmartNodeLists / mergeSmartConnections / applyMergedServerCanvas /
// mergeReloadCanvasNow / scheduleCanvasMergeReload / handleCanvasUpdatedMessage /
// startCanvasMetaPoll 已迁移到 frontend/src/canvas/canvas-sync.js
// （经典 <script>，非 ES module，原因同 M1-M15）。
// smartClientId 常量及 canvasSyncInFlight/canvasSaveDirty/canvasSaveAgain/
// canvasSyncTimer/canvasMetaPollTimer 这几个可变状态变量刻意留在这里
// （被 scheduleSave/saveCanvas 共享读写，原因同 state.js 的顾虑），
// canvas-sync.js 通过共享脚本作用域访问。
function connectAssetLibrarySyncSocket(){
    const host = window.location.host;
    if(!host) return;
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const clientId = smartClientId;
    let socket;
    let retryTimer = null;
    const connect = () => {
        try {
            socket = new WebSocket(`${protocol}://${host}/ws/stats?client_id=${clientId}`);
        } catch(e) {
            retryTimer = setTimeout(connect, 3000);
            return;
        }
        socket.onmessage = event => {
            try {
                const data = JSON.parse(event.data);
                if(data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(data);
                if(data?.type === 'canvas_updated') handleCanvasUpdatedMessage(data);
                if((data?.type === 'agent.event' || data?.type?.startsWith('agent.')) && window.canvasAgentHandleEvent) window.canvasAgentHandleEvent(data);
            } catch(e) {}
        };
        socket.onclose = () => {
            retryTimer = setTimeout(connect, 3000);
        };
        socket.onerror = () => {
            try { socket.close(); } catch(e) {}
        };
    };
    window.addEventListener('beforeunload', () => {
        clearTimeout(retryTimer);
        try { socket?.close(); } catch(e) {}
    });
    connect();
}
// M9 拆分：setAssetLibraryFromResponse / toggleAssetLibrary / assetCategoryForMention /
// assetMediaKind / assetThumbHtml / renderAssetLibrary / openAssetNameDialog /
// positionAssetHoverPreview / showAssetHoverPreview / hideAssetHoverPreview /
// beginAssetInlineRename / bindAssetItemEvents / addFileToAssetLibrary /
// canvasImageDragPayload 已迁移到
// frontend/src/canvas/asset-library.js（经典 <script>，非 ES module，
// 原因同 M1-M8）。
async function loadCanvas({renderCanvas=true}={}){
    try {
        if(!canvasId){
            const response = await fetch('/api/canvases', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({title:tr('canvas.title'), icon:'sparkles'})
            });
            if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('canvas.toastLoadFail')));
            const data = await response.json();
            canvasId = data.canvas?.id || '';
            if(!canvasId) throw new Error(tr('canvas.toastLoadFail'));
            history.replaceState(null, '', `/static/canvas.html?id=${encodeURIComponent(canvasId)}`);
        }
        clearTimeout(suppressAutoSaveReleaseTimer);
        suppressAutoSave = true;
        deferredAutoSaveNeeded = false;
        const res = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`);
        if(!res.ok) throw new Error(await smartResponseErrorMessage(res, tr('canvas.toastLoadFail')));
        const data = await res.json();
        canvas = data.canvas;
        document.title = canvas.title || tr('canvas.title');
        document.getElementById('canvasTitle').textContent = canvas.title || tr('canvas.title');
        nodes = (Array.isArray(canvas.nodes) ? canvas.nodes : []).map(normalizeLegacySmartNode).filter(Boolean);
        // A canvas refresh replaces node objects. Rebuild the composer from
        // the refreshed node settings instead of retaining a stale global
        // settings object from the previously selected node.
        activeComposerSubject = null;
        lastComposerNodeId = '';
        let repairedTerminalTaskState = false;
        nodes.forEach(n => {
            const pendingTasks = smartPendingTasks(n);
            if(pendingTasks.length){
                n.pending = Math.max(pendingTasks.length, Number(n.pending || 0) || pendingTasks.length);
                n.pendingCandidatePool = true;
                n.running = false;
            } else if(n.pending){
                n.pending = 0;
                delete n.pendingCandidatePool;
            } else if(n.queued && (n.images || []).some(image => image?.url)){
                // Older Agent completion events can persist media with a stale
                // queued flag. Completed media with no pending task is terminal.
                delete n.queued;
                n.running = false;
                repairedTerminalTaskState = true;
            } else if(n.running || n.queued){
                // Older ComfyUI runs persisted a visual running state but not
                // their server task ID. They cannot be resumed after reload.
                delete n.queued;
                n.running = false;
                n.runTimerHidden = true;
                repairedTerminalTaskState = true;
            }
        });
        canvas.nodes = nodes;
        canvas.connections = Array.isArray(canvas.connections) ? canvas.connections : [];
        viewport = {...viewport, ...(canvas.viewport || {})};
        viewport.scale = safeScale(viewport.scale);
        if(canvas.settings) settings = normalizeStoredImageRatios({...settings, ...canvas.settings});
        canvasDefaultSmartSettings = cloneSmartSettings(settings);
        loadRecentSmartSettings();
        if(settings.comfy_workflow && !settings.comfyWorkflow) settings.comfyWorkflow = settings.comfy_workflow;
        if(settings.comfy_params && !settings.comfyParams) settings.comfyParams = settings.comfy_params;
        updateProviderModels();
        applyViewport();
        if(renderCanvas){
            render();
            // Refreshing replaces the image metadata with the server copy.
            // Cached previews may already be loaded, so measure and render
            // immediately instead of retaining the fallback node layout.
            if(measureSmartNodeImages({applyReady:true, renderOnChange:false}) || repairedTerminalTaskState){
                render();
                scheduleSave();
            }
            resumeSmartPendingTasks();
            startCanvasMetaPoll();
        }
        suppressAutoSaveReleaseTimer = setTimeout(() => {
            suppressAutoSave = false;
            suppressAutoSaveReleaseTimer = null;
            if(deferredAutoSaveNeeded){
                deferredAutoSaveNeeded = false;
                scheduleSave();
            }
        }, 2000);
        return true;
    } catch(e) {
        clearTimeout(suppressAutoSaveReleaseTimer);
        suppressAutoSaveReleaseTimer = null;
        suppressAutoSave = false;
        deferredAutoSaveNeeded = false;
        toast(e.message || tr('canvas.toastLoadFail'));
        return false;
    }
}
function scheduleSave(delay=450){
    if(!canvasId || !canvas) return;
    if(suppressAutoSave){
        deferredAutoSaveNeeded = true;
        return;
    }
    canvasSaveDirty = true;
    clearTimeout(saveTimer);
    if(canvasSyncInFlight){
        canvasSaveAgain = true;
        return;
    }
    const waitMs = Math.max(0, Number(delay) || 0) || 450;
    saveTimer = setTimeout(saveCanvas, waitMs);
}
async function saveCanvas(){
    if(!canvasId || !canvas) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    if(canvasSyncInFlight){
        canvasSaveAgain = true;
        canvasSaveDirty = true;
        return;
    }
    savePromptDraftForCurrent();
    nodes.forEach(node => {
        node.images = (node.images || []).map(mediaItemForStorage);
        if(Array.isArray(node.candidateImages)) node.candidateImages = node.candidateImages.map(mediaItemForStorage);
        if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
    });
    canvas.nodes = nodes;
    canvas.settings = settingsForStorage(canvasDefaultSmartSettings || initialSmartSettings);
    canvas.viewport = {...viewport};
    const storageCanvas = canvasForStorage();
    canvasSyncInFlight = true;
    canvasSaveAgain = false;
    try {
        const res = await fetch(`/api/canvases/${encodeURIComponent(canvasId)}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                title:storageCanvas.title || tr('canvas.title'),
                icon:storageCanvas.icon || 'sparkles',
                nodes:storageCanvas.nodes || [],
                connections:storageCanvas.connections || [],
                viewport:storageCanvas.viewport || {x:0,y:0,scale:1},
                logs:storageCanvas.logs || [],
                settings:storageCanvas.settings,
                base_updated_at:storageCanvas.updated_at || canvas.updated_at || 0,
                client_id:smartClientId
            })
        });
        if(res.ok){
            const data = await res.json();
            if(data.canvas && data.canvas.updated_at) canvas.updated_at = data.canvas.updated_at;
            canvasSaveDirty = Boolean(canvasSaveAgain);
        } else if(res.status === 409) {
            const data = await res.json().catch(() => ({}));
            const serverCanvas = data.detail?.canvas;
            const remoteUpdatedAt = Number(data.detail?.updated_at || serverCanvas?.updated_at || 0);
            if(canvasSaveDirty || canvasSaveAgain){
                if(remoteUpdatedAt) canvas.updated_at = remoteUpdatedAt;
                canvasSaveAgain = true;
                return;
            }
            if(serverCanvas){
                applyMergedServerCanvas(serverCanvas);
                nodes.forEach(node => {
                    node.images = (node.images || []).map(mediaItemForStorage);
                    if(Array.isArray(node.candidateImages)) node.candidateImages = node.candidateImages.map(mediaItemForStorage);
                    if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);
                });
                canvas.nodes = nodes;
            } else if(remoteUpdatedAt) {
                canvas.updated_at = remoteUpdatedAt;
            }
            canvasSaveDirty = false;
        }
    } catch(e) {} finally {
        canvasSyncInFlight = false;
        if(canvasSaveAgain){
            canvasSaveAgain = false;
            canvasSaveDirty = true;
            setTimeout(saveCanvas, 0);
        }
    }
}
function imageMetaFromNode(node){
    return {};
}
function applyNodeMetaToImage(image, node){
    return stripImageGenerationMeta(image);
}
// M3 拆分：inheritNodeMetaFromImage / createNode 已迁移到
// frontend/src/canvas/node-model.js（经典 <script>，同上）。
// M3 拆分：createPromptNode 已迁移到 frontend/src/canvas/node-model.js。
// M2 拆分：createLoopNode 已迁移到 frontend/src/canvas/loop-node.js。
// M3 拆分：createSmartGroupNode 已迁移到 frontend/src/canvas/node-model.js。
// M3 拆分：cloneSmartNode 已迁移到 frontend/src/canvas/node-model.js
// （经典 <script>，非 ES module，原因同 M1/M2）。
// M13 拆分：节点复制/粘贴 + 系统剪贴板媒体粘贴全部逻辑
// （copySelectedNodes 到 pasteFromContextMenu，约160行）已迁移到
// frontend/src/canvas/clipboard.js（经典 <script>，非 ES
// module，原因同 M1-M12）。
function duplicateForAltDrag(node){
    const ids = (isNodeSelected(node.id) ? selectedNodeIds() : [node.id]);
    const sourceNodes = ids.map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if(!sourceNodes.length) return node;
    pushUndo();
    const idMap = new Map();
    const copies = sourceNodes.map(n => {
        const copy = cloneSmartNode(n, 0, 0);
        idMap.set(n.id, copy.id);
        return copy;
    });
    copies.forEach(copy => {
        if(Array.isArray(copy.inputNodeIds)) copy.inputNodeIds = copy.inputNodeIds.map(id => idMap.get(id) || id).filter(Boolean);
        if(copy.sourceNodeId) copy.sourceNodeId = idMap.get(copy.sourceNodeId) || copy.sourceNodeId;
    });
    const idSet = new Set(sourceNodes.map(n => n.id));
    // 连线保留策略：只保留「流入被复制节点」的连线（to 端在复制集内），
    // 即保留与上游的连线，不保留复制节点流向下游的连线。外部上游端点保持指向原节点。
    const copiedConnections = (canvas.connections || []).filter(c => idSet.has(c.to));
    const validIds = new Set([...nodes.map(n => n.id), ...copies.map(n => n.id)]);
    const newConnections = copiedConnections.map(conn => ({
        ...conn,
        from:idMap.get(conn.from) || conn.from,
        to:idMap.get(conn.to) || conn.to
    })).filter(conn =>
        conn.from && conn.to && conn.from !== conn.to
        && validIds.has(conn.from) && validIds.has(conn.to)
    );
    const mergedConnections = [...(canvas.connections || [])];
    newConnections.forEach(conn => {
        const kind = conn.kind || 'flow';
        if(!mergedConnections.some(c => c.from === conn.from && c.to === conn.to && (c.kind || 'flow') === kind)){
            mergedConnections.push(conn);
        }
    });
    canvas.connections = mergedConnections;
    nodes.push(...copies);
    selectedId = '';
    selectedIds = [];
    selectedImage = {nodeId:'', index:-1};
    const dragCopy = copies.find(c => c.id === idMap.get(node.id)) || copies[0];
    render();
    scheduleSave();
    return dragCopy;
}
function shellPoint(event){
    const rect = shell.getBoundingClientRect();
    return {x:event.clientX - rect.left, y:event.clientY - rect.top};
}
// M4 拆分：connectionGeometry / renderConnections /
// updateConnectionGeometryInPlace / refreshConnectionLayer /
// requestRefreshConnectionLayer 已迁移到
// frontend/src/canvas/connections.js（经典 <script>，同上）。
function moveNodeElementsDuringDrag(){
    if(!dragState) return;
    const groupItems = dragState.group || [{id:dragState.id}];
    groupItems.map(item => item.id).forEach(id => {
        const n = nodes.find(x => x.id === id);
        const el = world.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`);
        if(n && el){
            el.style.left = `${n.x || 0}px`;
            el.style.top = `${n.y || 0}px`;
        }
    });
    const active = selectedNode();
    if(active && (dragState.group || [{id:dragState.id}]).some(item => item.id === active.id)){
        positionComposerForNode(active);
        if(promptComposer?.classList?.contains('open')) positionPromptComposerForNode(active);
        // 让节点顶部快捷栏跟随拖动。首次拖动若尚未渲染出快捷栏则补渲染，之后仅重定位。
        if(nodeShortcutOverlay?.querySelector('.node-shortcut-bar')) positionNodeShortcutForNode(active);
        else updateNodeShortcutBar();
    }
    requestRefreshConnectionLayer();
    requestRenderMinimap();
}
function updateNodeElementDuringResize(node){
    if(!node) return;
    const el = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"]`);
    if(!el){
        render();
        return;
    }
    const imgs = node.images || [];
    const layout = imageLayout(imgs, nodeScale(node), node);
    el.style.width = `${layout.width}px`;
    el.style.height = `${layout.height}px`;
    const body = el.querySelector('.node-body');
    if(body){
        const loadingSingle = body.querySelector('.loading-cell.single');
        if(loadingSingle){
            loadingSingle.style.width = `${layout.width}px`;
            loadingSingle.style.height = `${layout.height}px`;
        }
        const loadingGrid = body.querySelector('.loading-skeleton');
        if(loadingGrid){
            const count = Math.max(1, Number(node.pending) || 1);
            const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
            const rows = Math.ceil(count / cols);
            loadingGrid.style.width = `${layout.width}px`;
            loadingGrid.style.height = `${layout.height}px`;
            loadingGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
            loadingGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        }
        const grid = body.querySelector('.thumb-grid');
        if(grid){
            grid.style.setProperty('--thumb-cols', layout.cols);
            grid.style.setProperty('--thumb-size', `${layout.thumb}px`);
        }
        const wrap = body.querySelector('.image-wrap');
        if(wrap){
            wrap.style.setProperty('--node-img-w', `${layout.width}px`);
            wrap.style.setProperty('--node-img-h', `${layout.height}px`);
        }
        const media = body.querySelector('.node-img');
        if(media){
            media.style.width = `${layout.width}px`;
            media.style.height = `${layout.height}px`;
        }
    }
    const active = selectedNode();
    if(active?.id === node.id){
        positionComposerForNode(active);
        if(promptComposer?.classList?.contains('open')) positionPromptComposerForNode(active);
    }
    refreshConnectionLayer();
    renderMinimap();
}
// M11 拆分：媒体展示/下载全部逻辑（isVideoMediaItem 到
// downloadGroupNodeImages，约680行）已迁移到
// frontend/src/canvas/media-display.js（经典 <script>，非 ES
// module，原因同 M1-M10）。
function smartRunPlatformLabel(run){
    const s = run?.settings || {};
    if(s.engine === 'comfy') return 'ComfyUI';
    if(run?.kind === 'video') return s.videoProvider || 'Video';
    return s.provider_id || 'API';
}
function smartRunRequestMeta(run){
    const s = run?.settings || {};
    if(s.engine === 'comfy') return {workflow_json:s.comfyWorkflow || ''};
    if(run?.kind === 'video') return {connection_id:s.videoConnectionId || '', model_id:s.videoModelId || '', resource_id:s.videoResourceId || '', duration:s.videoDuration || '', aspect_ratio:s.videoAspect || '', resolution:s.videoResolution || ''};
    return {connection_id:s.connection_id || '', model_id:s.model_id || '', resource_id:s.resource_id || '', size:run?.size || '', quality:s.quality || '', n:s.count || 1};
}
function smartRunSnapshot(node, prompt, refs=[], kind='image'){
    const settingsSnapshot = cloneSmartSettings(settings);
    return {
        nodeId:node?.id || '',
        nodeType:node?.type || 'smart-image',
        kind,
        settings:settingsSnapshot,
        prompt:prompt || '',
        refs:(refs || []).map(ref => ({file_id:ref.file_id || '', url:ref.url || '', name:ref.name || 'image', kind:ref.kind || ''})).filter(ref => ref.url),
        size: kind === 'image' && isApiLikeEngine(settingsSnapshot.engine) ? sizeForRun(settingsSnapshot) : ''
    };
}
function buildSmartLogEntry(run, {outputs=[], runMs=0, error='', taskId='', upstreamTaskId=''}={}){
    const request = smartRunRequestMeta(run);
    if(taskId) request.task_id = taskId;
    if(upstreamTaskId) request.upstream_task_id = upstreamTaskId;
    return {
        id:uid('log'),
        createdAt:Date.now(),
        status:error ? 'failed' : 'success',
        platform:smartRunPlatformLabel(run),
        nodeType:run?.nodeType || 'smart-image',
        nodeId:run?.nodeId || '',
        model:smartRunTaskLabel(run),
        request,
        prompt:run?.prompt || '',
        outputs:(outputs || []).filter(Boolean),
        refs:run?.refs || [],
        runMs:Number(runMs || 0),
        error:error ? String(error) : ''
    };
}
// A single canvas run may fan out into several backend tasks (one per image,
// per ComfyUI prompt, or per RunningHub app submit). Passing a `tasks` array
// records one log entry per task_id so each can be cross-referenced against the
// backend task.log. Video/sync paths omit `tasks` and keep a single entry.
function addSmartGenerationLog({run, outputs=[], runMs=0, error='', taskId='', upstreamTaskId='', tasks=null}) {
    if(!canvas) return;
    canvas.logs = canvas.logs || [];
    const entries = Array.isArray(tasks) && tasks.length
        ? tasks.map(task => buildSmartLogEntry(run, {
            outputs:task.outputs || [],
            runMs:task.runMs != null ? task.runMs : runMs,
            error:task.error || '',
            taskId:task.taskId || '',
            upstreamTaskId:task.upstreamTaskId || task.upstream_task_id || ''
        }))
        : [buildSmartLogEntry(run, {outputs, runMs, error, taskId, upstreamTaskId})];
    canvas.logs = [...entries, ...canvas.logs].slice(0, 500);
    scheduleSave();
    // Keep the top-left spending indicator in sync as soon as a generation
    // succeeds. This single completion hook covers direct, batch, and cascade
    // runs, including asynchronous task polling paths that log on settlement.
    if(!error) void loadCanvasUsage();
}
// Jump from a log thumbnail to the canvas node that holds that output, mirroring
// the Canvas Agent's click-to-focus behaviour (select + center viewport). We
// locate the node by the output URL so it works even when nodes were rearranged;
// the log's stored nodeId is a fallback. If no matching node exists anymore, a
// new node containing the asset is created at the current viewport center.
function jumpToCanvasLogOutput(output){
    const item = typeof output === 'string' ? {url:output} : (output || {});
    const target = String(item.url || '');
    const hasUrl = (list) => Array.isArray(list) && list.some(img => String(img?.url || '') === target);
    let node = target ? nodes.find(n => hasUrl(n?.images) || hasUrl(n?.candidateImages)) : null;
    if(!node && item.nodeId) node = nodes.find(n => String(n?.id || '') === String(item.nodeId));
    // Always close the log first so the canvas is visible.
    if(typeof closeCanvasLog === 'function') closeCanvasLog();
    if(!node && target){
        // The original node is gone: recreate a node holding this asset.
        const kind = item.kind === 'video' || outputUrlLooksVideo(target) ? 'video' : (item.kind || 'image');
        const mediaItem = {
            url:target,
            file_id:item.file_id || fileIdFromUrl(target),
            kind,
            name:item.name || (kind === 'video' ? 'video' : 'image'),
            generatedResult:true
        };
        if(item.poster_url) mediaItem.poster_url = item.poster_url;
        const center = viewportCenter();
        node = createNode(center.x, center.y, [mediaItem]);
        toast('原节点已不存在，已在画布新建素材节点');
    }
    if(!node || !focusCanvasNode(node.id)){
        toast('无法跳转到画布素材');
        return;
    }
    // If the clicked output maps to a specific image within the node, select it.
    const index = (node.images || []).findIndex(img => String(img?.url || '') === target);
    if(index >= 0){
        selectedImage = {nodeId:node.id, index};
        render();
        syncSelectionUi();
    }
}
function renderCanvasLog(){
    const logs = canvas?.logs || [];
    canvasLogList.innerHTML = logs.length ? logs.map(log => {
        const thumbs = (log.outputs || []).slice(0, 8).map(output => {
            const item = typeof output === 'string' ? {url:output} : (output || {});
            const url = String(item.url || '');
            if(!url) return '';
            // Older log entries store outputs as bare /api/files/<id>/preview
            // strings. Recover their file id so they follow the same thumbnail
            // path as the canvas nodes.
            const fileId = String(item.file_id || fileIdFromUrl(url) || '').trim();
            const mediaItem = fileId && fileId !== item.file_id ? {...item, file_id:fileId} : item;
            const kind = item.kind === 'video' || outputUrlLooksVideo(url) ? 'video' : 'image';
            const dataAttrs = ` data-node-id="${escapeAttr(log.nodeId || '')}" data-file-id="${escapeAttr(fileId)}" data-poster="${escapeAttr(item.poster_url || item.thumbnail_url || '')}"`;
            if(kind === 'video'){
                // Reuse the backend FFmpeg poster frame (/api/files/<id>/thumb)
                // as the thumbnail. Only fall back to loading the video for a
                // first frame when no file_id/poster is available.
                const poster = item.poster_url || item.thumbnail_url || (fileId ? fileThumbnailUrl(mediaItem) : '');
                if(poster){
                    return `<div class="log-video-thumb"><img src="${escapeAttr(poster)}" data-url="${escapeAttr(url)}" data-kind="video"${dataAttrs} alt="video"><span class="log-video-badge"><i data-lucide="play"></i></span></div>`;
                }
                const videoSrc = escapeAttr(filePreviewUrl(item) || url);
                return `<div class="log-video-thumb"><video muted playsinline preload="metadata" src="${videoSrc}" data-url="${escapeAttr(url)}" data-kind="video"${dataAttrs}></video><span class="log-video-badge"><i data-lucide="play"></i></span></div>`;
            }
            const thumbSrc = escapeAttr(thumbMediaUrl(mediaItem));
            return `<img src="${thumbSrc}" data-url="${escapeAttr(url)}" data-kind="image"${dataAttrs} alt="output">`;
        }).join('');
    const date = new Date(log.createdAt || Date.now()).toLocaleString('zh-CN');
        const req = log.request || {};
        const taskId = req.task_id || req.taskId || req.prompt_id || req.promptId || '';
        const upstreamId = req.upstream_task_id || req.upstreamTaskId || '';
        const backend = req.workflow_json || req.workflow || req.provider_id || req.providerId || req.backend || '';
        const subParts = [
            date,
            `输出 ${(log.outputs || []).length}`,
            taskId ? `ID ${taskId}` : '',
            upstreamId && upstreamId !== taskId ? `上游 ${upstreamId}` : '',
            backend
        ].filter(Boolean);
        return `<div class="log-item ${log.status === 'failed' ? 'failed' : ''}">
            <div class="log-main">
                <div class="log-meta">
                    <span class="log-chip ${log.status === 'failed' ? 'status-failed' : 'status-ok'}">${escapeHtml(log.status === 'failed' ? tr('canvas.failed') : tr('canvas.success'))}</span>
                    <span class="log-chip">${escapeHtml(log.platform || '-')}</span>
                    ${log.model ? `<span class="log-chip">${escapeHtml(log.model)}</span>` : ''}
                    <span class="log-chip">${escapeHtml(formatRunDuration(log.runMs || 0))}</span>
                </div>
                <div class="log-subline">${subParts.map(part => `<span title="${escapeAttr(part)}">${escapeHtml(part)}</span>`).join('')}</div>
                ${log.error ? `<div class="log-error" title="${escapeAttr(log.error)}">${escapeHtml(log.error)}</div>` : ''}
                <div class="log-prompt" title="${escapeAttr(log.prompt || tr('canvas.noPromptMeta'))}" data-prompt="${escapeAttr(log.prompt || '')}">${escapeHtml(log.prompt || tr('canvas.noPromptMeta'))}</div>
            </div>
            <div class="log-side">
                <div class="log-thumbs">${thumbs}</div>
                <button type="button" class="log-expand" data-log-expand aria-expanded="false"><i data-lucide="chevron-down"></i><span>${escapeHtml(tr('canvas.logExpand'))}</span></button>
            </div>
        </div>`;
    }).join('') : `<div class="log-empty">${escapeHtml(tr('canvas.noLogs'))}</div>`;
    canvasLogList.querySelectorAll('[data-url]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            jumpToCanvasLogOutput({
                url:el.dataset.url,
                nodeId:el.dataset.nodeId || '',
                file_id:el.dataset.fileId || '',
                kind:el.dataset.kind || 'image',
                poster_url:el.dataset.poster || ''
            });
        };
    });
    canvasLogList.querySelectorAll('[data-prompt]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            const text = el.dataset.prompt || '';
            if(text) navigator.clipboard?.writeText(text).catch(() => {});
            const oldText = el.textContent;
            el.textContent = tr('canvas.copied');
            el.classList.add('copied');
            setTimeout(() => {
                el.textContent = oldText;
                el.classList.remove('copied');
            }, 900);
        };
    });
    canvasLogList.querySelectorAll('[data-log-expand]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const item = btn.closest('.log-item');
            if(!item) return;
            const expanded = item.classList.toggle('expanded');
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const label = btn.querySelector('span');
            if(label) label.textContent = expanded ? tr('canvas.logCollapse') : tr('canvas.logExpand');
            const icon = btn.querySelector('i');
            if(icon){
                icon.setAttribute('data-lucide', expanded ? 'chevron-up' : 'chevron-down');
                refreshIcons();
            }
        };
    });
    refreshIcons();
}
function openCanvasLog(){
    if(!canvas) return;
    renderCanvasLog();
    canvasLogModal.classList.add('open');
}
function closeCanvasLog(){
    canvasLogModal.classList.remove('open');
}
function openCanvasShortcuts(){
    canvasShortcutModal?.classList.add('open');
    refreshIcons();
}
function closeCanvasShortcuts(){
    canvasShortcutModal?.classList.remove('open');
}
function promptNodeBodyHtml(node){
    node.llmTask = ['llm', 'caption', 'expand'].includes(node.llmTask) ? node.llmTask : 'llm';
    const templateActive = activePromptTemplateNodeId() === node.id;
    return `<div class="prompt-node-card">
        <textarea class="prompt-node-text prompt-node-control" readonly placeholder="${escapeHtml(tr('smart.promptPlaceholderNode'))}">${escapeHtml(node.text || '')}</textarea>
        <div class="prompt-node-tools">
            <button class="prompt-node-pill prompt-node-control prompt-preset-edit ${templateActive ? 'active' : ''}" type="button"><i data-lucide="library"></i><span>模板库</span></button>
        </div>
    </div>`;
}
// M2 拆分：loopNumberControlHtml / smartLoopTokenLabel / smartLoopTokenChipHtml /
// smartLoopVariableHtml / smartLoopEditorText / insertSmartLoopToken /
// smartLoopBodyHtml 已迁移到 frontend/src/canvas/loop-node.js（经典 <script>，同上）。
// M7 拆分：smartGroupBodyHtml / smartRecoverableImageTask /
// imageTaskRecoverBodyHtml / nodeBodyHtml / formatRunDuration / nodeRunElapsedMs /
// runTimePillHtml / hideRunTimerForNode / refreshRunTimerPills / render /
// measureSmartNodeImages 已迁移到 frontend/src/canvas/canvas-render.js
// （经典 <script>，非 ES module，原因同 M1-M6）。
// M4 拆分：bindConnectionEvents / ensurePortDragPathElement /
// clearPortDragVisual 已迁移到
// frontend/src/canvas/connections.js（经典 <script>，同上）。
function bindPromptNodeControls(el, node){
    el.querySelectorAll('.prompt-node-control, .prompt-node-pill').forEach(control => {
        control.addEventListener('mousedown', e => e.stopPropagation());
        control.addEventListener('click', e => e.stopPropagation());
        control.addEventListener('dblclick', e => e.stopPropagation());
    });
    const textEl = el.querySelector('.prompt-node-text');
    if(textEl) {
        bindScrollableText(textEl);
        textEl.oninput = e => { node.text = e.target.value; scheduleSave(); };
        // 单击只选中节点（打开配置框），双击才进入编辑态。
        textEl.addEventListener('click', e => {
            e.stopPropagation();
            if(!textEl.readOnly) return;
            if(selectedId !== node.id){
                selectedId = node.id;
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                suppressComposerForCandidateNodeId = '';
                render();
            }
        });
        textEl.addEventListener('dblclick', e => {
            e.stopPropagation();
            textEl.readOnly = false;
            textEl.focus();
            const len = textEl.value.length;
            try { textEl.setSelectionRange(len, len); } catch(_) {}
        });
        textEl.addEventListener('blur', () => { textEl.readOnly = true; });
    }
    const presetEdit = el.querySelector('.prompt-preset-edit');
    if(presetEdit) presetEdit.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        if(promptTemplatePanel?.classList.contains('open') && promptTemplatePanel.dataset.target === 'node' && promptTemplatePanel.dataset.nodeId === node.id){
            closePromptTemplatePanel();
            return;
        }
        editPromptPresetForNode(node);
    };
}
// M2 拆分：bindLoopNodeControls 已迁移到 frontend/src/canvas/loop-node.js。
function bindScrollableText(el){
    if(!el || el.dataset.scrollBound === '1') return;
    el.dataset.scrollBound = '1';
    const stop = e => e.stopPropagation();
    const beginSelection = e => {
        e.stopPropagation();
        textSelectionGuard = {
            el,
            scrollTop:el.scrollTop || 0,
            scrollLeft:el.scrollLeft || 0,
            clientY:e.clientY,
            wheelUntil:0,
            active:true
        };
    };
    el.addEventListener('mousedown', beginSelection);
    el.addEventListener('mousemove', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.clientY = e.clientY;
    });
    el.addEventListener('mouseup', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.active = false;
    });
    el.addEventListener('mouseleave', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) {
            el.scrollTop = textSelectionGuard.scrollTop;
            el.scrollLeft = textSelectionGuard.scrollLeft;
        }
    });
    el.addEventListener('scroll', () => {
        const guard = textSelectionGuard;
        if(!guard || guard.el !== el || !guard.active || Date.now() < guard.wheelUntil) {
            if(guard?.el === el) {
                guard.scrollTop = el.scrollTop || 0;
                guard.scrollLeft = el.scrollLeft || 0;
            }
            return;
        }
        const nextTop = el.scrollTop || 0;
        const prevTop = guard.scrollTop || 0;
        const rect = el.getBoundingClientRect();
        const pointerBelow = Number.isFinite(guard.clientY) && guard.clientY > rect.bottom - 10;
        const pointerAbove = Number.isFinite(guard.clientY) && guard.clientY < rect.top + 10;
        const jumpedToTop = prevTop > Math.max(80, el.clientHeight * 0.45) && nextTop < 4 && !pointerAbove;
        const wrongDirectionJump = pointerBelow && nextTop < prevTop - Math.max(40, el.clientHeight * 0.25);
        if(jumpedToTop || wrongDirectionJump) {
            requestAnimationFrame(() => {
                if(textSelectionGuard?.el === el && textSelectionGuard.active) {
                    el.scrollTop = prevTop;
                    el.scrollLeft = guard.scrollLeft || 0;
                }
            });
            return;
        }
        guard.scrollTop = nextTop;
        guard.scrollLeft = el.scrollLeft || 0;
    }, {passive:true});
    el.addEventListener('click', stop);
    el.addEventListener('dblclick', stop);
    el.addEventListener('wheel', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.wheelUntil = Date.now() + 180;
    }, {passive:true});
}
// M4 拆分：updatePortDragVisual / handlePortDrop 已迁移到
// frontend/src/canvas/connections.js（经典 <script>，同上）。

/* ─── 拉线释放 → 节点类型选择菜单 ─── */
// M4 拆分：portDropMenuDrag / portDropMenuScreenPoint（原模块局部状态）/
// openPortDropMenu / closePortDropMenu / drawPortDropMenuLine /
// handlePortDropMenuSelect 已迁移到
// frontend/src/canvas/connections.js（经典 <script>，同上）。

// M7 拆分：pickMediaForSmartNode / bindNodeEvents / rectOverlapNode /
// dragConnectTargetFor / canAutoConnectDraggedNode / restoreDraggedNodePosition
// 已迁移到 frontend/src/canvas/canvas-render.js（经典 <script>，非 ES module，原因同 M1-M6）。
function clearDropHighlight(){
    world.querySelectorAll('.image-node.drop-target').forEach(el => el.classList.remove('drop-target'));
}
function setDropHighlight(targetId){
    clearDropHighlight();
    if(!targetId) return;
    const el = world.querySelector(`.image-node[data-id="${targetId}"]`);
    if(el) el.classList.add('drop-target');
}
function deleteNode(id){
    pushUndo();
    const deleteIds = new Set([id]);
    nodes.forEach(node => {
        if(isHistoryGroupNode(node) && node.historyFor === id) deleteIds.add(node.id);
    });
    nodes = nodes.filter(node => !deleteIds.has(node.id));
    if(canvas) canvas.connections = (canvas.connections || []).filter(c => !deleteIds.has(c.from) && !deleteIds.has(c.to));
    nodes.forEach(node => {
        if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = node.inputNodeIds.filter(inputId => !deleteIds.has(inputId));
        if(isSmartGroupNode(node) && Array.isArray(node.items)) node.items = node.items.filter(itemId => !deleteIds.has(itemId));
    });
    if(selectedId === id) selectedId = '';
    selectedIds = selectedIds.filter(selected => !deleteIds.has(selected));
    if(deleteIds.has(selectedImage.nodeId)) selectedImage = {nodeId:'', index:-1};
    if(deleteIds.has(candidatePanelNodeId)){
        candidatePanelNodeId = '';
        candidatePanelIndex = 0;
    }
    render();
    scheduleSave();
}
function clearNodeMediaBeforeDelete(id){
    const node = nodes.find(n => n.id === id);
    if(!node || (node.type && node.type !== 'smart-image')) return false;
    const hadMedia = Boolean((node.images || []).length || (node.candidateImages || []).length || node.pending);
    if(!hadMedia) return false;
    pushUndo();
    node.images = [];
    node.candidateImages = [];
    node.candidateIndex = 0;
    node.pending = 0;
    node.running = false;
    node.title = genKindLabel(node);
    delete node.w;
    delete node.h;
    const history = historyGroupForNode(node);
    if(history){
        nodes = nodes.filter(n => n.id !== history.id);
        if(canvas) canvas.connections = (canvas.connections || []).filter(c => c.from !== history.id && c.to !== history.id);
    }
    if(candidatePanelNodeId === id){
        candidatePanelNodeId = '';
        candidatePanelIndex = 0;
    }
    if(selectedImage.nodeId === id) selectedImage = {nodeId:'', index:-1};
    selectedId = id;
    selectedIds = [];
    render();
    scheduleSave();
    return true;
}
function deleteNodeFromButton(id){
    if(clearNodeMediaBeforeDelete(id)) return;
    deleteNode(id);
}
// M4 拆分：disconnectConnection / connectionMidpoint /
// insertionConnectionForNode 已迁移到
// frontend/src/canvas/connections.js（经典 <script>，同上）。
// M2 拆分：insertLoopNodeIntoConnection 已迁移到 frontend/src/canvas/loop-node.js。
function updateLoopInsertPreview(){
    const node = dragState ? nodes.find(n => n.id === dragState.id) : null;
    const next = node?.type === 'smart-loop' && dragState.ctrlGroup && (dragState.group || []).length <= 1
        ? insertionConnectionForNode(node)
        : null;
    const nextPreview = next ? {index:next.index} : null;
    const changed = (loopInsertPreview?.index ?? -1) !== (nextPreview?.index ?? -1);
    loopInsertPreview = nextPreview;
    if(changed) refreshConnectionLayer();
    return next;
}
// M8 拆分：图片编辑器全部功能（currentEditImage 到 applyImageEdit，
// 共约90个函数：裁剪/智能扩图/蒙版画笔/网格拼接拆分/文字工具/全景图预览/
// 视频帧导出/预览对比面板/弹窗生命周期）已迁移到
// frontend/src/canvas/image-editor.js（经典 <script>，非 ES module，
// 原因同 M1-M7）。
let lastComposerNodeId = '';
let activeComposerSubject = null;
function currentComposerSubject(){
    return selectedNode();
}
function savePromptDraftForCurrent(){
    if(promptInput?.dataset?.promptLocked === '1') return;
    const subject = activeComposerNode();
    if(!subject) return;
    if(promptInput?.dataset?.preserveDraftOnce === '1' && subject.promptDraftHtml){
        delete promptInput.dataset.preserveDraftOnce;
        return;
    }
    subject.promptDraftHtml = promptInput.innerHTML;
    subject.promptDraftText = promptPlainText();
}
function setPromptDraftForNode(node, text){
    if(!isSmartImageNode(node)) return;
    const value = String(text || '');
    node.promptDraftHtml = escapeHtml(value);
    node.promptDraftText = value;
    node.promptDraftTouched = true;
    if(activeSettingsSubject()?.id === node.id && promptInput){
        promptInput.textContent = value;
        delete promptInput.dataset.preserveDraftOnce;
    }
}
function loadPromptDraft(subject){
    if(subject?.promptDraftHtml){
        const hasToken = String(subject.promptDraftHtml || '').includes('mention-image-token');
        promptInput.innerHTML = hasToken
            ? subject.promptDraftHtml
            : (promptHtmlWithMentionTokens(subject.runPrompt || subject.promptDraftText || '', subject.runPromptRefs || []) || subject.promptDraftHtml);
    } else if(typeof subject?.runPrompt === 'string' && subject.runPrompt.trim()){
        const rebuilt = promptHtmlWithMentionTokens(subject.runPrompt, subject.runPromptRefs || []);
        if(rebuilt) promptInput.innerHTML = rebuilt;
        else setPromptText(subject.runPrompt);
    } else if(typeof subject?.text === 'string'){
        // Agent-created generation nodes persist their requested prompt in
        // node.text. They have no browser-side draft yet, so show that source
        // of truth when the configuration panel first opens.
        setPromptText(subject.text);
    } else {
        setPromptText('');
    }
}
function positionComposerForNode(node){
    if(!node) return;
    const rect = nodeRect(node);
    const gap = 14;
    const cardW = 540;
    const screenLeft = viewport.x + (rect.x + rect.width / 2) * viewport.scale - cardW / 2;
    const screenTop = viewport.y + (rect.y + rect.height) * viewport.scale + gap;
    composer.style.width = `${cardW}px`;
    composer.style.left = `${Math.round(screenLeft)}px`;
    composer.style.top = `${Math.round(screenTop)}px`;
}
function updateComposer(){
    const node = selectedNode();
    syncPrimaryRunButton(node);
    if(node?.id && suppressComposerForCandidateNodeId === node.id){
        composer.classList.remove('open');
        updateNodeShortcutBar();
        if(cascadeRunBtn) cascadeRunBtn.style.display = 'none';
        activeComposerSubject = null;
        lastComposerNodeId = '';
        suppressComposerForCandidateNodeId = '';
        return;
    }
    if(smartCascadeSilentSelection && !activeComposerSubject){
        composer.classList.remove('open');
        updateNodeShortcutBar();
        if(cascadeRunBtn) cascadeRunBtn.style.display = 'none';
        activeComposerSubject = null;
        lastComposerNodeId = '';
        return;
    }
    composer.classList.toggle('open', !!node);
    updateNodeShortcutBar();
    if(!isSmartImageNode(node) || isUploadedImageOnlyNode(node)){
        if(cascadeRunBtn) cascadeRunBtn.style.display = 'none';
        savePromptDraftForCurrent();
        composer.classList.remove('open');
        activeComposerSubject = null;
        lastComposerNodeId = '';
        setPromptInputLocked(false);
        if(!node) setPromptText('');
        return;
    }
    // composer 只绑定节点本身：图片只是素材/结果，不携带提示词或参数状态。
    const subject = node;
    const composerKey = `${node.id}:node`;
    const switchedNode = lastComposerNodeId !== composerKey;
    if(switchedNode) savePromptDraftForCurrent();
    lastComposerNodeId = composerKey;
    activeComposerSubject = subject;
    const hasPromptInput = promptInputNodesFor(node).length > 0;
    if(switchedNode){
        settings = smartSettingsForNode(subject);
        loadPromptDraft(subject);
    }
    const schemaKind = settings.apiKind === 'video' ? 'video' : 'image';
    const schemaProvider = schemaKind === 'video' ? settings.videoConnectionId : settings.connection_id;
    const schemaModel = schemaKind === 'video' ? settings.videoModel : settings.model;
    void refreshCanvasParameterSchema(schemaKind, schemaProvider, schemaModel);
    setPromptInputLocked(false);
    syncCascadeRunButton(node);
    positionComposerForNode(node);
    const ph = Math.max(60, Math.min(380, Number(settings.promptH) || 124));
    promptInput.style.setProperty('--prompt-h', `${ph}px`);
    syncComposerPromptVisibility();
    renderInputThumbsRow(node);
    renderInputPromptPreview(node);
    syncCascadeRunButton(node);
    updateProviderModels();
}
// M21 拆分（第一段）：positionPromptComposerForNode / promptComposerParamsHtml /
// renderPromptComposer / bindPromptComposerControls / updatePromptComposer /
// renderInputPromptPreview / rhInputKindLabel / rhInputKindIcon / renderRhInputThumb /
// inputVideoHoverPreviewHtml / inputThumbType / inputThumbLabel /
// renderRunningHubInputThumbsRow / inputThumbItemHtml / renderInputThumbsRow /
// renderPromptComposerThumbs / renderPromptComposerInputPreview / bindInputThumbsDrag /
// inputThumbDropPlacement / clearInputThumbDropMarkers / movedBeforeAfterIds /
// sameOrderedIds / reorderInputSourceNodes / reorderInputThumb 已迁移到
// frontend/src/canvas/mention-composer.js（经典 <script>，非 ES module，
// 原因同 M1-M20；注意跟 main.js 里仍保留的 updateComposer/
// positionComposerForNode——操作另一个 DOM 元素 composer，不是这里的
// promptComposer——是两个不同的面板，不要混淆）。
// M6 拆分：isSupportedUploadFile / dataTransferItemEntry / filesFromEntry /
// uploadFilesFromDataTransfer / uploadTitleForItems /
// SMART_IMAGE_DROP_EXT_RE / SMART_IMAGE_DROP_TEXT_TYPES /
// SMART_IMAGE_DROP_TYPE_HINT_RE / smartImageFilesFromDataTransfer
// 已迁移到 frontend/src/canvas/upload.js（经典 <script>，同上）。
// 注意：StorageQuotaSignal / quotaDataFromPayload /
// checkQuotaWarningFromResult / smartResponseError /
// smartResponseErrorMessage（紧接在下面）没有跟着搬走，它们是被
// cascade-run.js（M5）大量调用的通用错误处理/配额检查基础设施，
// 留在这里。
class StorageQuotaSignal extends Error {
    constructor(info){
        const data = info || {};
        super(data.detail || data.message || data.error || '存储空间不足');
        this.storageQuotaExceeded = true;
        this.quota_bytes = data.quota_bytes;
        this.used_bytes = data.used_bytes;
        this.incoming_bytes = data.incoming_bytes;
    }
}
class UsageBudgetSignal extends Error {
    constructor(info){
        const detail = info?.detail && typeof info.detail === 'object' ? info.detail : info;
        super(detail?.message || detail?.detail || '本月使用预算已用尽，暂时无法继续执行任务。');
        this.usageBudgetExceeded = true;
        this.contactAdmin = detail?.contact_admin !== false;
    }
}
function quotaDataFromPayload(payload){
    if(!payload || typeof payload !== 'object') return null;
    if(payload.error === 'storage_quota_exceeded') return payload;
    return null;
}
function budgetDataFromPayload(payload){
    if(!payload || typeof payload !== 'object') return null;
    const detail = payload.detail && typeof payload.detail === 'object' ? payload.detail : payload;
    if(detail.error_code === 'usage_budget_exceeded') return detail;
    const message = String(detail.message || detail.detail || payload.error || payload.message || '');
    return /(?:预算(?:已用尽|不足)|组织.*预算|个人.*预算)/.test(message)
        ? {...detail, message}
        : null;
}
function checkQuotaWarningFromResult(data){
    if(!data || typeof data !== 'object') return;
    const warning = data.quota_warning;
    if(warning && warning.quota_exceeded){
        try {
            window.MediaForgeUpload?.showQuotaDialog?.({
                quota_bytes: warning.quota_bytes,
                used_bytes: warning.used_bytes,
                incoming_bytes: warning.incoming_bytes,
            });
        } catch(_) {}
        return;
    }
    // No inline warning — check server quota asynchronously.
    fetch('/api/storage/usage').then(r => r.ok ? r.json() : null).then(usage => {
        if(!usage) return;
        const quota = Number(usage.quota_bytes || 0);
        const used = Number(usage.used_bytes || 0);
        if(quota > 0 && used >= quota){
            try {
                window.MediaForgeUpload?.showQuotaDialog?.({quota_bytes:quota, used_bytes:used});
            } catch(_) {}
        }
    }).catch(() => {});
}
async function smartResponseError(response, fallback='请求失败'){
    let payload = null;
    try { payload = await response.clone().json(); } catch(_) {}
    if(response.status === 413 && quotaDataFromPayload(payload)) return new StorageQuotaSignal(payload);
    const budget = budgetDataFromPayload(payload);
    if(budget) return new UsageBudgetSignal(budget);
    return new Error(await smartResponseErrorMessage(response, fallback, payload));
}
async function smartResponseErrorMessage(response, fallback='请求失败', prefetched){
    let data = prefetched;
    if(data === undefined){
        try { data = await response.clone().json(); } catch(_) { data = null; }
    }
    if(data && typeof data === 'object'){
        const detail = data.detail ?? data.error ?? data.message;
        if(detail && typeof detail === 'object') return detail.message || detail.detail || fallback;
        if(typeof detail === 'string') return detail || fallback;
        if(Array.isArray(detail)) return detail.map(item => item?.msg || item?.message || String(item)).join('\n') || fallback;
    }
    try {
        const text = await response.text();
        if(text) return text;
    } catch(_) {}
    return fallback;
}
// M6 拆分：smartDropDataTypes / readSmartDropData / decodeSmartDropText /
// smartDropTextFragments / uniqueSmartDropValues / smartDropTextCandidates /
// isRemoteSmartImageDropValue / isLocalSmartImageDropValue /
// smartLocalImagePathsFromDataTransfer / smartImageNameFromUrl /
// smartImageDropPayload / resolveSmartImageDropPayload /
// hasSmartImageDropData / hasSmartAssetDrag / hasMediaDrawerDrag /
// hasSmartInputThumbDrag / setSmartDropCopyEffect / uploadFiles /
// appendImagesToSmartNode / handleFiles / importSmartLocalImages /
// handleSmartImageDropPayload 已迁移到 frontend/src/canvas/upload.js
// （经典 <script>，非 ES module，原因同 M1-M5）。
function sizeForRun(sourceSettings=settings){
    return apiImageSize(sourceSettings.ratio || '1:1', sourceSettings.resolution || '1k', sourceSettings.customRatio || '', sourceSettings.customSize || '', sourceSettings.ratioMatched || '') || '1024x1024';
}
function expectedOutputSize(){
    if(settings.engine === 'comfy'){
        return {w:1024, h:1024};
    }
    if(settings.engine === 'runninghub') return {w:1024, h:1024};
    const sizeStr = sizeForRun();
    const parsed = parseSizeValue(sizeStr);
    if(parsed){
        return {w: Number(parsed.width) || 1024, h: Number(parsed.height) || 1024};
    }
    return {w:1024, h:1024};
}
function explicitRequestOutputSizeForPending(){
    if(isApiLikeEngine(settings.engine) && settings.apiKind !== 'video'){
        const parsed = parseSizeValue(sizeForRun());
        if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};
    }
    return null;
}
function pendingSizeFromImageRef(img){
    const w = Number(img?.natural_w || img?.width || 0);
    const h = Number(img?.natural_h || img?.height || 0);
    return w > 0 && h > 0 ? {w, h} : null;
}
function pendingSourceBoxSize(options={}){
    const sourceNode = options.sourceNode || null;
    if(sourceNode && (sourceNode.images || []).length){
        const rect = nodeRect(sourceNode);
        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};
    }
    const ref = (options.refs || []).find(img => img?.url);
    const refSize = pendingSizeFromImageRef(ref);
    if(refSize) return refSize;
    const refNode = ref?.nodeId ? nodes.find(n => n.id === ref.nodeId) : null;
    if(refNode){
        const rect = nodeRect(refNode);
        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};
    }
    return null;
}
function displayBoxFromNaturalSize(size){
    const layout = singleImageLayout(
        {natural_w:size?.w || size?.width || 1024, natural_h:size?.h || size?.height || 1024},
        {type:'smart-image', images:[{}]},
        MEDIA_NODE_DEFAULT_SCALE
    );
    return {w:layout.width, h:layout.height};
}
function pendingBaseBoxSize(options={}){
    const requestSize = explicitRequestOutputSizeForPending();
    if(requestSize) return displayBoxFromNaturalSize(requestSize);
    const sourceSize = pendingSourceBoxSize(options);
    if(sourceSize?.display) return {w:sourceSize.w, h:sourceSize.h};
    if(sourceSize) return displayBoxFromNaturalSize(sourceSize);
    return displayBoxFromNaturalSize(expectedOutputSize());
}
function pendingBoxSize(count, options={}){
    const base = pendingBaseBoxSize(options);
    if(options.candidatePool) return {w:Math.round(base.w), h:Math.round(base.h)};
    const aspect = base.w / Math.max(1, base.h);
    const c = Math.max(1, Number(count) || 1);
    if(c <= 1){
        return {w:Math.round(base.w), h:Math.round(base.h)};
    }
    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(c))));
    const rows = Math.ceil(c / cols);
    const cellMax = Math.max(96, Math.min(220, Math.max(base.w, base.h) * 0.42));
    let cellW, cellH;
    if(base.w >= base.h){
        cellW = cellMax;
        cellH = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax / aspect));
    } else {
        cellH = cellMax;
        cellW = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax * aspect));
    }
    const w = cols * (cellW + 8) + 16;
    const h = rows * (cellH + 8) + 16;
    return {w, h};
}
// M21 拆分（第二段）：mentionTokenHtml / promptHtmlWithMentionTokens /
// snapshotRunMeta / attachRunMeta / stripRunInputMeta / stripImageGenerationMeta /
// upstreamNodesForKinds / inputNodesFor / workflowInputNodesFor / imagesForNode /
// nodeHasReferenceContent / isSelfReferenceForNode / candidateInputImagesFor /
// defaultInputImagesFor / generatedUpstreamImagesFor / splitSmartPromptItems /
// outputImagesForNode / selfReferenceImagesForNode / textForNode /
// promptInputNodesFor / inputPromptTextFor / inputImagesFor / workflowInputImagesFor /
// isGeneratedResultNode / runInputRefsForNode / inputRefKey / blockedInputRefKeys /
// isInputRefBlocked / activeInputImagesFor / toggleInputRefBlocked /
// defaultReferenceImagesFor / lineConnectionsFor / connectedLineNodeIds /
// upstreamLineNodeIds / lineImagesFor / collectMentionedImagesFromPrompt /
// uniqueReferenceImages / visibleReferenceImagesFor / inputMentionCandidateImages /
// mentionCandidateThumbnailUrl / assetRegisteredUris / assetMentionCandidateImages /
// mentionCandidateImages / referenceImagesFor / closeMentionPicker / saveMentionRange /
// textBeforeCaret / renderMentionPicker / showMentionPicker /
// positionMentionPickerAtCaret / maybeOpenMentionPicker / insertMentionToken /
// collectPromptParts / originalPromptTextFromParts / buildPromptRequest 已迁移到
// frontend/src/canvas/mention-composer.js（经典 <script>，非 ES module，
// 原因同 M1-M20）。
// M4 拆分：outgoingConnectionsFor / outgoingInputConnectionsFor 已迁移到
// frontend/src/canvas/connections.js（经典 <script>，非 ES module，
// 原因同 M1/M2/M3）。
function nextOutputPositionForSource(sourceNode, pendingBox, options={}){
    const sourceRect = nodeRect(sourceNode);
    const x = (sourceRect.x || 0) + sourceRect.width + 80;
    const gap = 28;
    const outputs = outgoingConnectionsFor(sourceNode, ['input','flow'])
        .map(conn => nodes.find(n => n.id === conn.to))
        .filter(n => isSmartImageNode(n))
        .map(n => nodeRect(n))
        .filter(rect => Math.abs((rect.x || 0) - x) < Math.max(320, (pendingBox?.w || 260) + 120))
        .sort((a, b) => (a.y || 0) - (b.y || 0));
    if(!outputs.length) return {x, y:sourceRect.y || 0};
    let y = sourceRect.y || 0;
    for(const rect of outputs){
        const bottom = (rect.y || 0) + (rect.height || 0) + gap;
        if(y < bottom) y = bottom;
    }
    return {x, y};
}
function createPendingOutputFromSource(sourceNode, expectedCount, meta, options={}){
    const pendingBox = pendingBoxSize(expectedCount, {sourceNode, refs:options.refs || meta?.promptRefs || [], candidatePool:options.candidatePool});
    const pos = nextOutputPositionForSource(sourceNode, pendingBox);
    const output = {
        id:uid('smart'),
        type:'smart-image',
        x:pos.x,
        y:pos.y,
        title:'Image',
        images:[],
        pending:Math.max(1, Number(expectedCount) || 1),
        runStartedAt:nowMs(),
        runTimerHidden:false,
        w:pendingBox.w,
        h:pendingBox.h,
        scale:MEDIA_NODE_DEFAULT_SCALE,
        created_at:Date.now()
    };
    if(options.candidatePool) output.pendingCandidatePool = true;
    output._selectAfterRunId = options.selectOutput ? output.id : sourceNode.id;
    nodes.push(output);
    if(options.connectSource === false) addConnection(sourceNode.id, output.id, 'flow');
    else connectInputNode(sourceNode.id, output.id);
    attachRunMeta(output, options.stripInputMeta ? stripRunInputMeta(meta) : meta);
    selectedId = sourceNode.id;
    selectedImage = {nodeId:'', index:-1};
    return output;
}
function createParallelLoopOutputNode(templateNode, sourceNode, roundIndex, roundOffset=0){
    const rect = nodeRect(templateNode);
    const output = cloneSmartNode(templateNode, 0, 0);
    output.id = uid('smart');
    output.type = 'smart-image';
    output.x = (Number(templateNode.x) || 0) + (Number(rect.width) || 260) + 80;
    output.y = (Number(templateNode.y) || 0) + roundOffset * ((Number(rect.height) || 180) + 28);
    output.title = `Image ${roundIndex}`;
    output.images = [];
    output.pending = 0;
    output.running = false;
    output.created_at = Date.now();
    delete output.w;
    delete output.h;
    delete output.historyFor;
    delete output.isHistoryGroup;
    delete output.sourceNodeId;
    delete output.runAt;
    delete output.runPrompt;
    delete output.runModelPrompt;
    delete output.runPromptRefs;
    delete output.runInputRefs;
    nodes.push(output);
    connectInputNode(sourceNode.id, output.id);
    return output;
}
function loopOutputSlotsForRoot(rootNode){
    if(!rootNode?.id) return [];
    return downstreamNodesForId(rootNode.id)
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function loopOutputSlotForRound(rootNode, loopNode, roundIndex, slotIndex){
    if(!rootNode?.id) return null;
    const candidates = loopOutputSlotsForRoot(rootNode)
        .filter(node => node.sourceNodeId === rootNode.id)
        .filter(node => !loopNode?.id || !node.loopSourceId || node.loopSourceId === loopNode.id);
    const untagged = candidates.filter(node => !Number.isFinite(Number(node.loopRoundIndex)) && !Number.isFinite(Number(node.loopSlotIndex)));
    return candidates.find(node => Number(node.loopRoundIndex) === Number(roundIndex))
        || candidates.find(node => Number(node.loopSlotIndex) === Number(slotIndex))
        || untagged[Math.max(0, Number(slotIndex) || 0)]
        || null;
}
function tagLoopOutputSlot(output, rootNode, loopNode, roundIndex, slotIndex){
    if(!output) return output;
    output.sourceNodeId = rootNode?.id || output.sourceNodeId || '';
    output.loopSourceId = loopNode?.id || output.loopSourceId || '';
    output.loopRootId = rootNode?.id || output.loopRootId || '';
    output.loopRoundIndex = Number(roundIndex) || 0;
    output.loopSlotIndex = Math.max(0, Number(slotIndex) || 0);
    return output;
}
function createLoopOutputSlot(rootNode, roundIndex, roundOffset=0, options={}){
    const rootRect = nodeRect(rootNode);
    const output = cloneSmartNode(rootNode, 0, 0);
    output.id = uid('smart');
    output.type = 'smart-image';
    output.x = (Number(rootNode.x) || 0) + (Number(rootRect.width) || 260) + 80;
    output.title = `Image ${roundIndex}`;
    output.images = [];
    output.pending = options.pending ? Math.max(1, Number(options.pending) || 1) : 0;
    output.running = Boolean(options.pending);
    output.queued = Boolean(options.queued);
    if(options.pending){
        output.runStartedAt = nowMs();
        output.runTimerHidden = false;
    }
    output.created_at = Date.now();
    delete output.w;
    delete output.h;
    delete output.historyFor;
    delete output.isHistoryGroup;
    delete output.sourceNodeId;
    delete output.runAt;
    delete output.runPrompt;
    delete output.runModelPrompt;
    delete output.runPromptRefs;
    delete output.runInputRefs;
    delete output.runFinishedAt;
    delete output.runElapsedMs;
    tagLoopOutputSlot(output, rootNode, options.loopNode || null, roundIndex, options.slotIndex ?? roundOffset);
    const slots = loopOutputSlotsForRoot(rootNode).map(nodeRect);
    let y = (Number(rootNode.y) || 0) + roundOffset * ((Number(rootRect.height) || 180) + 28);
    slots.forEach(rect => {
        if((Number(rect.x) || 0) >= (Number(output.x) || 0) - 24){
            y = Math.max(y, (Number(rect.y) || 0) + (Number(rect.height) || 0) + 28);
        }
    });
    output.y = y;
    nodes.push(output);
    addConnection(rootNode.id, output.id, 'flow');
        const runPath = smartCascadePathForCtx(options.ctx || options.runState);
        if(runPath?.states) runPath.states[`${rootNode.id}->${output.id}`] = 'wait';
    return output;
}
function extractCurrentImagesToSource(node, meta=null){
    const imgs = (node.images || []).slice();
    if(!imgs.length) return null;
    const r = nodeRect(node);
    const newX = (node.x || 0) - Math.max(280, r.width + 60);
    const source = {
        id: uid('smart'),
        type: 'smart-image',
        x: newX,
        y: node.y || 0,
        title: imgs.length > 1 ? 'Group' : 'Image',
        // 抽出到上游源节点的图片只保留"原始素材"语义：清空 runPrompt / runSettings /
        // sourceNodeId / runAt / promptDraftHtml / promptDraftText 等"生成"相关字段，
        // 避免上游图片继承下游输出的提示词信息
        images: imgs.map(img => stripImageGenerationMeta({...img})),
        created_at: Date.now()
    };
    if(Number.isFinite(Number(node.w))) source.w = node.w;
    if(Number.isFinite(Number(node.h))) source.h = node.h;
    if(Number.isFinite(Number(node.scale))) source.scale = node.scale;
    nodes.push(source);
    connectInputNode(source.id, node.id);
    node.images = [];
    delete node.w;
    delete node.h;
    return source;
}
function finalizePendingNode(pendingNode, urls, meta, kind='image'){
    if(!pendingNode) return;
    if(!Number(pendingNode.pending || 0) && pendingNode.runFinishedAt) return;
    const imgs = normalizeOutputMediaItems(urls, kind, meta);
    const actualKind = mediaKindForUrls(imgs, kind);
    addGeneratedCandidatesToNode(pendingNode, imgs, {main:'firstNew'});
    pendingNode.pending = 0;
    delete pendingNode.pendingCandidatePool;
    pendingNode.runFinishedAt = nowMs();
    if(!pendingNode.runStartedAt) pendingNode.runStartedAt = meta?.createdAt || pendingNode.runFinishedAt;
    pendingNode.runElapsedMs = Math.max(0, pendingNode.runFinishedAt - Number(pendingNode.runStartedAt || pendingNode.runFinishedAt));
    pendingNode.runTimerHidden = false;
    const displayedKind = mediaKindForItem(pendingNode.images[0]) || actualKind;
    pendingNode.outputKind = displayedKind;
    pendingNode.title = cascadeOutputTitle(displayedKind, pendingNode.images.length);
    pendingNode.scale = mediaNodeDefaultScale(pendingNode);
    delete pendingNode.w;
    delete pendingNode.h;
    const metaTarget = pendingNode._runMetaTargetId ? nodes.find(n => n.id === pendingNode._runMetaTargetId) : pendingNode;
    if(metaTarget) attachRunMeta(metaTarget, meta);
    // Do not steal focus from a node the user opened while this task ran.
    // A freshly branched output remains selected only when it is still active.
    const completionTargetId = pendingNode._selectAfterRunId || pendingNode.id;
    if(!selectedId || selectedId === pendingNode.id || selectedId === completionTargetId) selectedId = completionTargetId;
    delete pendingNode._runMetaTargetId;
    delete pendingNode._selectAfterRunId;
    delete pendingNode._rerunPreviousImages;
    if(activeComposerSubject?.id && selectedId === activeComposerSubject.id) lastComposerNodeId = `${selectedId}:node`;
    selectedImage = {nodeId:'', index:-1};
}
function restoreFromExtraction(node, extracted){
    if(!node || !extracted) return;
    node.images = extracted.images.slice();
    if(Number.isFinite(Number(extracted.w))) node.w = extracted.w;
    if(Number.isFinite(Number(extracted.h))) node.h = extracted.h;
    nodes = nodes.filter(n => n.id !== extracted.id);
    canvas.connections = (canvas.connections || []).filter(c => !(c.from === extracted.id && c.to === node.id));
    if(Array.isArray(node.inputNodeIds)){
        node.inputNodeIds = node.inputNodeIds.filter(id => id !== extracted.id);
    }
}
function restoreSourceVisualState(node, state){
    if(!node || !state) return;
    node.images = (state.images || []).map(img => ({...img}));
    node.title = state.title || (node.images.length > 1 ? 'Group' : 'Image');
    ['w','h','scale','outputKind'].forEach(key => {
        if(state[key] === undefined) delete node[key];
        else node[key] = state[key];
    });
}
function finishLoopTargetPreviewState(node){
    if(!node) return;
    node.pending = 0;
    node.running = false;
    node.queued = false;
    delete node.pendingTasks;
    delete node.pendingCandidatePool;
    node.runFinishedAt = nowMs();
    if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;
    node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));
    node.runTimerHidden = false;
    if((node.images || []).some(img => img?.url)){
        node.title = node.images.length > 1 ? 'Group' : 'Image';
        node.scale = node.images.length > 1 ? MEDIA_GROUP_DEFAULT_SCALE : MEDIA_NODE_DEFAULT_SCALE;
        node.outputKind = mediaKindForUrls(node.images || [], (node.images || []).some(isVideoMediaItem) ? 'video' : 'image');
        delete node.w;
        delete node.h;
    }
}
function refsForDirectLoopRound(loopNode, loopIndex, total){
    if(!loopNode?.imageInput) return [];
    return outputImagesForNode(loopNode, true, {index:loopIndex, total, nodeId:loopNode.id})
        .filter(ref => ref?.url)
        .map((ref, index) => ({
            ...ref,
            role:ref.role || `image_${index + 1}`,
            name:ref.name || trf('canvas.loopImageLabel', {n:loopIndex + index})
        }));
}
function showDirectLoopRoundPreview(loopNode, target, refs, loopIndex, total){
    if(!loopNode?.imageInput || !isSmartImageNode(target)) return false;
    const cleanRefs = (refs || []).filter(ref => ref?.url);
    if(!cleanRefs.length) return false;
    const preview = cleanRefs.map((ref, index) => stripImageGenerationMeta({
        url:ref.url || '',
        name:ref.name || trf('canvas.loopImageLabel', {n:loopIndex + index}),
        kind:ref.kind || (isVideoMediaItem(ref) ? 'video' : 'image'),
        nodeId:ref.nodeId || '',
        imageIndex:ref.imageIndex ?? '',
        loopInputPreview:true
    })).filter(ref => ref.url);
    if(!preview.length) return false;
    target.images = preview;
    target.pending = 0;
    target.running = true;
    delete target.pendingCandidatePool;
    target.runStartedAt = nowMs();
    delete target.runFinishedAt;
    delete target.runElapsedMs;
    target.runTimerHidden = false;
    target.runInputRefs = cleanRefs.map(ref => ({
        url:ref.url || '',
        name:ref.name || '',
        nodeId:ref.nodeId || '',
        imageIndex:ref.imageIndex ?? '',
        kind:ref.kind || ''
    })).filter(ref => ref.url);
    target.outputKind = mediaKindForUrls(preview, preview.some(isVideoMediaItem) ? 'video' : 'image');
    target.scale = preview.length > 1 ? MEDIA_GROUP_DEFAULT_SCALE : MEDIA_NODE_DEFAULT_SCALE;
    target.title = total > 1 ? `Image ${loopIndex}/${total}` : (target.title || 'Image');
    delete target.w;
    delete target.h;
    render();
    return true;
}
function directImageInputsFor(node){
    const upstream = smartImageUsesWorkflowInput(node) ? workflowInputNodesFor(node) : inputNodesFor(node);
    return upstream
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n) && (n.images || []).some(img => img?.url))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function directImageInputsForKinds(node, kinds=['input']){
    const upstream = upstreamNodesForKinds(node, kinds);
    return upstream
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n) && (n.images || []).some(img => img?.url))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function primaryImageInputFor(node, options={}){
    const direct = options.includeFlow
        ? directImageInputsForKinds(node, ['input', 'flow'])[0]
        : directImageInputsFor(node)[0];
    if(direct) return direct;
    const inputs = options.includeFlow ? upstreamNodesForKinds(node, ['input', 'flow']) : (smartImageUsesWorkflowInput(node) ? workflowInputNodesFor(node) : inputNodesFor(node));
    const loop = inputs.find(n => n?.type === 'smart-loop');
    if(loop?.imageInput){
        const upstream = upstreamNodesForKinds(loop, options.includeFlow ? ['input', 'flow'] : ['input']).find(n => isSmartImageNode(n) && (n.images || []).some(img => img?.url));
        if(upstream) return upstream;
    }
    return null;
}
function hasDownstreamImageNode(node){
    return downstreamNodesForId(node?.id).some(n => isSmartImageNode(n) && !isHistoryGroupNode(n));
}
function isGeneratedOutputForNode(sourceNode, targetNode){
    return Boolean(sourceNode?.id && targetNode?.sourceNodeId === sourceNode.id);
}
function downstreamWorkflowImageTargetsFor(node){
    return downstreamImageTargetsFor(node).filter(target => !isGeneratedOutputForNode(node, target));
}
function hasDownstreamWorkflowImageNode(node){
    return downstreamWorkflowImageTargetsFor(node).length > 0;
}
function smartImageChainTo(nodeId, options={}){
    const tail = nodes.find(n => n.id === nodeId);
    if(!isSmartImageNode(tail) || isHistoryGroupNode(tail)) return [];
    const chain = [];
    const seen = new Set();
    let cur = tail;
    while(cur && !seen.has(cur.id)){
        seen.add(cur.id);
        chain.unshift(cur);
        cur = primaryImageInputFor(cur, options);
    }
    return chain;
}
function upstreamNodesForId(nodeId, kinds=['input']){
    const result = [];
    const seen = new Set([nodeId]);
    const walk = id => {
        upstreamNodesForKinds(nodes.find(n => n.id === id), kinds).forEach(input => {
            if(seen.has(input.id)) return;
            seen.add(input.id);
            walk(input.id);
            result.push(input);
        });
    };
    walk(nodeId);
    return result;
}
function resolveSmartCascadeLoop(nodeId){
    const loops = upstreamNodesForId(nodeId, ['input', 'flow']).filter(n => n.type === 'smart-loop');
    if(!loops.length) return null;
    const loop = loops[loops.length - 1];
    return {node:loop, count:smartLoopCount(loop), mode:loop.mode === 'parallel' ? 'parallel' : 'serial'};
}
function relayLoopPromptNodesForEdge(sourceNode, targetNode){
    if(!sourceNode?.id || !targetNode?.id) return [];
    const directLoopIds = new Set(promptInputNodesFor(targetNode).filter(n => n?.type === 'smart-loop' && n.showPrompt).map(n => n.id));
    return inputNodesFor(sourceNode)
        .filter(n => n?.type === 'smart-loop' && n.showPrompt && !directLoopIds.has(n.id));
}
function relayLoopPromptNodesForTarget(node){
    if(!node?.id) return [];
    return inputNodesFor(node).filter(n => n?.type === 'smart-loop' && n.showPrompt);
}
function downstreamNodesForId(nodeId){
    const result = [];
    const seen = new Set([nodeId]);
    const walk = id => {
        (canvas?.connections || [])
            .filter(conn => conn.from === id && ['input','flow'].includes(conn.kind || 'flow'))
            .map(conn => nodes.find(n => n.id === conn.to))
            .filter(Boolean)
            .forEach(next => {
                if(seen.has(next.id)) return;
                seen.add(next.id);
                result.push(next);
                walk(next.id);
            });
    };
    walk(nodeId);
    return result;
}
function downstreamImageTargetsFor(node){
    if(!node?.id) return [];
    return (canvas?.connections || [])
        .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
        .map(conn => nodes.find(n => n.id === conn.to))
        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function downstreamCascadeTargetsFor(node){
    if(!node?.id) return [];
    return (canvas?.connections || [])
        .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))
        .map(conn => nodes.find(n => n.id === conn.to))
        .filter(n => n && !isHistoryGroupNode(n) && (isSmartImageNode(n) || n.type === 'smart-loop'))
        .sort((a, b) => {
            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
            if(ax !== bx) return ax - bx;
            return (Number(a.y) || 0) - (Number(b.y) || 0);
        });
}
function directLoopRunTargets(loop){
    if(!loop?.id) return [];
    return downstreamImageTargetsFor(loop)
        .filter(node => !hasDownstreamWorkflowImageNode(node));
}
function smartCascadeGraphForTail(tail){
    const path = smartImageChainTo(tail?.id, {includeFlow:true}).filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n));
    if(!path.length) return {root:null, path:[], edges:[], children:new Map()};
    const loop = resolveSmartCascadeLoop(tail?.id);
    const loopRoots = loop?.node?.id ? downstreamImageTargetsFor(loop.node) : [];
    const loopRoot = loopRoots.find(n => path.some(p => p.id === n.id));
    const lastAssetBeforeTail = path.slice(0, -1).findLastIndex(node => isSmartAssetImageNode(node));
    const pathRootIndex = lastAssetBeforeTail >= 0 ? lastAssetBeforeTail : 0;
    const pathRoot = path[pathRootIndex];
    const root = loopRoot || pathRoot;
    const tailId = tail?.id || '';
    const pathIds = new Set(path.slice(pathRootIndex).map(n => n.id));
    const edges = [];
    const children = new Map();
    const seenEdges = new Set();
    const visiting = new Set();
    const targetCanReachTail = target => {
        if(!target?.id) return false;
        if(target.id === tailId) return true;
        if(pathIds.has(target.id)) return true;
        return downstreamNodesForId(target.id).some(n => n.id === tailId || pathIds.has(n.id));
    };
    const walk = node => {
        if(!node?.id || visiting.has(node.id)) return;
        visiting.add(node.id);
        const targets = downstreamCascadeTargetsFor(node).filter(targetCanReachTail);
        children.set(node.id, targets);
        targets.forEach(target => {
            const key = `${node.id}->${target.id}`;
            if(!seenEdges.has(key)){
                seenEdges.add(key);
                edges.push({source:node, target, key});
            }
            walk(target);
        });
        visiting.delete(node.id);
    };
    walk(root);
    return {root, path, edges, children};
}
function cascadeTailForLoop(loopId){
    const loop = nodes.find(n => n.id === loopId && n.type === 'smart-loop');
    const directTargets = directLoopRunTargets(loop);
    if(directTargets.length) return directTargets[directTargets.length - 1];
    const directImages = downstreamImageTargetsFor({id:loopId});
    const directIds = new Set(directImages.map(n => n.id));
    const candidates = downstreamNodesForId(loopId)
        .filter(n => isSmartImageNode(n))
        .filter(n => !isHistoryGroupNode(n))
        .filter(n => canRunSmartCascade(n));
    if(!candidates.length) return null;
    return candidates.sort((a, b) => {
        const ad = directIds.has(a.id) ? 1 : 0;
        const bd = directIds.has(b.id) ? 1 : 0;
        if(ad !== bd) return ad - bd;
        const ax = Number(a.x) || 0, bx = Number(b.x) || 0;
        if(ax !== bx) return bx - ax;
        return (Number(b.y) || 0) - (Number(a.y) || 0);
    })[0];
}
function canRunSmartCascade(node){
    if(!isSmartImageNode(node) || isHistoryGroupNode(node)) return false;
    const graph = smartCascadeGraphForTail(node);
    const loop = resolveSmartCascadeLoop(node.id);
    if(loop && isDirectLoopTargetRun(loop, node, graph)) return true;
    if(hasDownstreamImageNode(node)) return false;
    if(graph.edges.length) return true;
    return Boolean(loop);
}
function isDirectLoopTargetRun(loop, tail, graph){
    if(!loop?.node?.id || !tail?.id) return false;
    if(graph?.root?.id !== tail.id) return false;
    if(hasDownstreamWorkflowImageNode(tail)) return false;
    return downstreamImageTargetsFor(loop.node).some(node => node.id === tail.id);
}
function cascadeConnectionKeys(){
    const keys = new Set();
    const addKey = (from, to) => {
        if(from && to) keys.add(`${from}->${to}`);
    };
    const activeLoopIds = new Set(smartCascadeRuns.keys());
    const loops = activeLoopIds.size
        ? nodes.filter(n => n?.type === 'smart-loop' && activeLoopIds.has(n.id))
        : nodes.filter(n => n?.type === 'smart-loop');
    loops.forEach(loop => {
        const tail = cascadeTailForLoop(loop.id);
        if(!tail) return;
        const graph = smartCascadeGraphForTail(tail);
        if(!graph.root) return;
        const chainIds = new Set(graph.path.map(n => n.id));
        graph.edges.forEach(edge => addKey(edge.source.id, edge.target.id));
        (canvas?.connections || []).forEach(conn => {
            if((conn.kind || 'flow') === 'history') return;
            const toNode = nodes.find(n => n.id === conn.to);
            if(conn.from === loop.id && (chainIds.has(conn.to) || downstreamNodesForId(conn.to).some(n => chainIds.has(n.id)))) addKey(conn.from, conn.to);
            if(toNode && chainIds.has(toNode.id)){
                inputNodesFor(toNode).filter(n => n?.type === 'smart-loop' && n.showPrompt).forEach(inputLoop => addKey(inputLoop.id, toNode.id));
            }
        });
    });
    return keys;
}
function coolRunButton(ms=2000){
    if(!runBtn) return 0;
    const token = ++runBtnCooldownToken;
    runBtn.disabled = true;
    setTimeout(() => {
        if(token === runBtnCooldownToken && !smartCascadeAnyRunning()) runBtn.disabled = false;
    }, ms);
    return token;
}
function coolNodeRunningState(node, ms=2000){
    if(!node) return 0;
    const token = ++smartRunStateToken;
    smartNodeRunTokens.set(node.id, token);
    node.running = true;
    setTimeout(() => {
        if(smartNodeRunTokens.get(node.id) !== token) return;
        smartNodeRunTokens.delete(node.id);
        const current = nodes.find(n => n.id === node.id);
        if(current){
            current.running = false;
            render();
        }
    }, ms);
    return token;
}
function clearNodeRunningState(node){
    if(!node) return;
    smartNodeRunTokens.delete(node.id);
    node.running = false;
}
function pushRightSideNodes(sourceNode, delta){
    const shift = Math.ceil(Number(delta) || 0);
    if(!sourceNode || shift <= 0) return;
    const sourceRight = (Number(sourceNode.x) || 0) + nodeRect(sourceNode).width - shift;
    const downstreamIds = new Set(downstreamNodesForId(sourceNode.id).map(n => n.id));
    nodes.forEach(n => {
        if(!n || n.id === sourceNode.id) return;
        const r = nodeRect(n);
        const shouldShift = downstreamIds.has(n.id) || (Number(r.x) > sourceRight && Math.abs((Number(r.y) || 0) - (Number(sourceNode.y) || 0)) < 520);
        if(shouldShift) n.x = (Number(n.x) || 0) + shift;
    });
}
function cascadeOutputTitle(kind='image', count=1){
    if(Number(count) > 1) return kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audios' : kind === 'text' ? 'Texts' : 'Group';
    return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'text' ? 'Text' : kind === 'file' ? 'File' : 'Image';
}
function cleanHistoryImages(images=[]){
    const seen = new Set();
    return (images || [])
        .filter(img => img?.url)
        .map(img => stripImageGenerationMeta({...img}))
        .filter(img => {
            const identity = img.file_id || img.fileId || img.url || '';
            const key = `${img.kind || ''}|${identity}`;
            if(seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}
function uniqueGeneratedImages(images=[]){
    const seen = new Set();
    return (images || [])
        .filter(img => img?.url)
        .map(img => ({...img}))
        .filter(img => {
            const identity = img.file_id || img.fileId || img.url || '';
            const key = `${img.kind || ''}|${identity}`;
            if(seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}
function hasHistoryConnection(nodeId, groupId){
    return Boolean(nodeId && groupId && (canvas?.connections || []).some(conn => conn.from === nodeId && conn.to === groupId && (conn.kind || 'flow') === 'history'));
}
function demoteHistoryGroupNode(group){
    if(!group) return;
    delete group.historyFor;
    delete group.isHistoryGroup;
    if(group.title === '历史分组'){
        const count = (group.images || []).length;
        group.title = count > 1 ? 'Group' : (count ? 'Image' : tr('smart.createGenerationNode'));
    }
}
function historyGroupForNode(node){
    if(!node?.id) return null;
    let matched = null;
    nodes.forEach(n => {
        if(!isHistoryGroupNode(n) || n.historyFor !== node.id) return;
        if(hasHistoryConnection(node.id, n.id)){
            if(!matched) matched = n;
        } else {
            demoteHistoryGroupNode(n);
        }
    });
    return matched;
}
function positionHistoryGroupForNode(node, group){
    if(!node || !group) return;
    const r = nodeRect(node);
    const gr = nodeRect(group);
    if(!Number.isFinite(Number(group.x))) group.x = Math.round((Number(node.x) || 0) + Math.max(0, (r.width - gr.width) / 2));
    if(!Number.isFinite(Number(group.y))) group.y = Math.round((Number(node.y) || 0) + r.height + 56);
}
function ensureHistoryGroupForNode(node){
    if(!node?.id) return null;
    let group = historyGroupForNode(node);
    if(!group){
        const r = nodeRect(node);
        group = {
            id:uid('smart'),
            type:'smart-image',
            x:Math.round(Number(node.x || 0)),
            y:Math.round(Number(node.y || 0) + r.height + 56),
            title:'历史分组',
            images:[],
            historyFor:node.id,
            isHistoryGroup:true,
            scale:MEDIA_GROUP_DEFAULT_SCALE,
            created_at:Date.now()
        };
        nodes.push(group);
    }
    group.type = 'smart-image';
    group.title = '历史分组';
    group.isHistoryGroup = true;
    group.historyFor = node.id;
    if(!Number.isFinite(Number(group.scale))) group.scale = MEDIA_GROUP_DEFAULT_SCALE;
    addConnection(node.id, group.id, 'history');
    positionHistoryGroupForNode(node, group);
    return group;
}
function replaceOutputsToNodeWithHistory(node, additions, kind='image', meta=null, options={}){
    if(!node || !additions?.length) return [];
    const beforeRight = (Number(node.x) || 0) + nodeRect(node).width;
    const existing = uniqueGeneratedImages(node.images || []);
    const next = uniqueGeneratedImages(additions)
        .map(img => meta ? generatedImageWithRunMeta(img, meta) : img);
    if(!next.length) return [];
    if(existing.length) addGeneratedCandidatesToNode(node, existing, {main:'preserve'});
    addGeneratedCandidatesToNode(node, next, {main:'firstNew'});
    node.pending = 0;
    node.running = false;
    delete node.pendingCandidatePool;
    delete node.pendingTasks;
    node.runFinishedAt = nowMs();
    if(!node.runStartedAt) node.runStartedAt = meta?.createdAt || node.runFinishedAt;
    node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));
    node.runTimerHidden = false;
    const displayedKind = mediaKindForItem(node.images[0]) || kind;
    node.outputKind = displayedKind;
    node.title = cascadeOutputTitle(displayedKind, node.images.length);
    node.scale = mediaNodeDefaultScale(node);
    delete node.w;
    delete node.h;
    if(meta) attachRunMeta(node, meta);
    const afterRight = (Number(node.x) || 0) + nodeRect(node).width;
    const skipShift = options.skipShift || Boolean(smartLoopContext?.nodeId);
    if(!skipShift) pushRightSideNodes(node, afterRight - beforeRight + 36);
    selectedImage = {nodeId:'', index:-1};
    return next;
}
function appendOutputsToNode(node, additions, kind='image', options={}){
    if(!node || !additions?.length) return [];
    const beforeRight = (Number(node.x) || 0) + nodeRect(node).width;
    const existing = (node.images || []).filter(img => img?.url).map(img => stripImageGenerationMeta(img));
    const next = additions.map(img => stripImageGenerationMeta({...img}));
    node.images = [...existing, ...next];
    node.pending = 0;
    node.running = false;
    delete node.pendingCandidatePool;
    node.runFinishedAt = nowMs();
    if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;
    node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));
    node.runTimerHidden = false;
    node.outputKind = kind;
    node.title = node.images.length > 1 ? (kind === 'video' ? 'Videos' : kind === 'audio' ? 'Audios' : kind === 'text' ? 'Texts' : 'Group') : (kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : kind === 'text' ? 'Text' : kind === 'file' ? 'File' : 'Image');
    delete node.w;
    delete node.h;
    const afterRight = (Number(node.x) || 0) + nodeRect(node).width;
    const skipShift = options.skipShift || Boolean(smartLoopContext?.nodeId);
    if(!skipShift) pushRightSideNodes(node, afterRight - beforeRight + 36);
    return next;
}
function syncCascadeRunButton(node=selectedNode()){
    if(!cascadeRunBtn) return;
    const visible = canRunSmartCascade(node);
    cascadeRunBtn.style.display = visible ? 'inline-flex' : 'none';
    const nodeLoopId = resolveSmartCascadeLoop(node?.id)?.node?.id || '';
    const loopRunState = smartCascadeRunForLoop(nodeLoopId);
    const runningForNode = Boolean(loopRunState);
    cascadeRunBtn.disabled = !visible || (!runningForNode && Boolean(node?.running)) || Boolean(loopRunState?.stopRequested);
    cascadeRunBtn.classList.toggle('is-stop', runningForNode);
    cascadeRunBtn.innerHTML = runningForNode
        ? `<i data-lucide="square"></i><span>${escapeHtml(smartCascadeStopText(Boolean(loopRunState?.stopRequested)))}</span>`
        : `<i data-lucide="workflow"></i><span>${escapeHtml(tr('smart.loopRunAll'))}</span>`;
    refreshIcons();
}
function loadNodePromptDraftToInput(node){
    if(node?.promptDraftHtml) {
        const hasToken = String(node.promptDraftHtml || '').includes('mention-image-token');
        promptInput.innerHTML = hasToken
            ? node.promptDraftHtml
            : (promptHtmlWithMentionTokens(node.runPrompt || node.promptDraftText || '', node.runPromptRefs || []) || node.promptDraftHtml);
    } else {
        const rebuilt = promptHtmlWithMentionTokens(node?.runPrompt || '', node?.runPromptRefs || []);
        if(rebuilt) promptInput.innerHTML = rebuilt;
        else setPromptText(node?.runPrompt || node?.text || '');
    }
}
// M5 拆分（第2批）：createSmartComfyTask / waitSmartComfyTaskResult /
// runQueuedSmartComfyGenerate / comfyParamsFromWorkflowValues
// 已迁移到 frontend/src/canvas/cascade-run.js（经典 <script>，同上）。
function buildPromptRequestForNode(node, defaultImages, ctx=smartLoopContext){
    const oldHtml = promptInput.innerHTML;
    loadNodePromptDraftToInput(node);
    try {
        return buildPromptRequest(node, defaultImages, false, ctx);
    } finally {
        promptInput.innerHTML = oldHtml;
    }
}
async function generateUrlsForCurrentSettings(node, prompt, refs, runSettings=settings){
    const activeSettings = runSettings || settings;
    if(activeSettings.engine === 'comfy') return generateComfyUrlsWithSettings(activeSettings, prompt, refs);
    if(isApiLikeEngine(activeSettings.engine) && activeSettings.apiKind === 'video'){
        const videoResult = await runApiVideoGeneration(prompt, refs, activeSettings);
        return {urls:videoResult.urls || videoResult, kind:'video', tasks:videoResult.taskId ? [{taskId:videoResult.taskId, upstreamTaskId:videoResult.upstreamTaskId || '', outputs:(videoResult.urls || [])}] : null};
    }
    if(isApiLikeEngine(activeSettings.engine)){
        const taskResult = await runApiGeneration(prompt, refs, activeSettings);
        const taskIds = Array.isArray(taskResult?.taskIds) ? taskResult.taskIds : [];
        if(taskIds.length){
            const settled = await Promise.all(taskIds.map(taskId => pollCanvasTask(taskId)));
            const tasks = taskIds.map((taskId, i) => {
                const result = settled[i];
                const urls = resultMediaUrls(result?.images || result).filter(Boolean);
                return {taskId, upstreamTaskId:(result && (result.task_id || result.upstream_task_id)) || '', outputs:urls};
            });
            const urls = tasks.flatMap(task => task.outputs).filter(Boolean);
            return {urls, kind:mediaKindForUrls(urls, 'image'), tasks};
        }
        const urls = resultMediaUrls(taskResult);
        return {urls, kind:mediaKindForUrls(urls, 'image')};
    }
    const urls = activeSettings.engine === 'runninghub'
        ? (await Promise.all(Array.from({length:workflowTaskCount(activeSettings)}, () => runRunningHubGeneration(prompt, refs, activeSettings)))).flat()
        : [];
    return {urls, kind:mediaKindForUrls(urls, 'image')};
}
async function generateComfyUrlsWithSettings(runSettings, prompt, refs){
    const allRefs = refs || [];
    const imageRefs = imageRefsOnly(allRefs);
    const workflowName = runSettings.comfyWorkflow || comfyWorkflows[0]?.name || '';
    if(!workflowName) throw new Error(tr('smart.errNeedWorkflow'));
    const wf = await fetch(`/api/workflows/${encodeURIComponent(workflowName)}`).then(async r => {
        if(!r.ok) throw await smartResponseError(r);
        return r.json();
    });
    const fields = wf.config?.fields || [];
    const values = {};
    fields.filter(f => comfyFieldKind(f) === 'prompt').forEach((field, index) => {
        values[field.id] = index === 0 ? prompt : (field.default ?? '');
    });
    const assignMediaFields = async (mediaFields, mediaRefs) => {
        for(let i = 0; i < mediaFields.length && i < mediaRefs.length; i++){
            values[mediaFields[i].id] = await comfyNameForRef(mediaRefs[i]);
        }
    };
    await assignMediaFields(fields.filter(f => comfyFieldKind(f) === 'image'), imageRefs);
    await assignMediaFields(fields.filter(f => comfyFieldKind(f) === 'video'), videoRefsOnly(allRefs));
    await assignMediaFields(fields.filter(f => comfyFieldKind(f) === 'audio'), audioRefsOnly(allRefs));
    fields.filter(f => comfyFieldKind(f) === 'setting').forEach(field => {
        values[field.id] = runSettings.comfyParams?.[field.id] ?? field.default;
    });
    const runTask = async () => {
        const taskValues = {...values};
        fields.filter(f => comfyFieldKind(f) === 'setting' && comfyRandomEnabledField(f) && smartComfyRandomActiveFor(runSettings, f.id))
            .forEach(field => { taskValues[field.id] = smartComfyRandomValue(field); });
        return runQueuedSmartComfyGenerate({prompt, workflow_json:workflowName, params:comfyParamsFromWorkflowValues(wf.config || {fields:[]}, taskValues), type:'workflow-custom', client_id:smartClientId});
    };
    const results = await Promise.all(Array.from({length:workflowTaskCount(runSettings)}, runTask));
    const urls = results.flatMap(result => resultMediaUrls(result));
    const fallbackKind = results.some(result => result?.videos?.length) ? 'video' : results.some(result => result?.audios?.length) ? 'audio' : results.some(result => result?.texts?.length) ? 'text' : 'image';
    const tasks = results.map(result => {
        const taskId = (result && (result.task_id || result.prompt_id)) || '';
        return taskId ? {taskId, upstreamTaskId:(result && result.prompt_id) || '', outputs:resultMediaUrls(result)} : null;
    }).filter(Boolean);
    return {urls, kind:mediaKindForUrls(urls, fallbackKind), tasks:tasks.length ? tasks : null};
}
// M5 拆分（第3批）：runCascadeStepIntoNode / runLoopRoundIntoSlot /
// runClonedLoopChain / appendCascadeRefsToReceiver / cascadeRefsFromOutputs /
// smartCascadeStopText / runSmartCascade / runSmartCascadeFromLoop /
// runGeneration 已迁移到 frontend/src/canvas/cascade-run.js
// （经典 <script>，非 ES module，原因同 M1-M4）。这是 M5 里体量最大、
// 嵌套最深的一批，单独逐行核对过字节级一致性。
async function runPromptLLMNode(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'smart-prompt') return;
    const task = ['llm', 'caption', 'expand'].includes(node.llmTask) ? node.llmTask : 'llm';
    const mediaRefs = promptNodeInputMediaForLLM(node);
    const images = imageRefsOnly(mediaRefs).map(img => img.url).filter(Boolean);
    const videos = videoRefsOnly(mediaRefs).map(video => video.url).filter(Boolean);
    if(task === 'caption' && !images.length){ toast(tr('smart.promptCaptionNeedImage')); return; }
    // 上游提示词节点的文本（支持提示词节点输入提示词节点，逻辑与生成节点一致）。
    const upstreamPrompt = inputPromptTextFor(node).trim();
    const ownText = (node.llmInstruction || node.text || '').trim();
    const captionInstruction = [upstreamPrompt, (node.llmInstruction || '').trim()].filter(Boolean).join('\n\n').trim();
    const message = task === 'caption'
        ? (captionInstruction || '请描述这张图片')
        : [upstreamPrompt, ownText].filter(Boolean).join('\n\n').trim();
    if(!message){ toast(tr('smart.promptLlmNeedText')); return; }
    node.running = true;
    render();
    try {
        const legacyProvider = resolveChatProviderId(node.llmProvider || '');
        const legacyModel = resolveChatModel(node.llmModel || '', legacyProvider);
        const stable = node.llmConnectionId && node.llmModelId
            ? {connection_id: node.llmConnectionId, model_id: node.llmModelId}
            : stableCanvasTarget('chat', legacyProvider, legacyModel);
        if(!stable.connection_id || !stable.model_id){
            toast('提示词节点未配置有效的连接和模型');
            return;
        }
        const systemPrompt = task === 'caption'
            ? smartRuleTemplateContent('caption', node.captionTemplateId, '请详细描述这张图片的内容。')
            : task === 'expand'
            ? smartRuleTemplateContent('expand', node.expandTemplateId, '')
            : '';
        const requestImages = task === 'expand' ? [] : images;
        const requestVideos = task === 'llm' ? videos : [];
        const result = await fetch('/api/canvas-llm', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                message,
                messages:[],
                images:requestImages,
                videos:requestVideos,
                connection_id:stable.connection_id,
                model_id:stable.model_id,
                system_prompt:systemPrompt
            })
        }).then(async r => {
            if(!r.ok) throw await smartResponseError(r);
            return r.json();
        });
        node.text = (result.text || '').trim();
        node.llmConnectionId = stable.connection_id;
        node.llmModelId = stable.model_id;
        delete node.llmProvider;
        delete node.llmModel;
        scheduleSave();
    } catch(e) {
        if(!handleTaskLimitSignal(e)) toast((e.message || tr('smart.promptLlmFailed')).slice(0, 160));
    } finally {
        node.running = false;
        render();
    }
}
// M5 拆分（第2批）：comfyFieldKind / runApiGeneration /
// submitRunningHubGeneration / pollRunningHubTask /
// runRunningHubGeneration / runApiVideoGeneration /
// urlToBase64 / sleep / runComfyGeneration /
// comfyNameForRef
// 已迁移到 frontend/src/canvas/cascade-run.js（经典 <script>，
// 非 ES module，原因同 M1-M4）。
function smartPendingTasks(node){
    if(!node || !Array.isArray(node.pendingTasks)) return [];
    return node.pendingTasks.filter(task => task && task.taskId);
}
function isRunningHubPendingTask(task){
    const provider = String(task?.providerId || task?.provider || task?.engine || '').toLowerCase();
    // RunningHub 标准模型 API（如 GPT-Image2）走通用 /api/canvas-image-tasks 流程，
    // 只有 AI 应用引擎提交的任务才带 mode 标记，走 /api/canvas-runninghub-tasks 本地任务轮询。
    // Old canvas records omitted providerId, so mode is the durable discriminator.
    return task?.mode === 'app' && (!provider || provider === 'runninghub');
}
function isComfyPendingTask(task){
    return task?.taskType === 'comfy'
        || String(task?.providerId || task?.provider || task?.engine || '').toLowerCase() === 'comfyui'
        // Tasks created before taskType was persisted can still be recovered.
        || /^canvas_comfy_/i.test(String(task?.taskId || ''));
}
function hasRunningHubPendingTask(){
    return nodes.some(node => smartPendingTasks(node).some(isRunningHubPendingTask));
}
class ImageTaskRecoverSignal extends Error {
    constructor(info){
        const data = info || {};
        super(data.message || '任务未丢失，可稍后手动查询结果');
        this.imageTaskRecover = true;
        this.taskId = data.taskId || data.task_id || '';
        this.recoverTaskId = data.recoverTaskId || data.upstream_task_id || data.task_id || '';
        this.providerId = data.providerId || data.provider_id || '';
        this.kind = data.kind || 'image';
    }
}
function extractUpstreamTaskId(text){
    const match = String(text || '').match(/(?:task_id|taskId|task id)\s*[=:：]\s*([A-Za-z0-9_.:-]+)/i);
    return match ? match[1] : '';
}
function handleStorageQuotaSignal(e){
    if(!(e && e.storageQuotaExceeded)) return false;
    try {
        window.MediaForgeUpload?.showQuotaDialog?.({
            quota_bytes:e.quota_bytes,
            used_bytes:e.used_bytes,
            incoming_bytes:e.incoming_bytes,
            detail:e.message
        });
    } catch(_) {
        toast((e.message || '存储空间不足').slice(0, 160));
    }
    return true;
}
function handleUsageBudgetSignal(e){
    if(!(e && e.usageBudgetExceeded)) return false;
    try {
        window.MediaForgeUpload?.showBudgetDialog?.({message:e.message});
    } catch(_) {
        toast((e.message || '本月使用预算已用尽，请联系管理员(@飞帆)。').slice(0, 160));
    }
    return true;
}
function handleTaskLimitSignal(e){
    return handleStorageQuotaSignal(e) || handleUsageBudgetSignal(e);
}
async function fetchImageTaskQuery(taskId, task={}){
    return fetch('/api/image-task-query', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({connection_id:task.connectionId || task.connection_id || '', resource_id:task.resourceId || task.resource_id || '', task_id:taskId})
    }).then(async r => {
        if(!r.ok) throw new Error(await smartResponseErrorMessage(r, '查询失败'));
        return r.json();
    });
}
async function querySmartImageTaskNow(nodeId, localTaskId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const task = smartPendingTasks(node).find(item => item.taskId === localTaskId) || smartRecoverableImageTask(node);
    if(!task || task.querying) return;
    const recoverTaskId = task.recoverTaskId || extractUpstreamTaskId(task.error || '');
    if(!recoverTaskId){
        toast('没有任务 ID，无法查询');
        return;
    }
    task.querying = true;
    task.recoverTaskId = recoverTaskId;
    render();
    try {
        const data = await fetchImageTaskQuery(recoverTaskId, task);
        if(data.status === 'succeeded'){
            task.failed = false;
            task.querying = false;
            finalizeSmartPendingTask(node, task.taskId, resultMediaUrls(data.images?.length ? data.images : data), task.kind || 'image');
            render();
            scheduleSave();
            return;
        }
        if(data.status === 'failed'){
            task.error = data.error || tr('smart.errRunFailed');
            toast(task.error.slice(0, 160));
        } else {
            task.error = data.message || '任务仍在生成中，请稍后再查询';
            toast(task.error);
        }
    } catch(e){
        task.error = e.message || '查询失败';
        toast(task.error.slice(0, 160));
    } finally {
        const latest = smartPendingTasks(node).find(item => item.taskId === localTaskId);
        if(latest) latest.querying = false;
        render();
        scheduleSave();
    }
}
async function pollCanvasTask(taskId){
    if(!taskId) throw new Error(tr('smart.errRunFailed'));
    if(activeSmartTaskPolls.has(taskId)) return activeSmartTaskPolls.get(taskId);
    const promise = (async () => {
        for(let i = 0; i < 900; i++){
            await new Promise(resolve => setTimeout(resolve, 2000));
            const task = await fetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`).then(async r => {
                if(!r.ok) throw await smartResponseError(r);
                return r.json();
            });
            if(task.status === 'succeeded'){
                checkQuotaWarningFromResult(task);
                return task.result || {};
            }
            if(task.status === 'failed'){
                if(task.error_code === 'storage_quota_exceeded' || task.status_code === 413) throw new StorageQuotaSignal(task);
                const budget = budgetDataFromPayload(task);
                if(budget) throw new UsageBudgetSignal(budget);
                const recoverTaskId = task.upstream_task_id || extractUpstreamTaskId(task.error || '');
                if(recoverTaskId) throw new ImageTaskRecoverSignal({taskId, recoverTaskId, kind:'image', message:task.error || tr('smart.errRunFailed')});
                throw new Error(task.error || tr('smart.errRunFailed'));
            }
        }
        throw new Error(tr('smart.errRunTimeout'));
    })();
    activeSmartTaskPolls.set(taskId, promise);
    try {
        return await promise;
    } finally {
        activeSmartTaskPolls.delete(taskId);
    }
}
async function pollCanvasComfyTask(taskId){
    if(!taskId) throw new Error(tr('smart.errRunFailed'));
    if(activeSmartTaskPolls.has(taskId)) return activeSmartTaskPolls.get(taskId);
    const promise = (async () => {
        for(let i = 0; i < 900; i++){
            await new Promise(resolve => setTimeout(resolve, 2000));
            const task = await fetch(`/api/canvas-comfy-tasks/${encodeURIComponent(taskId)}`).then(async r => {
                if(!r.ok) throw await smartResponseError(r);
                return r.json();
            });
            if(task.status === 'succeeded'){
                checkQuotaWarningFromResult(task);
                return task.result || {};
            }
            if(task.status === 'failed'){
                if(task.error_code === 'storage_quota_exceeded' || task.status_code === 413) throw new StorageQuotaSignal(task);
                const budget = budgetDataFromPayload(task);
                if(budget) throw new UsageBudgetSignal(budget);
                throw new Error(task.error || tr('smart.errRunFailed'));
            }
        }
        throw new Error(tr('smart.errRunTimeout'));
    })();
    activeSmartTaskPolls.set(taskId, promise);
    try {
        return await promise;
    } finally {
        activeSmartTaskPolls.delete(taskId);
    }
}
async function pollSmartPendingTask(task){
    if(isRunningHubPendingTask(task)) return pollRunningHubTask(task.taskId, task);
    if(isComfyPendingTask(task)) return pollCanvasComfyTask(task.taskId);
    return pollCanvasTask(task.taskId);
}
function finalizeSmartPendingTask(node, taskId, images, kind='image'){
    if(!node || !taskId) return [];
    const pendingTasks = smartPendingTasks(node);
    if(!pendingTasks.some(task => task.taskId === taskId)) return [];
    delete node.queued;
    node.pendingTasks = pendingTasks.filter(task => task.taskId !== taskId);
    node.pending = Math.max(0, Number(node.pending || 0) - 1);
    const additions = normalizeOutputMediaItems(images, kind, imageRunMetaForNodeFallback(node));
    const actualKind = mediaKindForUrls(additions, kind);
    if(additions.length) addGeneratedCandidatesToNode(node, additions, {main:'firstNew'});
    if(additions.length) node.outputKind = mediaKindForItem(node.images[0]) || actualKind;
    if(!node.pending && smartPendingTasks(node).length === 0){
        delete node.pendingTasks;
        delete node.pendingCandidatePool;
        node.runFinishedAt = nowMs();
        if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;
        node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));
        node.runTimerHidden = false;
        node.running = false;
        node.title = cascadeOutputTitle(mediaKindForItem(node.images[0]) || actualKind, node.images.length);
        node.scale = mediaNodeDefaultScale(node);
        delete node.w;
        delete node.h;
        delete node._rerunPreviousImages;
    }
    return additions;
}
async function resumeSmartPendingNode(node){
    const tasks = smartPendingTasks(node);
    if(!node || !tasks.length) return [];
    node.pending = Math.max(tasks.length, Number(node.pending || 0) || tasks.length);
    node.pendingCandidatePool = true;
    node.running = false;
    render();
    const failures = [];
    const settlements = [];
    await Promise.all(tasks.map(async task => {
        // `taskId` is the local canvas task_id for API/ComfyUI tasks; for
        // RunningHub app tasks it is the upstream id, and the local id (if any)
        // rides on `task.localTaskId`. Prefer the local id as the log key.
        const localTaskId = task.localTaskId || task.taskId || '';
        if(task.failed && task.recoverTaskId){
            settlements.push({taskId:localTaskId, upstreamTaskId:task.upstreamTaskId || (task.localTaskId ? task.taskId : ''), outputs:[], error:task.error || tr('smart.errRunFailed')});
            return;
        }
        try {
            const result = await pollSmartPendingTask(task);
            const upstreamFromResult = (result && typeof result === 'object' && (result.task_id || result.upstream_task_id)) || '';
            const upstreamTaskId = task.upstreamTaskId || (task.localTaskId ? task.taskId : '') || upstreamFromResult || '';
            const additions = finalizeSmartPendingTask(node, task.taskId, resultMediaUrls(result?.images?.length ? result.images : result), task.kind || 'image');
            settlements.push({taskId:localTaskId, upstreamTaskId, outputs:(additions || []).filter(img => img && img.url).map(img => ({url:img.url, file_id:img.file_id || '', kind:img.kind || '', poster_url:img.poster_url || '', thumbnail_url:img.thumbnail_url || ''}))});
            render();
            scheduleSave();
        } catch(e) {
            if(e && e.imageTaskRecover && e.recoverTaskId){
                task.failed = true;
                task.querying = false;
                task.recoverTaskId = e.recoverTaskId;
                task.error = e.message || tr('smart.errRunFailed');
                node.running = false;
                node.pending = Math.max(1, smartPendingTasks(node).length);
                node.pendingCandidatePool = true;
                toast('任务未丢失，可稍后手动查询结果');
                render();
                scheduleSave();
                settlements.push({taskId:localTaskId, upstreamTaskId:task.upstreamTaskId || (task.localTaskId ? task.taskId : ''), outputs:[], error:task.error});
                return;
            }
            node.pendingTasks = smartPendingTasks(node).filter(item => item.taskId !== task.taskId);
            node.pending = Math.max(0, Number(node.pending || 0) - 1);
            if(!node.pending && smartPendingTasks(node).length === 0){
                delete node.pendingTasks;
                delete node.pendingCandidatePool;
                node.running = false;
                if(!(node.images || []).length){
                    if(candidateCountForNode(node)) setNodeMainCandidate(node, Number(node.candidateIndex) || 0);
                    else {
                        delete node.w;
                        delete node.h;
                    }
                }
            }
            failures.push(e);
            settlements.push({taskId:localTaskId, upstreamTaskId:task.upstreamTaskId || (task.localTaskId ? task.taskId : ''), outputs:[], error:e.message || String(e)});
            if(!handleTaskLimitSignal(e)) toast((e.message || tr('smart.errRunFailed')).slice(0, 160));
            render();
            scheduleSave();
        }
    }));
    node._smartRunSettlements = settlements;
    if(failures.length && !(node.images || []).length && candidateCountForNode(node)) setNodeMainCandidate(node, Number(node.candidateIndex) || 0);
    if(failures.length && !(node.images || []).length){
        const quotaFailure = failures.find(e => e && e.storageQuotaExceeded);
        if(quotaFailure) throw quotaFailure;
        const messages = [...new Set(failures.map(e => (e?.message || String(e || '')).trim()).filter(Boolean))];
        throw new Error(messages.join('；') || tr('smart.errRunFailed'));
    }
    return settlements;
}
function resumeSmartPendingTasks(){
    nodes.filter(node => smartPendingTasks(node).length).forEach(node => {
        resumeSmartPendingNode(node);
    });
}
function updateSelectionBox(event){
    if(!selectionState) return;
    const shellRect = shell.getBoundingClientRect();
    const sx = selectionState.startScreen.x, sy = selectionState.startScreen.y;
    const x = Math.min(sx, event.clientX), y = Math.min(sy, event.clientY);
    const currentWorld = screenToWorld(event);
    selectionState.currentWorld = currentWorld;
    selectionBox.style.display = 'block';
    selectionBox.style.left = `${x - shellRect.left}px`;
    selectionBox.style.top = `${y - shellRect.top}px`;
    selectionBox.style.width = `${Math.abs(event.clientX - sx)}px`;
    selectionBox.style.height = `${Math.abs(event.clientY - sy)}px`;
    selectedIds = nodesInSelectionBounds(selectionState.startWorld, currentWorld);
    selectedId = '';
    selectedImage = {nodeId:'', index:-1};
    syncSelectionUi();
    const boxLeft = x - shellRect.left;
    const boxRight = Math.max(sx, event.clientX) - shellRect.left;
    const boxTop = y - shellRect.top;
    positionSelectionActions(boxLeft, boxTop, boxRight, selectedIds.length);
}
function nodesInSelectionBounds(a, b){
    const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
    const maxX = Math.max(a.x, b.x), maxY = Math.max(a.y, b.y);
    return nodes.filter(node => {
        const rect = nodeRect(node);
        return rect.x < maxX && rect.x + rect.width > minX && rect.y < maxY && rect.y + rect.height > minY;
    }).map(node => node.id);
}
function positionSelectionActions(left, top, right, selectedCount){
    if(!selectionActions) return;
    selectionActions.hidden = selectedCount < 2;
    if(selectionActions.hidden) return;
    const selectionCenter = (left + right) / 2;
    const actionLeft = Math.max(8, Math.min(shell.clientWidth - selectionActions.offsetWidth - 8, selectionCenter - selectionActions.offsetWidth / 2));
    const actionTop = Math.max(selectionActions.offsetHeight + 8, top - 8);
    selectionActions.style.left = `${Math.round(actionLeft)}px`;
    selectionActions.style.top = `${Math.round(actionTop)}px`;
    const saveButton = selectionActions.querySelector('[data-selection-action="save"]');
    if(saveButton) saveButton.disabled = !selectedAssetSaveItems().length;
    const groupButton = selectionActions.querySelector('[data-selection-action="group"]');
    if(groupButton) groupButton.disabled = !selectedIds.some(id => !isSmartGroupNode(nodes.find(node => node.id === id)));
    const downloadAllButton = selectionActions.querySelector('[data-selection-action="download-all"]');
    if(downloadAllButton){
        const hasDownloadable = selectedIds.some(id => {
            const node = nodes.find(n => n.id === id);
            if(!node) return false;
            const imgs = node.type === 'smart-group' ? imagesForNode(node) : (node.images || []);
            return imgs.some(img => img?.url && !isMaskImageItem(img));
        });
        downloadAllButton.disabled = !hasDownloadable;
    }
}
function updateSelectionActions(){
    if(!selectionBox || !selectionActions || selectionState) return;
    const selectedEls = selectedIds.map(id => world.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
    if(!selectedEls.length){
        selectionBox.style.display = 'none';
        selectionActions.hidden = true;
        return;
    }
    const shellRect = shell.getBoundingClientRect();
    const rects = selectedEls.map(el => el.getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left)) - shellRect.left;
    const top = Math.min(...rects.map(rect => rect.top)) - shellRect.top;
    const right = Math.max(...rects.map(rect => rect.right)) - shellRect.left;
    const bottom = Math.max(...rects.map(rect => rect.bottom)) - shellRect.top;
    selectionBox.style.display = 'block';
    selectionBox.style.left = `${Math.round(left)}px`;
    selectionBox.style.top = `${Math.round(top)}px`;
    selectionBox.style.width = `${Math.round(right - left)}px`;
    selectionBox.style.height = `${Math.round(bottom - top)}px`;
    positionSelectionActions(left, top, right, selectedEls.length);
    refreshIcons();
}
function finishSelection(event){
    if(!selectionState) return;
    selectedIds = nodesInSelectionBounds(selectionState.startWorld, selectionState.currentWorld || screenToWorld(event));
    selectedId = '';
    selectedImage = {nodeId:'', index:-1};
    selectionState = null;
    selectionJustFinished = true;
    render();
    updateSelectionActions();
    setTimeout(() => { selectionJustFinished = false; }, 0);
}
function selectionActionsMousedownHandler(event){
    event.preventDefault();
    event.stopPropagation();
}
selectionActions?.addEventListener('mousedown', selectionActionsMousedownHandler);
function selectionActionsClickHandler(event){
    const button = event.target.closest('[data-selection-action]');
    if(!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if(button.dataset.selectionAction === 'group') groupSelectedNodes();
    if(button.dataset.selectionAction === 'export') openCanvasWorkflowTransferModal();
    if(button.dataset.selectionAction === 'download-all') void downloadSelectedNodesImages();
    if(button.dataset.selectionAction === 'save'){
        openSelectionAssetSaveModal().catch(err => showErrorModal(err.message || '保存到资产库失败', '保存到资产库失败'));
    }
}
selectionActions?.addEventListener('click', selectionActionsClickHandler);
// 框选状态下下载全部选中节点里的图片（打包 zip）。
async function downloadSelectedNodesImages(){
    const ids = selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
    const items = [];
    const seen = new Set();
    ids.map(id => nodes.find(n => n.id === id)).filter(Boolean).forEach(node => {
        const imgs = (node.type === 'smart-group' ? imagesForNode(node) : (node.images || []));
        imgs.filter(img => img?.url && !isMaskImageItem(img)).forEach(img => {
            const key = img.file_id || img.url;
            if(seen.has(key)) return;
            seen.add(key);
            items.push(img);
        });
    });
    if(!items.length){ toast('选中的节点里没有可下载的图片'); return; }
    if(items.length === 1){ downloadPreviewFile(items[0]); return; }
    try {
        const filename = safeExportFileName('canvas-selection.zip', 'canvas-selection.zip');
        const response = await fetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                filename,
                urls:items.map(item => fileDownloadUrl(item) || item.url).filter(Boolean),
                items:items.map((item, index) => ({url:fileDownloadUrl(item) || item.url, name:downloadNameForMediaItem(item, `image-${String(index + 1).padStart(2, '0')}`)}))
            })
        });
        if(!response.ok) throw new Error((await response.text()) || '批量下载失败');
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(href), 1200);
    } catch(e) {
        toast((e.message || '批量下载失败').slice(0, 160));
    }
}
function groupSelectedNodes(){
    const ids = selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
    const selected = ids.map(id => nodes.find(n => n.id === id)).filter(n => n && !isSmartGroupNode(n));
    if(selected.length < 1){ toast('请选择要放入分组的节点'); return; }
    pushUndo();
    const rects = selected.map(nodeRect);
    const minX = Math.min(...rects.map(r => r.x));
    const minY = Math.min(...rects.map(r => r.y));
    const maxX = Math.max(...rects.map(r => r.x + r.width));
    const maxY = Math.max(...rects.map(r => r.y + r.height));
    const group = {
        id:uid('group'),
        type:'smart-group',
        x:Math.round(minX - 18),
        y:Math.round(minY - 44),
        w:Math.max(340, Math.round(maxX - minX + 36)),
        h:Math.max(220, Math.round(maxY - minY + 72)),
        title:'智能分组',
        items:[],
        images:[],
        created_at:Date.now()
    };
    nodes.push(group);
    selected.forEach(node => addNodeToSmartGroup(group, node));
    arrangeSmartGroupMembers(group, {skipUndo:true});
    selectedIds = [];
    selectedId = group.id;
    selectedImage = {nodeId:'', index:-1};
    render();
    scheduleSave();
}
function ungroupNode(groupId){
    const group = nodes.find(n => n.id === groupId);
    if(isSmartGroupNode(group)){
        pushUndo();
        const memberIds = smartGroupMembers(group).map(m => m.id);
        const groupImages = (group.images || []).filter(img => img?.url);
        let created = [];
        if(groupImages.length){
            const layout = imageLayout(group.images || [], nodeScale(group), group);
            const pad = 16;
            const gap = 8;
            const cell = Math.max(28, Math.round(layout.thumb || 96));
            const cols = Math.max(1, layout.cols || 1);
            created = groupImages.map((img, index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                const size = thumbDisplaySize(img, cell);
                const x = Math.round(Number(group.x || 0) + pad + col * (cell + gap) + Math.max(0, (cell - size.width) / 2));
                const y = Math.round(Number(group.y || 0) + pad + row * (cell + gap) + Math.max(0, (cell - size.height) / 2));
                const node = {id:uid('smart'), type:'smart-image', x, y, w:size.width, h:size.height, title:'Image', images:[stripImageGenerationMeta({...img})], scale:MEDIA_NODE_DEFAULT_SCALE, created_at:Date.now()};
                inheritNodeMetaFromImage(node);
                return node;
            });
        }
        nodes = nodes.filter(n => n.id !== groupId);
        nodes.push(...created);
        if(canvas) canvas.connections = (canvas.connections || []).filter(c => c.from !== groupId && c.to !== groupId);
        nodes.forEach(node => {
            if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = node.inputNodeIds.filter(id => id !== groupId);
            if(isSmartGroupNode(node) && Array.isArray(node.items)) node.items = node.items.filter(id => id !== groupId);
        });
        selectedIds = [...created.map(n => n.id), ...memberIds].filter(id => nodes.some(n => n.id === id));
        selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
        selectedImage = {nodeId:'', index:-1};
        render();
        scheduleSave();
        return true;
    }
    if(!group || !Array.isArray(group.images) || group.images.length < 2) return false;
    pushUndo();
    const layout = imageLayout(group.images || [], nodeScale(group), group);
    const pad = 16;
    const gap = 8;
    const cell = Math.max(28, Math.round(layout.thumb || 96));
    const created = (group.images || []).map((img, index) => {
        const col = index % Math.max(1, layout.cols || 1);
        const row = Math.floor(index / Math.max(1, layout.cols || 1));
        const size = thumbDisplaySize(img, cell);
        const x = Math.round(Number(group.x || 0) + pad + col * (cell + gap) + Math.max(0, (cell - size.width) / 2));
        const y = Math.round(Number(group.y || 0) + pad + row * (cell + gap) + Math.max(0, (cell - size.height) / 2));
        const node = {
            id:uid('smart'),
            type:'smart-image',
            x,
            y,
            w:size.width,
            h:size.height,
            title:'Image',
            images:[stripImageGenerationMeta({...img})],
            scale:MEDIA_NODE_DEFAULT_SCALE,
            created_at:Date.now()
        };
        inheritNodeMetaFromImage(node);
        return node;
    });
    nodes = nodes.filter(n => n.id !== groupId);
    nodes.push(...created);
    if(canvas) canvas.connections = (canvas.connections || []).filter(c => c.from !== groupId && c.to !== groupId);
    nodes.forEach(node => {
        if(Array.isArray(node.inputNodeIds)){
            node.inputNodeIds = node.inputNodeIds.filter(inputId => inputId !== groupId);
        }
    });
    selectedIds = created.map(node => node.id);
    selectedId = selectedIds.length === 1 ? selectedIds[0] : '';
    selectedImage = {nodeId:'', index:-1};
    render();
    scheduleSave();
    return true;
}
function mergeImageNodesIntoGroup(sourceId, targetId){
    const source = nodes.find(n => n.id === sourceId);
    const target = nodes.find(n => n.id === targetId);
    if(!source || !target || source.id === target.id) return false;
    if(!(source.images || []).length || !(target.images || []).length) return false;
    const sourceImages = (source.images || []).map(img => stripImageGenerationMeta({...img}));
    target.images = [...(target.images || []).map(img => stripImageGenerationMeta(img)), ...sourceImages];
    target.title = 'Group';
    if(!Number.isFinite(Number(target.scale)) || Number(target.scale) === MEDIA_NODE_DEFAULT_SCALE) target.scale = MEDIA_GROUP_DEFAULT_SCALE;
    delete target.w;
    delete target.h;
    canvas.connections = (canvas.connections || []).map(c => {
        if(c.from === source.id) return {...c, from:target.id};
        if(c.to === source.id) return {...c, to:target.id};
        return c;
    }).filter((c, index, arr) => c.from !== c.to && arr.findIndex(x => x.from === c.from && x.to === c.to && (x.kind || 'flow') === (c.kind || 'flow')) === index);
    nodes.forEach(node => {
        if(Array.isArray(node.inputNodeIds)){
            node.inputNodeIds = Array.from(new Set(node.inputNodeIds.map(id => id === source.id ? target.id : id).filter(id => id !== node.id)));
        }
    });
    nodes = nodes.filter(n => n.id !== source.id);
    selectedIds = [];
    selectedId = target.id;
    selectedImage = {nodeId:'', index:-1};
    return true;
}
function smartGroupTargetForDraggedNode(draggedNode){
    if(!draggedNode) return null;
    const r = nodeRect(draggedNode);
    const excluded = new Set([draggedNode.id, ...(dragState?.groupIds || [])]);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const groups = nodes
        .filter(node => isSmartGroupNode(node) && !excluded.has(node.id))
        .map(group => ({group, rect:nodeRect(group)}))
        .filter(item => cx >= item.rect.x && cx <= item.rect.x + item.rect.width && cy >= item.rect.y && cy <= item.rect.y + item.rect.height);
    if(!groups.length) return null;
    groups.sort((a, b) => (nodes.indexOf(b.group) - nodes.indexOf(a.group)));
    return groups[0].group;
}
function addDraggedNodesToSmartGroup(draggedNodes, group){
    if(!isSmartGroupNode(group)) return false;
    const list = (draggedNodes || []).filter(n => n && n.id !== group.id);
    if(!list.length) return false;
    let added = false;
    list.forEach(n => {
        if(addNodeToSmartGroup(group, n)) added = true;
    });
    if(!added) return false;
    arrangeSmartGroupMembers(group, {skipUndo:true});
    selectedIds = [];
    const survivingSingle = list.length === 1 && nodes.some(n => n.id === list[0].id) ? list[0].id : '';
    selectedId = survivingSingle || group.id;
    selectedImage = {nodeId:'', index:-1};
    return true;
}
function closeCreateMenu(){
    createMenu?.classList.remove('open');
}
function openCreateMenu(event){
    if(!createMenu) return;
    createMenuPoint = screenToWorld(event);
    const w = 800;
    const h = 286;
    const left = Math.max(14, Math.min(window.innerWidth - w - 14, event.clientX + 8));
    const top = Math.max(14, Math.min(window.innerHeight - h - 14, event.clientY + 8));
    createMenu.style.left = `${left}px`;
    createMenu.style.top = `${top}px`;
    createMenu.classList.add('open');
    refreshIcons();
}
function createNodeFromMenu(type){
    const p = createMenuPoint || viewportCenter();
    closeCreateMenu();
    if(type === 'group') return createSmartGroupNode(p.x - 170, p.y - 110);
    if(type === 'prompt') return createPromptNode(p.x - 158, p.y - 97);
    if(type === 'loop') return createLoopNode(p.x - 135, p.y - 95);
    const node = createGenerationNodeByKind(type, p);
    scheduleSave();
    return node;
}
function documentMousedownHandler(event){
    if(event.button !== 0 || !candidatePanelNodeId) return;
    if(isCandidatePanelInteractionTarget(event.target)) return;
    if(closeCandidatePanel()){
        setTimeout(() => {
            updateComposer();
            render();
        }, 0);
    }
}
document.addEventListener('mousedown', documentMousedownHandler, true);
function documentClickHandler(event){
    if(event.button !== 0 || !expandedCandidateNodeIds.size || didPan) return;
    if(isExpandedCandidateGridInteractionTarget(event.target)) return;
    if(closeExpandedCandidateGrids()) setTimeout(() => render(), 0);
}
document.addEventListener('click', documentClickHandler, true);
function spacePanBlockedTarget(target){
    return Boolean(target?.closest?.('button,input,textarea,select,[contenteditable="true"],.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-workflow-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.port-drop-menu,.canvas-minimap,.selection-actions,.node-context-menu'));
}
function shellMousedownHandler(e){
    if(e.button !== 0 || !spacePanActive || spacePanBlockedTarget(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeCreateMenu();
    closePortDropMenu();
    closeNodeContextMenu();
    selectionState = null;
    didPan = true;
    viewportInteractionActive = true;
    panState = {button:0, space:true, startX:e.clientX, startY:e.clientY, ox:viewport.x, oy:viewport.y};
    shell.classList.add('panning');
}
shell.addEventListener('mousedown', shellMousedownHandler, true);
function shellMousedownHandler2(e){
    if(!zoomPreviewState) return;
    if(e.button !== 0) return;
    if(e.target.closest('.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap')) return;
    e.preventDefault();
    e.stopPropagation();
}
shell.addEventListener('mousedown', shellMousedownHandler2, true);
function shellClickHandler(e){
    if(!zoomPreviewState) return;
    if(e.button !== 0) return;
    if(didPan){ e.preventDefault(); e.stopPropagation(); return; }
    if(e.target.closest('.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap')) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeEl = e.target.closest('.image-node');
    if(nodeEl?.dataset?.id) exitZoomPreviewToNode(nodeEl.dataset.id);
    else exitZoomPreview(screenToWorld(e));
}
shell.addEventListener('click', shellClickHandler, true);
function shellPointerdownHandler(e){
    if(e.button !== 2) return;
    if(e.target.closest('.image-node,.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap,.selection-actions')) return;
    closeCreateMenu();
    didPan = false;
    rightMouseDownPoint = {x:e.clientX, y:e.clientY};
    rightMouseDownViewport = {x:viewport.x, y:viewport.y};
    shell.setPointerCapture?.(e.pointerId);
}
shell.addEventListener('pointerdown', shellPointerdownHandler);
function shellMousedownHandler3(e){
    if(zoomPreviewState && e.button === 0 && !e.target.closest('.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap')) return;
    if(e.button === 2){
        if(e.target.closest('.image-node,.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap,.selection-actions')) return;
        e.preventDefault();
        if(!rightMouseDownPoint){
            closeCreateMenu();
            didPan = false;
            rightMouseDownPoint = {x:e.clientX, y:e.clientY};
            rightMouseDownViewport = {x:viewport.x, y:viewport.y};
        }
        return;
    }
    // 中键按下时，即使指针落在图片节点上也允许拖拽画布；
    // 但落在底部输入栏/小地图/弹层等真正的交互 UI 上时不平移。
    if(e.button === 1 && !e.target.closest('.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap,.selection-actions')){
        e.preventDefault();
        closeCreateMenu();
        didPan = false;
        panState = {button:e.button, startX:e.clientX, startY:e.clientY, ox:viewport.x, oy:viewport.y};
        shell.classList.add('panning');
        return;
    }
    if(e.target.closest('.image-node,.composer,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.create-menu,.canvas-minimap,.selection-actions')) return;
    closeCreateMenu();
    if(e.button === 0){
        e.preventDefault();
        didPan = false;
        selectionState = {startScreen:{x:e.clientX, y:e.clientY}, startWorld:screenToWorld(e)};
        updateSelectionBox(e);
        return;
    }
}
shell.onmousedown = shellMousedownHandler3;
function shellContextmenuHandler(e){
    if(e.target.closest('.image-node,.composer,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu,.canvas-minimap,.selection-actions')) return;
    if(document.getElementById('imageEditModal')?.classList.contains('open')) return;
    e.preventDefault();
    e.stopPropagation();
}
shell.oncontextmenu = shellContextmenuHandler;
function shellDblclickHandler(e){
    if(didPan || e.target.closest('.image-node,.composer,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu')) return;
    if(document.getElementById('imageEditModal')?.classList.contains('open')) return;
    e.preventDefault();
    openCreateMenu(e);
}
shell.ondblclick = shellDblclickHandler;
function shellClickHandler2(e){
    if(selectionJustFinished) return;
    if(didPan || e.target.closest('.image-node,.composer,.canvas-agent-panel,.canvas-agent-toggle,.canvas-manager-btn,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal,.image-edit-modal,.create-menu')) return;
    if(document.getElementById('imageEditModal')?.classList.contains('open')) return;
    closeCreateMenu();
    clearSelection();
    render();
}
shell.onclick = shellClickHandler2;
function minimapMousedownHandler(e){
    if(e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    viewportInteractionActive = true;
    smartMinimapDrag = true;
    centerViewportOnWorldPoint(minimapEventToWorld(e));
}
minimap?.addEventListener('mousedown', minimapMousedownHandler);
function updateCanvasRightPan(e){
    if(!rightMouseDownPoint || !rightMouseDownViewport || !(e.buttons & 2)) return false;
    const distance = Math.abs(e.clientX - rightMouseDownPoint.x) + Math.abs(e.clientY - rightMouseDownPoint.y);
    if(!panState && distance > 3){
        viewportInteractionActive = true;
        didPan = true;
        panState = {
            button:2,
            startX:rightMouseDownPoint.x,
            startY:rightMouseDownPoint.y,
            ox:rightMouseDownViewport.x,
            oy:rightMouseDownViewport.y
        };
        shell.classList.add('panning');
    }
    if(panState?.button !== 2) return false;
    viewport.x = panState.ox + e.clientX - panState.startX;
    viewport.y = panState.oy + e.clientY - panState.startY;
    applyViewport();
    return true;
}
function shellPointermoveHandler(e){
    if(updateCanvasRightPan(e)) e.preventDefault();
}
shell.addEventListener('pointermove', shellPointermoveHandler);
// 说明：onmousemove/onmouseup 原本是 window.onxxx = e => {...} 形式的
// 匿名函数表达式赋值，不是命名函数声明——这导致 AST 符号扫描（比如
// get_document_symbols）完全看不到这两个函数，M7 阶段就发现了这个问题
// 但当时决定"物理搬移函数体"风险太高（涉及10+种互斥交互状态耦合，
// 调用了几乎每个已拆分模块的函数），先搁置。
// 现在只做最小的、行为不变的语法转换：把匿名箭头函数改成命名函数
// 声明 + 单独一行赋值，纯粹是为了让这两个函数对 AST 工具可见（比如
// 之后想找它们调用了哪些函数、被哪些变量捕获），不涉及任何逻辑改动、
// 不做物理文件搬移、不改变作用域规则（两个函数用到的所有变量还是
// 通过共享脚本作用域访问，跟改造前完全一样）。
// M19 拆分：handleWindowMouseMove / window.onmousemove 赋值 /
// finishCanvasRightClick / cancelCanvasRightClick /
// window.addEventListener('pointerup'/'pointercancel', ...) /
// handleWindowMouseUp / window.onmouseup 赋值 已迁移到
// frontend/src/canvas/canvas-render.js（追加在文件末尾，经典
// <script>，非 ES module，原因同 M1-M18）。M18 先把这两个函数从匿名
// 箭头函数改成具名函数声明，M19 完成真正的物理搬移。依赖的15+个交互
// 状态变量（dragState/panState/cropDrag/portDragState 等）刻意留在
// 这里，原因同 M16/M17。

function shellWheelHandler(e){
    if(isBootLoadingActive()){
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if(e.target.closest('.composer,.image-edit-modal,.asset-panel,.asset-toggle,.canvas-agent-panel,.canvas-agent-toggle,.canvas-log-toggle,.canvas-shortcut-toggle,.canvas-usage-toggle,.canvas-usage-panel,.log-modal,.shortcut-modal')) return;
    e.preventDefault();
    viewportInteractionActive = true;
    const rect = shell.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = {x:(sx - viewport.x) / viewport.scale, y:(sy - viewport.y) / viewport.scale};
    const factor = Math.exp(-e.deltaY * 0.001);
    viewport.scale = safeScale(viewport.scale * factor);
    viewport.x = sx - before.x * viewport.scale;
    viewport.y = sy - before.y * viewport.scale;
    applyViewport();
    clearTimeout(viewportInteractionReleaseTimer);
    viewportInteractionReleaseTimer = setTimeout(() => {
        viewportInteractionReleaseTimer = null;
        flushDeferredViewportRendering();
    }, 140);
    scheduleSave(1200);
}
shell.addEventListener('wheel', shellWheelHandler, {passive:false});
shell.ondragover = e => setSmartDropCopyEffect(e, true);
async function shellDropHandler(e){
    e.preventDefault();
    if(e.target.closest('.image-node')) return;
    const p = screenToWorld(e);
    const assetRaw = e.dataTransfer.getData('application/x-smart-asset');
    if(assetRaw){
        try {
            const asset = JSON.parse(assetRaw);
            if(asset?.url) {
                pushUndo();
                createImageNodeAt(p, [{file_id:asset.file_id || '', url:asset.url, name:asset.name || 'asset', kind:asset.kind || assetMediaKind(asset)}], {type:'smart-asset-image', skipUndo:true});
            }
            return;
        } catch {}
    }
    const payload = await resolveSmartImageDropPayload(e.dataTransfer);
    if(payload.type === 'none') return;
    await handleSmartImageDropPayload(payload, '', {point:p, forceNew:true});
}
shell.ondrop = shellDropHandler;
function windowPasteHandler(e){
    if(isBootLoadingActive()){
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    const editable = isEditableTarget(e.target) || isEditableTarget(document.activeElement);
    const files = clipboardEventMediaFiles(e.clipboardData);
    if(editable && !files.length){
        const plainText = e.clipboardData?.getData('text/plain') ?? '';
        const target = e.target?.closest?.('input, textarea, [contenteditable="true"]') || document.activeElement;
        // Text fields must never receive clipboard HTML or embedded rich nodes.
        e.preventDefault();
        if(target?.matches?.('input, textarea') && typeof target.setRangeText === 'function'){
            const start=target.selectionStart ?? target.value.length, end=target.selectionEnd ?? start;
            target.setRangeText(plainText,start,end,'end');
            target.dispatchEvent(new Event('input',{bubbles:true}));
        }else if(target?.isContentEditable){
            document.execCommand('insertText',false,plainText);
        }
        return;
    }
    pasteClipboardContent(files, {editable, preventDefault:() => e.preventDefault()});
}
window.addEventListener('paste', windowPasteHandler);
function windowKeydownHandler(e){
    if(isBootLoadingActive()){
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    const key = String(e.key || '').toLowerCase();
    if(e.code === 'Space' && !isEditableTarget(e.target) && !imageEditModal.classList.contains('open')){
        e.preventDefault();
        if(!e.repeat){
            spacePanActive = true;
            shell.classList.add('space-pan-ready');
        }
        return;
    }
    if(e.key === 'Escape' && nodeContextMenu && !nodeContextMenu.hidden){
        e.preventDefault();
        closeNodeContextMenu();
        return;
    }
    if(imageEditModal.classList.contains('open') && !isEditableTarget(e.target)){
        if(e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
            e.preventDefault();
            if(!seekPreviewVideoFrames(e.key === 'ArrowLeft' ? -1 : 1)){
                navigatePreviewImage(e.key === 'ArrowLeft' ? -1 : 1);
            }
            return;
        }
    }
    if(!e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)){
        if(key === 'z'){
            if(e.repeat) return;
            e.preventDefault();
            toggleZoomPreview();
            return;
        }
        if(key === 'a'){
            if(e.repeat) return;
            e.preventDefault();
            toggleAssetLibrary();
            return;
        }
    }
    if((e.ctrlKey || e.metaKey) && key === 'c' && !isEditableTarget(e.target)){
        const selectionText = window.getSelection?.().toString() || '';
        if(selectionText) return;
        e.preventDefault();
        copySelectedNodes();
        return;
    }
    // 不在此处拦截 Ctrl+V：交给原生 'paste' 事件统一处理，
    // 这样才能读取系统剪贴板里的图片文件并决定粘贴图片还是内部节点。
    if(e.key === 'Escape' && imageEditModal.classList.contains('open')){
        closeImageEditor();
        return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'z' && !isEditableTarget(e.target)){
        e.preventDefault();
        performUndo();
        return;
    }
    if((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedIds.length) && !isEditableTarget(e.target)){
        e.preventDefault();
        const ids = selectedIds.length ? selectedIds.slice() : [selectedId];
        pushUndo();
        ids.forEach(id => { undoSuppressed = true; deleteNode(id); undoSuppressed = false; });
        render();
        scheduleSave();
    }
    if((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'g' && !isEditableTarget(e.target)){
        e.preventDefault();
        const ids = selectedIds.length ? selectedIds.slice() : (selectedId ? [selectedId] : []);
        const ok = ids.map(id => ungroupNode(id)).some(Boolean);
        if(ok) return;
    }
    if((e.ctrlKey || e.metaKey) && key === 'g' && !e.shiftKey && !isEditableTarget(e.target)){
        e.preventDefault();
        groupSelectedNodes();
    }
    if((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target) && !imageEditModal.classList.contains('open')){
        e.preventDefault();
        const step = (e.shiftKey ? 240 : 80) * viewport.scale;
        if(e.key === 'ArrowUp') viewport.y += step;
        else if(e.key === 'ArrowDown') viewport.y -= step;
        else if(e.key === 'ArrowLeft') viewport.x += step;
        else viewport.x -= step;
        applyViewport();
        scheduleSave(1200);
    }
}
window.addEventListener('keydown', windowKeydownHandler);
function windowKeyupHandler(e){
    if(e.code !== 'Space') return;
    spacePanActive = false;
    shell.classList.remove('space-pan-ready');
}
window.addEventListener('keyup', windowKeyupHandler);
function windowBlurHandler(){
    spacePanActive = false;
    shell.classList.remove('space-pan-ready');
    if(panState?.space){
        panState = null;
        shell.classList.remove('panning');
        flushDeferredViewportRendering();
        setTimeout(() => { didPan = false; }, 0);
    }
}
window.addEventListener('blur', windowBlurHandler);
function engineSelectChangeHandler(){
    const node = activeSettingsSubject();
    const requestedEngine = ['api','comfy','runninghub'].includes(engineSelect.value) ? engineSelect.value : 'api';
    settings.engine = requestedEngine;
    // 图片/视频节点的类型是节点固有状态。切换引擎时只切换参数面板，
    // 不再让最近使用的工作流配置覆盖当前节点的 apiKind 或引擎状态。
    if(node?.genKind === 'image') settings.apiKind = 'image';
    else if(node?.genKind === 'video') settings.apiKind = 'video';
    else applyRecentSmartSettingsForCurrentMode();
    // A previous workflow render may still have populated the dynamic panel
    // (or finish asynchronously). Clear it before rendering the API view so
    // switching back to AI generation cannot leave workflow controls visible.
    if(requestedEngine === 'api' && dynamicParams){
        dynamicParams.replaceChildren();
        if(node?.genKind === 'video') {
            settings.apiKind = 'video';
            renderApiVideoParams();
        } else {
            settings.apiKind = 'image';
            renderApiParams();
        }
        bindDynamicParams();
        updatePromptPlaceholder();
        syncComposerPromptVisibility();
        renderInputThumbsRow(selectedNode());
        renderInputPromptPreview(selectedNode());
        persistActiveSmartSettings();
        if(window.lucide) lucide.createIcons();
        scheduleSave();
        return;
    }
    renderDynamicParams();
    persistActiveSmartSettings();
    scheduleSave();
}
engineSelect.onchange = engineSelectChangeHandler;
let promptResizeState = null;
const promptResize = document.getElementById('promptResize');
if(promptResize){
    promptResize.addEventListener('mousedown', e => {
        if(e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        promptResizeState = {
            startY: e.clientY,
            startH: Number(settings.promptH) || promptInput.offsetHeight || 124
        };
    });
}
runBtn.onclick = runGeneration;
function cascadeRunBtnClickHandler(){
    const node = selectedNode();
    const loopId = resolveSmartCascadeLoop(node?.id)?.node?.id || '';
    if(loopId && smartCascadeIsLoopRunning(loopId)) {
        requestSmartCascadeStop(loopId);
        return;
    }
    runSmartCascade();
}
cascadeRunBtn.onclick = cascadeRunBtnClickHandler;
function fileInputChangeHandler(){
    const groupPoint = pendingGroupUploadPoint;
    if(!fileInput.files?.length){
        pendingGroupUploadPoint = null;
        uploadTargetId = '';
        return;
    }
    const targetId = groupPoint ? '' : (uploadTargetId || selectedId);
    handleFiles(fileInput.files, targetId, groupPoint ? {point:groupPoint} : {});
    pendingGroupUploadPoint = null;
    uploadTargetId = '';
    fileInput.value = '';
}
fileInput.onchange = fileInputChangeHandler;
if(assetToggle) assetToggle.onclick = () => toggleAssetLibrary();
if(assetCloseBtn) assetCloseBtn.onclick = () => toggleAssetLibrary(false);
if(canvasWorkflowToggle) canvasWorkflowToggle.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    if(canvasWorkflowTransferModal?.classList.contains('open')) closeCanvasWorkflowTransferModal();
    else openCanvasWorkflowTransferModal();
};
function renderCanvasUsage(data){
    const s = data?.spending || {}, money = `$${Number(s.total_usd || 0).toFixed(2)}`;
    const set = (id, value) => { const el = document.getElementById(id); if(el) el.textContent = Number(value || 0).toLocaleString(); };
    document.getElementById('canvasUsageAmount')?.replaceChildren(money);
    document.getElementById('canvasUsagePanelTotal')?.replaceChildren(money);
    set('canvasUsageRequests', s.request_count); set('canvasUsageTokens', s.total_tokens); set('canvasUsageText', s.prompt_tokens); set('canvasUsageImage', s.image_input_tokens); set('canvasUsageOutput', s.completion_tokens);
}
async function loadCanvasUsage(){ try { const r = await fetch('/api/account/overview?limit=1'); if(!r.ok) throw new Error('usage'); renderCanvasUsage(await r.json()); } catch(_) { renderCanvasUsage({}); } }
canvasUsageToggle?.addEventListener('click', e => { e.stopPropagation(); canvasUsagePanel.hidden = !canvasUsagePanel.hidden; canvasUsageToggle.classList.toggle('active', !canvasUsagePanel.hidden); });
canvasUsageClose?.addEventListener('click', () => { canvasUsagePanel.hidden = true; canvasUsageToggle?.classList.remove('active'); });
canvasUsageDetails?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    window.parent?.postMessage({type: 'studio-open-account'}, location.origin);
});
document.addEventListener('click', e => { if(canvasUsagePanel && !canvasUsagePanel.hidden && !canvasUsagePanel.contains(e.target) && !canvasUsageToggle?.contains(e.target)){ canvasUsagePanel.hidden = true; canvasUsageToggle?.classList.remove('active'); } });
function canvasWorkflowImportInputChangeHandler(event){
    const file = event.target.files?.[0];
    if(file) importCanvasWorkflowFile(file);
    event.target.value = '';
}
canvasWorkflowImportInput?.addEventListener('change', canvasWorkflowImportInputChangeHandler);
canvasWorkflowImportDropZone?.addEventListener('click', () => canvasWorkflowImportInput?.click());
function canvasWorkflowImportDropZoneDragenterHandler(event){
    event.preventDefault();
    event.stopPropagation();
    canvasWorkflowImportDropZone.classList.add('drag-over');
}
canvasWorkflowImportDropZone?.addEventListener('dragenter', canvasWorkflowImportDropZoneDragenterHandler);
function canvasWorkflowImportDropZoneDragoverHandler(event){
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    canvasWorkflowImportDropZone.classList.add('drag-over');
}
canvasWorkflowImportDropZone?.addEventListener('dragover', canvasWorkflowImportDropZoneDragoverHandler);
function canvasWorkflowImportDropZoneDragleaveHandler(event){
    event.preventDefault();
    event.stopPropagation();
    if(!canvasWorkflowImportDropZone.contains(event.relatedTarget)) canvasWorkflowImportDropZone.classList.remove('drag-over');
}
canvasWorkflowImportDropZone?.addEventListener('dragleave', canvasWorkflowImportDropZoneDragleaveHandler);
function canvasWorkflowImportDropZoneDropHandler(event){
    event.preventDefault();
    event.stopPropagation();
    canvasWorkflowImportDropZone.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(json|zip)$/i.test(item.name || ''));
    if(file) importCanvasWorkflowFile(file);
    else toast('请拖入 JSON 或 ZIP 模板文件');
}
canvasWorkflowImportDropZone?.addEventListener('drop', canvasWorkflowImportDropZoneDropHandler);
canvasWorkflowTransferModal?.addEventListener('pointerdown', e => e.stopPropagation());
canvasWorkflowTransferModal?.addEventListener('mousedown', e => e.stopPropagation());
canvasWorkflowTransferModal?.addEventListener('click', e => e.stopPropagation());
function canvasWorkflowTransferModalWheelHandler(event){
    event.stopPropagation();
}
canvasWorkflowTransferModal?.addEventListener('wheel', canvasWorkflowTransferModalWheelHandler, {passive:true, capture:true});
function canvasWorkflowTransferModalDragoverHandler(event){
    event.preventDefault();
    event.stopPropagation();
    if(canvasWorkflowImportDropZone){
        event.dataTransfer.dropEffect = 'copy';
        canvasWorkflowImportDropZone.classList.add('drag-over');
    }
}
canvasWorkflowTransferModal?.addEventListener('dragover', canvasWorkflowTransferModalDragoverHandler);
function canvasWorkflowTransferModalDragleaveHandler(event){
    event.preventDefault();
    event.stopPropagation();
    if(!canvasWorkflowTransferModal.contains(event.relatedTarget)) canvasWorkflowImportDropZone?.classList.remove('drag-over');
}
canvasWorkflowTransferModal?.addEventListener('dragleave', canvasWorkflowTransferModalDragleaveHandler);
function canvasWorkflowTransferModalDropHandler(event){
    event.preventDefault();
    event.stopPropagation();
    canvasWorkflowImportDropZone?.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(json|zip)$/i.test(item.name || ''));
    if(file) importCanvasWorkflowFile(file);
    else toast('请拖入 JSON 或 ZIP 模板文件');
}
canvasWorkflowTransferModal?.addEventListener('drop', canvasWorkflowTransferModalDropHandler);
assetPanel?.addEventListener('pointerdown', e => e.stopPropagation());
assetPanel?.addEventListener('mousedown', e => e.stopPropagation());
assetPanel?.addEventListener('click', e => e.stopPropagation());
function assetPanelWheelHandler(e){
    e.stopPropagation();
    const scroller = e.target.closest?.('.asset-grid') || assetGrid;
    if(!scroller || getComputedStyle(scroller).display === 'none') return;
    const canScroll = scroller.scrollHeight > scroller.clientHeight || scroller.scrollWidth > scroller.clientWidth;
    if(!canScroll) return;
    e.preventDefault();
    scroller.scrollTop += e.deltaY;
    scroller.scrollLeft += e.deltaX;
}
assetPanel?.addEventListener('wheel', assetPanelWheelHandler, {passive:false, capture:true});
assetDialogBackdrop?.addEventListener('pointerdown', e => e.stopPropagation());
assetDialogBackdrop?.addEventListener('mousedown', e => e.stopPropagation());
assetDialogBackdrop?.addEventListener('click', e => e.stopPropagation());
promptPresetPanel?.addEventListener('pointerdown', e => e.stopPropagation());
promptPresetPanel?.addEventListener('mousedown', e => e.stopPropagation());
promptPresetPanel?.addEventListener('click', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('pointerdown', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('mousedown', e => e.stopPropagation());
promptTemplatePanel?.addEventListener('wheel', e => e.stopPropagation(), {passive:false});
function promptTemplatePanelClickHandler(e){
    e.stopPropagation();
    const apply = e.target.closest('[data-template-apply]');
    if(apply){ applyPromptTemplateToNode(apply.dataset.templateApply || 'positive'); return; }
    if(e.target.closest('[data-template-save-current]')){ saveCurrentPromptAsTemplate(); return; }
    if(e.target.closest('[data-template-new]')){ createBlankPromptTemplate(); return; }
    if(e.target.closest('[data-template-edit]')) { promptTemplateEditing = true; renderPromptTemplatePanel(); return; }
    if(e.target.closest('[data-template-edit-cancel]')) { promptTemplateEditing = false; renderPromptTemplatePanel(); return; }
    if(e.target.closest('[data-template-edit-save]')){ savePromptTemplateEdit(); return; }
    if(e.target.closest('[data-template-delete]')){ deletePromptTemplate(); return; }
    const cat = e.target.closest('[data-template-cat]');
    if(cat){
        promptTemplateCategory = cat.dataset.templateCat || 'all';
        promptTemplateSelectedId = '';
        promptTemplateEditing = false;
        renderPromptTemplatePanel({preserveScroll:false});
        return;
    }
    const catEdit = e.target.closest('[data-template-cat-edit]');
    if(catEdit){
        const id = catEdit.dataset.templateCatEdit || '';
        renamePromptTemplateGroup(id);
        return;
    }
    const catDelete = e.target.closest('[data-template-cat-delete]');
    if(catDelete){
        deletePromptTemplateGroup(catDelete.dataset.templateCatDelete || '');
        return;
    }
    if(e.target.closest('[data-template-group-edit]')){
        promptTemplateGroupEditMode = !promptTemplateGroupEditMode;
        renderPromptTemplatePanel({preserveScroll:false});
        return;
    }
    if(e.target.closest('[data-template-cat-new]')) { createPromptTemplateGroup(); return; }
    const card = e.target.closest('[data-template-id]');
    if(card){
        promptTemplateSelectedId = card.dataset.templateId || '';
        promptTemplateEditing = false;
        renderPromptTemplatePanel();
        return;
    }
}
promptTemplatePanel?.addEventListener('click', promptTemplatePanelClickHandler);
if(promptPresetClose) promptPresetClose.onclick = closePromptPresetPanel;
if(promptTemplateClose) promptTemplateClose.onclick = closePromptTemplatePanel;
if(promptTemplateSearch) promptTemplateSearch.oninput = () => renderPromptTemplatePanel({preserveScroll:false});
if(promptTemplateLibrarySelect) promptTemplateLibrarySelect.onchange = () => {
    activePromptLibraryId = promptTemplateLibrarySelect.value || 'system';
    promptTemplateSelectedId = '';
    promptTemplateEditing = false;
    renderPromptTemplatePanel({preserveScroll:false});
};
if(composerTemplateBtn) composerTemplateBtn.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    if(promptTemplatePanel?.classList?.contains('open') && promptTemplatePanel.dataset.target === 'composer'){
        closePromptTemplatePanel();
        return;
    }
    openPromptTemplatePanel(activeComposerNode()?.id || selectedNode()?.id || '', promptTemplateSelectedId, {target:'composer'});
};
if(promptPresetSelect) promptPresetSelect.onchange = () => renderPromptPresetPanel(promptPresetSelect.value);
[promptPresetName, promptPresetText].forEach(input => {
    input?.addEventListener('input', () => {
        resetPromptPresetDeleteState();
        setPromptPresetStatus(tr('smart.promptPresetEditing'));
    });
});
if(promptPresetApply) promptPresetApply.onclick = () => {
    const preset = currentPromptPreset(promptPresetSelect.value);
    const node = promptPresetPanelNode();
    if(!preset || !node) return;
    node.promptPresetId = preset.id;
    node.text = preset.text || '';
    closePromptPresetPanel();
    render();
    scheduleSave();
};
if(promptPresetSave) promptPresetSave.onclick = () => {
    const preset = currentPromptPreset(promptPresetSelect.value);
    if(!preset) return;
    const name = promptPresetName.value.trim();
    const text = promptPresetText.value.trim();
    if(!name || !text){ setPromptPresetStatus(tr('smart.promptPresetRequired'), 'warn'); return; }
    const idx = promptPresets.findIndex(p => p.id === preset.id);
    if(idx >= 0) promptPresets[idx] = {...promptPresets[idx], name, text, updatedAt:Date.now()};
    savePromptPresets();
    const node = promptPresetPanelNode();
    if(node?.promptPresetId === preset.id) node.text = text;
    renderPromptPresetPanel(preset.id, tr('smart.promptPresetSaved'));
    setPromptPresetStatus(tr('smart.promptPresetSaved'), 'ok');
    render();
    scheduleSave();
};
if(promptPresetNew) promptPresetNew.onclick = () => {
    const node = promptPresetPanelNode();
    const preset = createPromptPresetFromNode(node, {openPanel:false});
    if(!preset) return;
    renderPromptPresetPanel(preset.id, tr('smart.promptPresetSavedNew'));
    setPromptPresetStatus(tr('smart.promptPresetSavedNew'), 'ok');
    promptPresetName?.focus();
    promptPresetName?.select();
};
if(promptPresetDelete) promptPresetDelete.onclick = () => {
    const preset = currentPromptPreset(promptPresetSelect.value);
    if(!preset) return;
    if(!promptPresetDeleteArmed){
        promptPresetDeleteArmed = true;
        promptPresetDelete.textContent = tr('smart.promptPresetDeleteAgain');
        promptPresetDelete.classList.add('confirm-danger');
        setPromptPresetStatus(tr('smart.promptPresetDeleteConfirm').replace('{name}', preset.name || tr('smart.promptPresetUnnamed')), 'warn');
        return;
    }
    promptPresets = promptPresets.filter(p => p.id !== preset.id);
    nodes.forEach(node => { if(node.promptPresetId === preset.id) node.promptPresetId = ''; });
    savePromptPresets();
    renderPromptPresetPanel(promptPresets[0]?.id || '', tr('smart.promptPresetDeleted'));
    setPromptPresetStatus(tr('smart.promptPresetDeleted'), 'ok');
    render();
    scheduleSave();
};
document.querySelectorAll('[data-asset-tab]').forEach(btn => {
    btn.onclick = () => { assetTab = btn.dataset.assetTab; renderAssetLibrary(); };
});
if(assetLibrarySelect) assetLibrarySelect.onchange = () => {
    activeAssetLibraryId = assetLibrarySelect.value || '';
    activeAssetCategoryId = '';
    mentionAssetCategoryId = '';
    renderAssetLibrary();
};
if(assetCategorySelect) assetCategorySelect.onchange = () => { activeAssetCategoryId = assetCategorySelect.value; renderAssetLibrary(); };
const assetAddCategoryBtn = document.getElementById('assetAddCategoryBtn');
if(assetAddCategoryBtn) assetAddCategoryBtn.onclick = async () => {
    const name = await openAssetNameDialog({title:tr('smart.assetNewFolder'), value:tr('smart.assetFolder'), placeholder:tr('smart.assetFolder')});
    if(!name) return;
    const data = await fetch('/api/asset-library/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:activeAssetLibraryId, name, type:'image'})}).then(r => r.json());
    activeAssetCategoryId = data.category?.id || activeAssetCategoryId;
    setAssetLibraryFromResponse(data);
};
const assetRenameCategoryBtn = document.getElementById('assetRenameCategoryBtn');
if(assetRenameCategoryBtn) assetRenameCategoryBtn.onclick = async () => {
    const cat = activeAssetCategory();
    if(!cat) return;
    const name = await openAssetNameDialog({title:tr('smart.assetRenameFolder'), value:cat.name || '', placeholder:tr('smart.assetFolder')});
    if(!name) return;
    const data = await fetch(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})}).then(r => r.json());
    setAssetLibraryFromResponse(data);
};
function hasCanvasImageDrag(event){
    return Array.from(event.dataTransfer?.types || []).includes('application/x-canvas-image');
}
function setAssetDragOver(active){
    if(!assetDropZone || !assetPanel) return;
    assetDropZone.classList.toggle('drag-over', !!active);
    assetPanel.classList.toggle('drag-over', !!active);
}
function handleAssetPanelDragOver(e){
    if(hasCanvasImageDrag(e) || hasSmartImageDropData(e.dataTransfer)){
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setAssetDragOver(true);
    }
}
async function handleAssetPanelDrop(e){
    if(!hasCanvasImageDrag(e) && !hasSmartImageDropData(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setAssetDragOver(false);
    const raw = e.dataTransfer.getData('application/x-canvas-image');
    if(raw){
        try {
            const payload = JSON.parse(raw);
            if(payload?.file_id) await addFileToAssetLibrary(payload.file_id, payload.name || '');
            return;
        } catch(e) {
            toast(tr('smart.assetAddFail'));
            return;
        }
    }
    try {
        const payload = await resolveSmartImageDropPayload(e.dataTransfer);
        if(payload.type === 'files') {
            const uploaded = await uploadFiles(payload.files);
            for(const file of uploaded) if(file?.file_id) await addFileToAssetLibrary(file.file_id, file.name || '');
        } else if(payload.type === 'localPaths') {
            const imported = await importSmartLocalImages(payload.localPaths);
            for(const file of imported) if(file?.file_id) await addFileToAssetLibrary(file.file_id, file.name || '');
        } else if(payload.type === 'url') {
            throw new Error('外部 URL 不能直接保存到资产库，请先上传为文件');
        }
    } catch(err) {
        toast(err.message || tr('smart.assetAddFail'));
    }
}
function assetDropZoneDragoverHandler(e){
    if(hasCanvasImageDrag(e) || hasSmartImageDropData(e.dataTransfer)){
        e.preventDefault();
        e.stopPropagation();
        assetDropZone?.classList.add('drag-over');
    }
}
assetDropZone?.addEventListener('dragover', assetDropZoneDragoverHandler);
assetDropZone?.addEventListener('dragleave', () => assetDropZone?.classList.remove('drag-over'));
assetDropZone?.addEventListener('drop', handleAssetPanelDrop);
assetPanel?.addEventListener('dragover', handleAssetPanelDragOver);
function assetPanelDragleaveHandler(e){ if(!assetPanel?.contains(e.relatedTarget)) setAssetDragOver(false); }
assetPanel?.addEventListener('dragleave', assetPanelDragleaveHandler);
assetPanel?.addEventListener('drop', handleAssetPanelDrop);
nodeAssetSaveModal?.addEventListener('pointerdown', event => event.stopPropagation());
nodeAssetSaveModal?.addEventListener('mousedown', event => event.stopPropagation());
function nodeAssetSaveModalClickHandler(event){
    event.stopPropagation();
    if(event.target === nodeAssetSaveModal) closeNodeAssetSaveModal();
}
nodeAssetSaveModal?.addEventListener('click', nodeAssetSaveModalClickHandler);
nodeAssetSaveClose?.addEventListener('click', closeNodeAssetSaveModal);
nodeAssetSaveCancel?.addEventListener('click', closeNodeAssetSaveModal);
function nodeAssetSaveLibrariesClickHandler(event){
    const btn = event.target.closest('[data-node-asset-library]');
    if(!btn) return;
    nodeAssetSaveState.libraryId = btn.dataset.nodeAssetLibrary || '';
    nodeAssetSaveState.categoryId = assetCategoriesForLibrary(nodeAssetSaveState.libraryId, 'image')[0]?.id || '';
    renderNodeAssetSaveModal();
}
nodeAssetSaveLibraries?.addEventListener('click', nodeAssetSaveLibrariesClickHandler);
function nodeAssetSaveFoldersClickHandler(event){
    const btn = event.target.closest('[data-node-asset-folder]');
    if(!btn) return;
    nodeAssetSaveState.categoryId = btn.dataset.nodeAssetFolder || '';
    renderNodeAssetSaveModal();
}
nodeAssetSaveFolders?.addEventListener('click', nodeAssetSaveFoldersClickHandler);
function nodeAssetSaveNameInputHandler(){
    nodeAssetSaveState.name = nodeAssetSaveName.value;
}
nodeAssetSaveName?.addEventListener('input', nodeAssetSaveNameInputHandler);
function nodeAssetSaveNameKeydownHandler(event){
    if(event.key === 'Escape'){
        event.preventDefault();
        closeNodeAssetSaveModal();
    }
    if(event.key === 'Enter'){
        event.preventDefault();
        nodeAssetSaveConfirm?.click();
    }
}
nodeAssetSaveName?.addEventListener('keydown', nodeAssetSaveNameKeydownHandler);
async function nodeAssetSaveNewFolderClickHandler(){
    const libraryId = nodeAssetSaveState.libraryId || assetLibraries()[0]?.id || '';
    if(!libraryId) return;
    const name = await openAssetNameDialog({title:'新建文件夹', value:'', placeholder:'输入文件夹名称', cancelValue:''});
    if(!String(name || '').trim()) return;
    try {
        const data = await fetch('/api/asset-library/categories', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:libraryId, name:String(name).trim(), type:'image'})
        }).then(async r => {
            if(!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || '新建文件夹失败');
            return r.json();
        });
        nodeAssetSaveState.libraryId = libraryId;
        nodeAssetSaveState.categoryId = data.category?.id || nodeAssetSaveState.categoryId;
        setAssetLibraryFromResponse(data);
    } catch(err) {
        showErrorModal(err.message || '新建文件夹失败', '新建文件夹失败');
    }
}
nodeAssetSaveNewFolder?.addEventListener('click', nodeAssetSaveNewFolderClickHandler);
async function nodeAssetSaveConfirmClickHandler(){
    try {
        nodeAssetSaveConfirm.disabled = true;
        const items = Array.isArray(nodeAssetSaveState.items) && nodeAssetSaveState.items.length
            ? nodeAssetSaveState.items
            : [{fileId:nodeAssetSaveState.fileId, name:String(nodeAssetSaveName?.value || nodeAssetSaveState.name || '').trim()}];
        for(const [index, item] of items.entries()){
            await saveFileToAssetLibrarySelection(
                item.fileId,
                nodeAssetSaveState.useOriginalNames ? item.name : (items.length === 1 ? String(nodeAssetSaveName?.value || item.name || '').trim() : item.name),
                nodeAssetSaveState.libraryId,
                nodeAssetSaveState.categoryId,
                {silent:items.length > 1 || index < items.length - 1}
            );
        }
        if(items.length > 1) toast(`已加入 ${items.length} 项资产`);
        closeNodeAssetSaveModal();
    } catch(err) {
        showErrorModal(err.message || '保存到资产库失败', '保存到资产库失败');
        renderNodeAssetSaveModal();
    }
}
nodeAssetSaveConfirm?.addEventListener('click', nodeAssetSaveConfirmClickHandler);
createMenu?.addEventListener('mousedown', event => event.stopPropagation());
function createMenuClickHandler(event){
    event.stopPropagation();
    const card = event.target.closest('[data-create-type]');
    if(card) createNodeFromMenu(card.dataset.createType || 'image');
}
createMenu?.addEventListener('click', createMenuClickHandler);
/* ─── 拉线菜单事件绑定 ─── */
portDropMenu?.addEventListener('mousedown', event => event.stopPropagation());
function portDropMenuClickHandler(event){
    event.stopPropagation();
    const item = event.target.closest('[data-node-type]');
    if(item) handlePortDropMenuSelect(item.dataset.nodeType);
}
portDropMenu?.addEventListener('click', portDropMenuClickHandler);
function documentMousedownHandler2(event){
    if(!portDropMenu || portDropMenu.hidden) return;
    if(event.target.closest('.port-drop-menu')) return;
    closePortDropMenu();
}
document.addEventListener('mousedown', documentMousedownHandler2, true);
composer.addEventListener('pointerdown', event => event.stopPropagation());
composer.addEventListener('mousedown', event => event.stopPropagation());
function composerClickHandler(event){
    if(!event.target.closest('.smart-control')) closeAllSmartPopovers();
    event.stopPropagation();
}
composer.addEventListener('click', composerClickHandler);
if(promptComposer){
    promptComposer.addEventListener('pointerdown', event => event.stopPropagation());
    promptComposer.addEventListener('mousedown', event => event.stopPropagation());
    promptComposer.addEventListener('click', event => event.stopPropagation());
    promptComposer.addEventListener('dblclick', event => event.stopPropagation());
}
promptInput.addEventListener('input', maybeOpenMentionPicker);
function promptInputInputHandler(){
    delete promptInput.dataset.preserveDraftOnce;
    savePromptDraftForCurrent();
    renderInputThumbsRow(selectedNode());
    scheduleSave();
}
promptInput.addEventListener('input', promptInputInputHandler);
promptInput.addEventListener('keyup', maybeOpenMentionPicker);
promptInput.addEventListener('mouseup', saveMentionRange);
promptInput.addEventListener('focus', saveMentionRange);
function promptInputKeydownHandler(event){
    if(event.key === 'Escape') closeMentionPicker();
    if(event.key === 'Enter'){
        // Shift+Enter 换行（保留默认行为）；输入法组合中（如中文候选词确认）不拦截。
        if(event.shiftKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        // @提及候选框打开时，回车用于关闭候选框继续输入，不触发生成。
        if(mentionPicker?.classList?.contains('open')){
            closeMentionPicker();
            return;
        }
        // 回车直接生成图片。
        runGeneration();
    }
}
promptInput.addEventListener('keydown', promptInputKeydownHandler);
function promptInputMouseoverHandler(event){
    const token = event.target.closest?.('.mention-image-token');
    if(!token) return;
    let media = mentionPreview.querySelector('img,video');
    const isVideo = token.dataset.kind === 'video' || isVideoMediaItem({url:token.dataset.url, kind:token.dataset.kind});
    if(isVideo && media?.tagName?.toLowerCase() !== 'video'){
        media?.replaceWith(document.createElement('video'));
        media = mentionPreview.querySelector('video');
    } else if(!isVideo && media?.tagName?.toLowerCase() !== 'img'){
        media?.replaceWith(document.createElement('img'));
        media = mentionPreview.querySelector('img');
    }
    if(isVideo){
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.disablePictureInPicture = true;
        media.setAttribute('disablepictureinpicture', '');
        media.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
        media.src = token.dataset.url || '';
        media.play?.().catch(() => {});
    } else {
        media.src = token.dataset.url || '';
        media.alt = 'preview';
    }
    const rect = token.getBoundingClientRect();
    mentionPreview.style.left = `${Math.min(window.innerWidth - 236, rect.left)}px`;
    mentionPreview.style.top = `${Math.min(window.innerHeight - 236, rect.bottom + 8)}px`;
    mentionPreview.style.display = 'block';
}
promptInput.addEventListener('mouseover', promptInputMouseoverHandler);
function promptInputMouseoutHandler(event){
    if(event.target.closest?.('.mention-image-token')){
        mentionPreview.style.display = 'none';
        const media = mentionPreview.querySelector('img,video');
        media?.pause?.();
        media?.removeAttribute('src');
        media?.load?.();
    }
}
promptInput.addEventListener('mouseout', promptInputMouseoutHandler);
mentionPicker.addEventListener('mousedown', event => event.stopPropagation());
function documentClickHandler2(event){
    if(!event.target.closest('.smart-control')) closeAllSmartPopovers();
    if(!event.target.closest('.mention-picker') && !event.target.closest('#promptInput')) closeMentionPicker();
    if(!event.target.closest('.prompt-preset-panel') && !event.target.closest('.prompt-preset-edit') && !event.target.closest('.prompt-preset-save')) closePromptPresetPanel();
    if(!event.target.closest('.prompt-template-panel') && !event.target.closest('.prompt-preset-edit') && !event.target.closest('#composerTemplateBtn')) closePromptTemplatePanel();
}
document.addEventListener('click', documentClickHandler2);
function documentKeydownHandler(event){
    if(event.key === 'Escape') { closeAllSmartPopovers(); closeCreateMenu(); closePortDropMenu(); closeCanvasLog(); closeCanvasShortcuts(); closePromptPresetPanel(); closePromptTemplatePanel(); closeNodeAssetSaveModal(); }
}
document.addEventListener('keydown', documentKeydownHandler);
document.getElementById('cropBox').addEventListener('mousedown', event => beginCropDrag(event, 'move'));
document.getElementById('cropHandle').addEventListener('mousedown', event => beginCropDrag(event, 'resize'));
document.getElementById('outpaintFrame').addEventListener('mousedown', event => {
    if(event.target.closest('[data-outpaint-handle]')) return;
    beginCropDrag(event, 'image');
});
document.querySelectorAll('[data-outpaint-handle]').forEach(handle => {
    handle.addEventListener('mousedown', event => beginCropDrag(event, `outpaint-${handle.dataset.outpaintHandle || 'corner'}`));
});
document.getElementById('cropImage').addEventListener('mousedown', event => {
    if(imageEditMode !== 'outpaint' || !cropState) return;
    document.getElementById('cropCanvas')?.classList.add('dragging-image');
    beginCropDrag(event, 'image');
});
document.querySelectorAll('[data-image-edit-mode]').forEach(btn => {
    btn.addEventListener('click', event => {
        event.stopPropagation();
        if(btn.disabled) return;
        setImageEditMode(btn.dataset.imageEditMode || 'crop', true);
    });
});
function imageEditModalPointerdownHandler(event){
    event.stopPropagation();
}
imageEditModal.addEventListener('pointerdown', imageEditModalPointerdownHandler);
function imageEditModalMousedownHandler(event){
    event.stopPropagation();
}
imageEditModal.addEventListener('mousedown', imageEditModalMousedownHandler);
function imageEditModalMousemoveHandler(event){
    if(previewPanDrag || previewCompareDrag || panoramaState.drag || imageEditPanDrag || cropDrag) return;
    event.stopPropagation();
}
imageEditModal.addEventListener('mousemove', imageEditModalMousemoveHandler);
function imageEditModalClickHandler(event){
    event.stopPropagation();
    if(event.target === imageEditModal) closeImageEditor();
}
imageEditModal.addEventListener('click', imageEditModalClickHandler);
function imageEditModalWheelHandler(event){
    event.stopPropagation();
}
imageEditModal.addEventListener('wheel', imageEditModalWheelHandler, {passive:false});
document.getElementById('previewStage').addEventListener('mousedown', event => {
    if(imageEditMode !== 'preview' || event.button !== 0) return;
    if(event.target.closest('.preview-tools-overlay, .preview-download-overlay, .preview-nav-bar')) return;
    if(event.target.closest('.preview-compare-handle')) return;
    if(event.target.closest('video')) return;
    event.preventDefault();
    event.stopPropagation();
    if(panoramaState.enabled){
        panoramaState.drag = {
            clientX:event.clientX,
            clientY:event.clientY,
            yaw:panoramaState.yaw,
            pitch:panoramaState.pitch
        };
        document.getElementById('previewStage')?.classList.add('panning');
        return;
    }
    previewPanDrag = {clientX:event.clientX, clientY:event.clientY, startX:previewPan.x, startY:previewPan.y};
});
document.getElementById('imageEditStage').addEventListener('mousedown', event => {
    if(imageEditMode === 'preview' || event.button !== 0) return;
    if(event.target.closest('.image-edit-actions, .preview-tools-overlay, .preview-download-overlay, .crop-box, .crop-handle')) return;
    if(event.target.closest('#editDrawCanvas, #editTextCanvas, #gridJoinCanvas, .edit-text-inline') && imageEditMode !== 'crop') return;
    const stage = event.currentTarget;
    if(stage.scrollWidth <= stage.clientWidth && stage.scrollHeight <= stage.clientHeight) return;
    event.preventDefault();
    event.stopPropagation();
    imageEditPanDrag = {
        clientX:event.clientX,
        clientY:event.clientY,
        scrollLeft:stage.scrollLeft,
        scrollTop:stage.scrollTop
    };
});
document.getElementById('previewCompareHandle').addEventListener('mousedown', event => {
    if(imageEditMode !== 'preview' || !previewCompareOn || previewCompareIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    previewPanDrag = null;
    previewCompareDrag = true;
    setPreviewComparePos(event.clientX);
});
document.getElementById('previewCompareHandle').addEventListener('pointerdown', event => {
    if(imageEditMode !== 'preview' || !previewCompareOn || previewCompareIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    previewPanDrag = null;
    previewCompareDrag = true;
    setPreviewComparePos(event.clientX);
});
document.getElementById('previewCompareHandle').addEventListener('pointermove', event => {
    if(!previewCompareDrag) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewComparePos(event.clientX);
});
document.getElementById('previewCompareHandle').addEventListener('pointerup', event => {
    if(previewCompareDrag){
        event.preventDefault();
        event.stopPropagation();
    }
    previewCompareDrag = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
});
document.getElementById('previewCompareHandle').addEventListener('pointercancel', event => {
    previewCompareDrag = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
});
document.getElementById('editDrawCanvas').addEventListener('pointerdown', beginEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointermove', moveEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointermove', updateBrushCursor);
document.getElementById('editDrawCanvas').addEventListener('pointerenter', updateBrushCursor);
document.getElementById('editDrawCanvas').addEventListener('pointerleave', hideBrushCursor);
document.getElementById('editDrawCanvas').addEventListener('pointerup', endEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointercancel', endEditDraw);
document.getElementById('editDrawCanvas').addEventListener('pointerleave', endEditDraw);
document.getElementById('gridJoinCanvas')?.addEventListener('pointerdown', beginGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointermove', moveGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointerup', endGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointercancel', endGridJoinDrag);
document.getElementById('gridJoinCanvas')?.addEventListener('pointerleave', endGridJoinDrag);
document.getElementById('editTextCanvas')?.addEventListener('pointerdown', beginEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointermove', moveEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointerup', endEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointercancel', endEditText);
document.getElementById('editTextCanvas')?.addEventListener('pointerleave', endEditText);
document.getElementById('editTextCanvas')?.addEventListener('dblclick', event => {
    if(imageEditMode !== 'brush' || brushTool !== 'text') return;
    event.preventDefault(); event.stopPropagation();
    const hit = hitEditTextItem(editTextPoint(event));
    if(hit){
        setSelectedEditTextItem(hit.id);
        beginEditTextInline(hit);
    }
});
['paintBrushSize','paintBrushColor'].forEach(id => {
    const control = document.getElementById(id);
    if(!control) return;
    control.addEventListener('input', syncSelectedEditTextStyleFromBrush);
    control.addEventListener('change', () => { editTextDirty = false; });
});
['maskBrushSize','paintBrushSize','paintBrushColor'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', refreshBrushCursorSize);
});
['gridHorizontalLines','gridVerticalLines','gridGapSize','gridJoinGapSize'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        syncGridGapValue();
        refreshGridSplitPreview();
    });
});
document.querySelectorAll('[data-panorama-ratio]').forEach(btn => {
    btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        applyPanoramaRatio(btn.dataset.panoramaRatio || '16:9');
    });
});
['panoramaRatioW','panoramaRatioH'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
        panoramaState.ratio = 'custom';
        panoramaState.customW = Math.max(1, Math.min(999, Number(document.getElementById('panoramaRatioW')?.value || 16)));
        panoramaState.customH = Math.max(1, Math.min(999, Number(document.getElementById('panoramaRatioH')?.value || 9)));
        refreshPanoramaControls();
        resizePanoramaViewer();
    });
});
document.getElementById('imageEditStage').addEventListener('wheel', event => {
    if(!cropState) return;
    event.preventDefault();
    event.stopPropagation();
    if(imageEditMode === 'preview'){
        if(seekPreviewVideoFrames(event.deltaY > 0 ? 1 : -1)) return;
        if(panoramaState.enabled){
            const factor = event.deltaY < 0 ? 0.92 : 1 / 0.92;
            panoramaState.fov = Math.max(35, Math.min(100, panoramaState.fov * factor));
            updateZoomLabel();
            return;
        }
        const oldZoom = previewZoom;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        previewZoom = Math.max(0.05, previewZoom * factor);
        const frame = document.getElementById('previewFrame');
        const rect = frame?.getBoundingClientRect();
        if(rect){
            const originX = event.clientX - rect.left - rect.width / 2;
            const originY = event.clientY - rect.top - rect.height / 2;
            const ratio = previewZoom / oldZoom;
            previewPan.x -= originX * (ratio - 1);
            previewPan.y -= originY * (ratio - 1);
        }
        applyPreviewTransform();
        return;
    }
    if(imageEditMode === 'gridjoin'){
        const oldZoom = gridJoinZoom;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        gridJoinZoom = Math.max(0.05, Math.min(6.0, gridJoinZoom * factor));
        const frame = document.getElementById('cropCanvas');
        const rect = frame?.getBoundingClientRect();
        if(rect){
            const originX = event.clientX - rect.left - rect.width / 2;
            const originY = event.clientY - rect.top - rect.height / 2;
            const ratio = gridJoinZoom / oldZoom;
            gridJoinPan.x -= originX * (ratio - 1);
            gridJoinPan.y -= originY * (ratio - 1);
        }
        applyGridJoinTransform();
        return;
    }
    const stage = event.currentTarget;
    const oldZoom = imageEditZoom;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    imageEditZoom = Math.max(0.15, Math.min(6.0, imageEditZoom * factor));
    const stageRect = stage.getBoundingClientRect();
    const mx = event.clientX - stageRect.left;
    const my = event.clientY - stageRect.top;
    const contentX = stage.scrollLeft + mx;
    const scale = imageEditZoom / oldZoom;
    const contentY = stage.scrollTop + my;
    applyImageEditZoom(scale);
    stage.scrollLeft = contentX * scale - mx;
    stage.scrollTop = contentY * scale - my;
}, {passive:false});
function windowResizeHandler(){
    if(cropState) syncImageEditOverflow();
    if(panoramaState.enabled) resizePanoramaViewer();
    updateNodeShortcutBar();
}
window.addEventListener('resize', windowResizeHandler);
window.addEventListener('studio-theme-change', event => applyTheme(event.detail?.theme || 'light'));
try {
    const apiChannel = new BroadcastChannel('studio-api');
    apiChannel.onmessage = async event => {
        if(event.data?.type === 'providers-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed'){
            await refreshSmartConfigFromSettings({invalidateParameterSchemas:event.data?.type === 'providers-changed'});
        }
        if(event.data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(event.data);
        if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
    };
} catch(e) {}
function windowFocusHandler(){
    if(Date.now() - lastConfigRefreshAt > 1200) refreshSmartConfigFromSettings();
}
window.addEventListener('focus', windowFocusHandler);
function windowMessageHandler(event){
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'studio-theme') applyTheme(event.data.theme || 'light');
    if(event.data?.type === 'providers-changed' || event.data?.type === 'workflows-changed' || event.data?.type === 'comfy-instances-changed') refreshSmartConfigFromSettings({invalidateParameterSchemas:event.data?.type === 'providers-changed'});
    if(event.data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(event.data);
    if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
}
window.addEventListener('message', windowMessageHandler);
function windowStudioLangChangeHandler(){
    renderDynamicParams();
    renderInputThumbsRow(selectedNode());
    renderAssetLibrary();
    if(document.getElementById('imageEditModal')?.classList.contains('open')){
        setImageEditMode(imageEditMode);
    }
    if(promptTemplatePanel?.classList?.contains('open')) renderPromptTemplatePanel();
    render();
}
async function windowLoadHandler(){
    showBootLoadingOverlay();
    applyTheme(localStorage.getItem('studio_theme') || localStorage.getItem('canvas_theme') || 'dark');
    bindNodeShortcutOverlayEvents();
    bindNodeContextMenuEvents();
    loadPromptPresets();
    loadPromptTemplateGroups();
    loadPromptTemplateOverrides();
    const promptTemplatesPromise = loadPromptTemplates();
    if(window.lucide) lucide.createIcons();
    connectAssetLibrarySyncSocket();
    const canvasLoaded = await loadCanvas({renderCanvas:false});
    const configPromise = loadConfig();
    const assetLibraryPromise = loadAssetLibrary();
    const usagePromise = loadCanvasUsage();
    if(canvasLoaded){
        await renderBootCanvas((percent, label) => {
            updateBootLoadingPercent(percent, label);
        });
        updateBootLoadingPercent(70, '正在校正素材尺寸');
        if(measureSmartNodeImages({applyReady:true, renderOnChange:false})) render();
        resumeSmartPendingTasks();
        startCanvasMetaPoll();
    }
    await waitForVisibleBootMedia(2500, canvasLoaded ? 70 : 0, 100);
    await Promise.allSettled([promptTemplatesPromise, configPromise, assetLibraryPromise, usagePromise]);
    updateComposer();
    updatePromptComposer();
    requestAnimationFrame(() => hideBootLoadingOverlay(() => {
        toast(tr('smart.thumbnailPreviewNotice'));
        const finishBootEnhancements = () => {
            requestRenderMinimap();
            if(window.lucide) lucide.createIcons();
            measureSmartNodeImages();
        };
        if(window.requestIdleCallback) window.requestIdleCallback(finishBootEnhancements, {timeout:1000});
        else setTimeout(finishBootEnhancements, 0);
    }));
}
window.onload = windowLoadHandler;
canvasManagerBtn?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.assign('/static/canvas-manager.html');
});
