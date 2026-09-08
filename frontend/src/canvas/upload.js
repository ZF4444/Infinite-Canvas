// 从 frontend/src/canvas/main.js 剪切出的上传/拖拽/本地文件导入逻辑（M6 拆分批次）。
// 剪切时未改动任何函数签名/内部逻辑，只做了纯粹的位置搬移。
//
// 为什么这里不用 ES module 的 export/import（跟 M1-M5 同一个原因）：
// canvas.js 依赖经典 <script> 的全局作用域语义，
// static/canvas.html 里 57 处内联 onclick="xxx()" 都依赖这一点。
// 所以这里同样只做"物理文件拆分"：upload.js 保持经典脚本语法，通过
// <script src="upload.js"> 排在 cascade-run.js 之后、main.js 之前加载。
//
// 本文件包含三类东西：
//   1. 拖拽数据解析：dataTransferItemEntry / filesFromEntry /
//      uploadFilesFromDataTransfer / smartImageFilesFromDataTransfer /
//      smartDropDataTypes / readSmartDropData / decodeSmartDropText /
//      smartDropTextFragments / uniqueSmartDropValues /
//      smartDropTextCandidates / isRemoteSmartImageDropValue /
//      isLocalSmartImageDropValue / smartLocalImagePathsFromDataTransfer /
//      smartImageNameFromUrl / smartImageDropPayload /
//      resolveSmartImageDropPayload / hasSmartImageDropData /
//      hasSmartAssetDrag / hasMediaDrawerDrag / hasSmartInputThumbDrag /
//      setSmartDropCopyEffect
//   2. 文件上传：isSupportedUploadFile / uploadTitleForItems / uploadFiles /
//      appendImagesToSmartNode / handleFiles / importSmartLocalImages /
//      handleSmartImageDropPayload
//
// 刻意排除（留在 main.js，属于跨模块共享的错误处理/配额提示基础设施，
// 不是上传专属逻辑）：
//   StorageQuotaSignal / quotaDataFromPayload / checkQuotaWarningFromResult /
//   smartResponseError / smartResponseErrorMessage —— 这几个函数虽然物理
//   上原来紧邻在这批上传函数中间，但 checkQuotaWarningFromResult 和
//   StorageQuotaSignal 实际被 M5 拆出去的 cascade-run.js 大量调用
//   （比如 waitSmartComfyTaskResult/runLoopRoundIntoSlot 等），是通用的
//   "生成结果配额检查/网络请求错误处理"基础设施，不是上传功能自己的东西，
//   跟 M5 阶段"createGenerationNodeByKind 留在 main.js"是同一个判断原则：
//   按实际调用关系归属，而不是按物理位置或名字表面含义。
//
// 依赖的外部全局（都还留在 frontend/src/canvas/main.js / main.js 里，
// 通过共享全局作用域访问，未随本文件迁移）：
//   状态变量：nodes, selectedId, undoSuppressed
//   工具函数（M1 已拆到 utils.js）：tr
//   错误/配额处理（原因见上）：smartResponseErrorMessage
//   节点操作：selectedNode, isSmartGroupNode, isSmartImageNode,
//     arrangeSmartGroupMembers, createImageNodeAt, viewportCenter,
//     render, scheduleSave, pushUndo, toast
//   媒体判断：mediaKindForFile, mediaKindForItem
//   上传进度 UI：showUploadProgress, updateUploadProgress, hideUploadProgress
//   外部全局对象：window.MediaForgeUpload（由 /static/js/upload-quota-dialog.js
//     提供，upload() 方法实际发起上传请求并展示进度/配额弹窗）
//   常量（M3 已确认留在 main.js）：MEDIA_NODE_DEFAULT_SCALE,
//     MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE, MEDIA_GROUP_DEFAULT_SCALE

function isSupportedUploadFile(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')
        || /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
}
function dataTransferItemEntry(item){
    try { return item?.webkitGetAsEntry?.() || null; } catch { return null; }
}
async function filesFromEntry(entry){
    if(!entry) return [];
    if(entry.isFile){
        return new Promise(resolve => entry.file(file => resolve(file ? [file] : []), () => resolve([])));
    }
    if(!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children = [];
    while(true){
        const batch = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
        if(!batch.length) break;
        children.push(...batch);
    }
    const nested = await Promise.all(children.map(filesFromEntry));
    return nested.flat();
}
async function uploadFilesFromDataTransfer(dataTransfer){
    const items = [...(dataTransfer?.items || [])];
    const entries = items.map(dataTransferItemEntry).filter(Boolean);
    const raw = entries.length
        ? (await Promise.all(entries.map(filesFromEntry))).flat()
        : [...(dataTransfer?.files || [])];
    return raw.filter(isSupportedUploadFile);
}
function uploadTitleForItems(items, fallback='Upload'){
    const list = [...(items || [])];
    if(!list.length) return fallback;
    const kinds = new Set(list.map(item => item instanceof File ? mediaKindForFile(item) : mediaKindForItem(item)));
    if(kinds.size > 1) return list.length > 1 ? 'Media' : fallback;
    if(kinds.has('video')) return list.length > 1 ? 'Videos' : 'Video';
    if(kinds.has('audio')) return 'Audio';
    return list.length > 1 ? 'Group' : 'Image';
}
const SMART_IMAGE_DROP_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const SMART_IMAGE_DROP_TEXT_TYPES = [
    'text/uri-list',
    'text/plain',
    'text/html',
    'DownloadURL',
    'text/x-moz-url',
    'text/x-file-url',
    'public.file-url',
    'public.url',
    'UniformResourceLocator',
    'FileName',
    'FileNameW'
];
const SMART_IMAGE_DROP_TYPE_HINT_RE = /^(?:files?|image\/.+|text\/(?:uri-list|html|plain|x-moz-url|x-file-url)|downloadurl|public\.(?:file-url|url)|uniformresourcelocator|filenamew?)$|application\/x-qt-(?:windows-mime|image)|application\/x-moz-file|com\.eagle/i;
function smartImageFilesFromDataTransfer(dataTransfer){
    return [...(dataTransfer?.files || [])].filter(isSupportedUploadFile);
}
function smartDropDataTypes(dataTransfer){
    return [...(dataTransfer?.types || [])].map(type => String(type || ''));
}
function readSmartDropData(dataTransfer, type){
    try { return dataTransfer?.getData?.(type) || ''; } catch(_) { return ''; }
}
function decodeSmartDropText(value){
    const text = String(value || '').trim();
    if(!text) return '';
    try { return decodeURIComponent(text); } catch(_) { return text; }
}
function smartDropTextFragments(value){
    const text = String(value || '').trim();
    if(!text) return [];
    const fragments = [];
    if(/<img|<a\s/i.test(text)){
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('img[src],a[href]').forEach(el => fragments.push(el.getAttribute('src') || el.getAttribute('href') || ''));
    }
    text.split(/\r?\n/).forEach(line => {
        const item = line.trim();
        if(item) fragments.push(item);
    });
    const downloadUrl = text.match(/^image\/[^\s:]+:(.+)$/i);
    if(downloadUrl) fragments.push(downloadUrl[1]);
    return fragments;
}
function uniqueSmartDropValues(values){
    const seen = new Set();
    return values.filter(value => {
        const key = String(value || '').trim();
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function smartDropTextCandidates(dataTransfer){
    if(!dataTransfer) return [];
    const types = uniqueSmartDropValues([...SMART_IMAGE_DROP_TEXT_TYPES, ...smartDropDataTypes(dataTransfer)]);
    const values = types.map(type => readSmartDropData(dataTransfer, type)).filter(Boolean);
    return uniqueSmartDropValues(values.flatMap(smartDropTextFragments).map(decodeSmartDropText))
        .filter(s => s && !s.startsWith('#'));
}
function isRemoteSmartImageDropValue(value){
    const text = String(value || '').trim();
    return /^https?:\/\/.+/i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);
}
function isLocalSmartImageDropValue(value){
    const text = String(value || '').trim();
    if(!text) return false;
    let path = text;
    if(/^file:/i.test(path)){
        try {
            const url = new URL(path);
            if(url.protocol !== 'file:') return false;
            path = decodeURIComponent(url.pathname || path);
        } catch(_) {
            return false;
        }
    }
    if(/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1);
    const clean = path.split(/[?#]/, 1)[0];
    const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(clean);
    const isPosixPath = clean.startsWith('/');
    return (isWindowsPath || isPosixPath) && SMART_IMAGE_DROP_EXT_RE.test(clean);
}
function smartLocalImagePathsFromDataTransfer(dataTransfer){
    return uniqueSmartDropValues(smartDropTextCandidates(dataTransfer).filter(isLocalSmartImageDropValue));
}
function smartImageNameFromUrl(url){
    try {
        const clean = String(url || '').split('?', 1)[0].split('#', 1)[0];
        return decodeURIComponent(clean.split('/').pop() || 'image');
    } catch(_) {
        return 'image';
    }
}
function smartImageDropPayload(dataTransfer){
    const files = smartImageFilesFromDataTransfer(dataTransfer);
    if(files.length) return {type:'files', files};
    const localPaths = smartLocalImagePathsFromDataTransfer(dataTransfer);
    if(localPaths.length) return {type:'localPaths', localPaths};
    const url = smartDropTextCandidates(dataTransfer).find(isRemoteSmartImageDropValue) || '';
    if(url) return {type:'url', url};
    return {type:'none'};
}
async function resolveSmartImageDropPayload(dataTransfer){
    const payload = smartImageDropPayload(dataTransfer);
    if(payload.type !== 'none') return payload;
    const files = await uploadFilesFromDataTransfer(dataTransfer);
    return files.length ? {type:'files', files} : payload;
}
function hasSmartImageDropData(dataTransfer){
    if(!dataTransfer) return false;
    if(smartImageFilesFromDataTransfer(dataTransfer).length) return true;
    const types = smartDropDataTypes(dataTransfer);
    if(types.some(type => SMART_IMAGE_DROP_TYPE_HINT_RE.test(type.toLowerCase()))) return true;
    return smartImageDropPayload(dataTransfer).type !== 'none';
}
function hasSmartAssetDrag(dataTransfer){
    return smartDropDataTypes(dataTransfer).includes('application/x-smart-asset');
}
function hasMediaDrawerDrag(dataTransfer){
    return smartDropDataTypes(dataTransfer).includes('application/x-smart-asset');
}
function hasSmartInputThumbDrag(dataTransfer){
    return smartDropDataTypes(dataTransfer).includes('application/x-smart-input-thumb');
}
function setSmartDropCopyEffect(e, includeAsset=false){
    e.preventDefault();
    if(hasSmartInputThumbDrag(e.dataTransfer)) return;
    if(hasSmartImageDropData(e.dataTransfer) || (includeAsset && hasSmartAssetDrag(e.dataTransfer))){
        e.dataTransfer.dropEffect = 'copy';
    }
}
async function uploadFiles(files){
    const supported = [...(files || [])].filter(isSupportedUploadFile);
    if(!supported.length) return [];
    const form = new FormData();
    supported.forEach(file => form.append('files', file, file.name || 'media'));
    showUploadProgress(supported.length);
    try {
        const data = await window.MediaForgeUpload.upload(form, (loaded, total) => updateUploadProgress(loaded, total, supported.length));
        return (data.files || []).map((file, index) => ({
            ...file,
            kind:file.kind || mediaKindForFile(supported[index])
        }));
    } finally {
        hideUploadProgress();
    }
}
function appendImagesToSmartNode(uploaded, targetId='', opts={}){
    const images = [...(uploaded || [])].filter(file => file?.url);
    if(!images.length) return null;
    let node = nodes.find(n => n.id === targetId) || selectedNode();
    if(isSmartGroupNode(node)){
        node.images = [...(node.images || []), ...images.map(file => ({...file, kind:file.kind || mediaKindForItem(file)}))];
        delete node.w;
        delete node.h;
        arrangeSmartGroupMembers(node, {skipUndo:true});
        selectedId = node.id;
        render();
        scheduleSave();
        return node;
    }
    if(node && !isSmartImageNode(node)) node = null;
    if(opts.forceNew) node = null;
    if(!node){
        const center = opts.point || viewportCenter();
        undoSuppressed = true;
        node = createImageNodeAt(center, [], {type:'smart-asset-image'});
        undoSuppressed = false;
    }
    const previousCount = (node.images || []).length;
    node.images = [...(node.images || []), ...images.map(file => ({...file, kind:file.kind || mediaKindForItem(file)}))];
    if(node.images.length > 1){
        node.title = uploadTitleForItems(node.images, 'Group');
        if(previousCount <= 1 && (!Number.isFinite(Number(node.scale)) || Number(node.scale) === MEDIA_NODE_DEFAULT_SCALE || Number(node.scale) === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE)){
            node.scale = MEDIA_GROUP_DEFAULT_SCALE;
        }
        delete node.w;
        delete node.h;
    }
    if(node.images.length === 1){ node.title = uploadTitleForItems(node.images, node.title || 'Image'); delete node.w; delete node.h; }
    selectedId = node.id;
    render();
    scheduleSave();
    return node;
}
async function handleFiles(files, targetId='', opts={}){
    try {
        const fileList = [...(files || [])].filter(isSupportedUploadFile);
        if(!fileList.length) return null;
        const uploaded = await uploadFiles(fileList);
        if(!uploaded.length) return null;
        if(!opts.skipUndo) pushUndo();
        const normalized = uploaded.map((file, index) => ({...file, kind:file.kind || mediaKindForFile(fileList[index])}));
        const node = appendImagesToSmartNode(normalized, targetId, opts);
        return {uploaded:normalized, node};
    } catch(e) { toast(e.message || tr('smart.toastUploadFail')); return null; }
}
async function importSmartLocalImages(paths){
    if(!paths?.length) return [];
    const response = await fetch('/api/ai/import-local-image', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paths})
    });
    if(!response.ok) throw new Error(await smartResponseErrorMessage(response, tr('smart.toastUploadFail')));
    const data = await response.json();
    return data.files || [];
}
async function handleSmartImageDropPayload(payload, targetId='', opts={}){
    try {
        if(payload.type === 'files') await handleFiles(payload.files, targetId, opts);
        else if(payload.type === 'localPaths') {
            if(!opts.skipUndo) pushUndo();
            appendImagesToSmartNode(await importSmartLocalImages(payload.localPaths), targetId, opts);
        } else if(payload.type === 'url') {
            throw new Error('外部 URL 不能直接进入画布，请先上传或导入为文件');
        }
    } catch(e) {
        toast(e.message || tr('smart.toastUploadFail'));
    }
}
