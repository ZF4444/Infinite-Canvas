// asset-manager 页面 —— 资产库（图片/视频等媒体素材）管理子系统
// （拆分自 static/js/asset-manager.js）。
//
// 范围：资产库/分类的读取与查找（assetLibraries/activeAssetLibrary/
// assetCategories/currentAssetItems/findAssetItem/selectedAsset）、
// 资产库主面板渲染（renderAssetManager，含库/分类树 + 卡片网格）、
// 资产详情面板渲染（renderAssetDetail）、文件上传（uploadFiles）、
// 资产库/分类的创建/改名/删除（createAssetLibrary/renameAssetLibrary/
// deleteAssetLibrary/createAssetCategory/renameAssetCategory/
// deleteAssetCategory）、单条资产的改名/编辑/删除
// （renameAssetItem/saveAssetEdit/saveAssetInlineName/deleteAssetItem/
// deleteSelectedAssets）、资产剪贴板（setAssetClipboard/
// pasteAssetClipboard，用于库内/跨库移动）、"本地"剪贴板到资产库的
// 粘贴桥接（setLocalClipboard/pasteLocalClipboardToAssets，是本地磁盘
// 素材和正式资产库之间唯一的桥梁）、批量移动（moveSelectedAssets）。
//
// 经典 <script>，非 ES module，原因同 storage-manager.js。
//
// 依赖 main.js 保留的核心状态和函数：assetLibrary/activeAssetLibraryId/
// activeAssetCategoryId/selectedAssetId/selectedAssetIds/assetQuery/
// assetManageMode/assetMoveTarget/assetClipboard/assetEditMode/
// pendingDeleteAssetId/pendingBatchDelete/assetTreeEdit/
// pendingTreeDelete/assetTreeFocus（资产库子系统的全部可变状态）、
// localClipboard/selectedLocalUploadIds（"本地"剪贴板桥接需要读写这两个
// 属于本地素材子系统的状态，跨模块共享，留在 main.js）、escapeHtml/
// escapeAttr/apiJson/setStatus/refreshIcons/formatDate/formatFileSize
// （通用工具）、assetKind/assetKindLabel/assetThumb（通用素材类型判断和
// 缩略图渲染，被资产库/本地/存储等多个子系统共用，留在 main.js）、
// uploadInput（文件选择 DOM 元素）、render（主渲染入口）。

function assetLibraries(){
    return Array.isArray(assetLibrary.libraries) && assetLibrary.libraries.length
        ? assetLibrary.libraries
        : [{id:'default', name:'默认资产库', categories:assetLibrary.categories || []}];
}
function activeAssetLibrary(){
    const libs = assetLibraries();
    return libs.find(lib => lib.id === activeAssetLibraryId) || libs[0] || null;
}
function assetCategories(){
    return (activeAssetLibrary()?.categories || []).filter(cat => (cat.type || 'image') === 'image');
}
function activeAssetCategory(){
    const cats = assetCategories();
    return cats.find(cat => cat.id === activeAssetCategoryId) || cats[0] || null;
}
function assetCountForLibrary(lib){
    return (lib?.categories || []).reduce((sum, cat) => sum + ((cat.items || []).length), 0);
}
function currentAssetItems(){
    const query = assetQuery.trim().toLowerCase();
    return (activeAssetCategory()?.items || []).filter(item => {
        if(!query) return true;
        return [item.name, item.url, assetKindLabel(item)].join(' ').toLowerCase().includes(query);
    });
}
function assetMoveTargets(){
    const currentKey = `${activeAssetLibraryId}::${activeAssetCategoryId}`;
    const targets = [];
    assetLibraries().forEach(lib => {
        (lib.categories || []).filter(cat => (cat.type || 'image') === 'image').forEach(cat => {
            const key = `${lib.id}::${cat.id}`;
            if(key !== currentKey) targets.push({key, libraryId:lib.id, categoryId:cat.id, label:`${lib.name || '资产库'} / ${cat.name || '分组'}`});
        });
    });
    return targets;
}
function normalizeAssetMoveTarget(){
    const targets = assetMoveTargets();
    if(!targets.some(item => item.key === assetMoveTarget)) assetMoveTarget = targets[0]?.key || '';
    return targets;
}
function findAssetItem(id){
    for(const lib of assetLibraries()) for(const cat of lib.categories || []) for(const item of cat.items || []) if(item.id === id) return item;
    return null;
}
function selectedAsset(){
    const items = currentAssetItems();
    return items.find(item => item.id === selectedAssetId) || items[0] || null;
}
function normalizeAssetState(){
    const libs = assetLibraries();
    if(!activeAssetLibraryId || !libs.some(lib => lib.id === activeAssetLibraryId)) activeAssetLibraryId = assetLibrary.active_library_id || libs[0]?.id || '';
    const cats = assetCategories();
    if(!activeAssetCategoryId || !cats.some(cat => cat.id === activeAssetCategoryId)) activeAssetCategoryId = cats[0]?.id || '';
    const items = currentAssetItems();
    if(selectedAssetId && !items.some(item => item.id === selectedAssetId)) selectedAssetId = '';
    if(!selectedAssetId && items.length) selectedAssetId = items[0].id;
    selectedAssetIds = new Set([...selectedAssetIds].filter(id => findAssetItem(id)));
}
function renderAssetManager(){
    normalizeAssetState();
    const libs = assetLibraries();
    const cats = assetCategories();
    const lib = activeAssetLibrary();
    const cat = activeAssetCategory();
    const items = currentAssetItems();
    const detail = selectedAsset();
    root.innerHTML = `
        <aside class="asset-panel asset-nav">
            <div class="panel-head">
                <div class="panel-title"><strong>资产层级</strong><span>先选库，再选分组</span></div>
                <div class="panel-actions compact-actions">
                    <button class="asset-icon-btn" type="button" data-asset-lib-new title="新建资产库"><i data-lucide="plus"></i></button>
                </div>
            </div>
            <div class="nav-scroll">
                <div class="nav-tree">
                    ${libs.map(item => renderAssetTreeBranch(item)).join('')}
                </div>
            </div>
        </aside>
        <section class="asset-panel asset-content ${assetManageMode ? 'manage-on' : ''}">
            <div class="content-toolbar">
                <div class="content-heading">
                    <strong>${escapeHtml(cat?.name || '图片资产')}</strong>
                    <span>${escapeHtml(lib?.name || '资产库')} / ${items.length} 个素材</span>
                </div>
                <div class="asset-tools">
                    <label class="asset-search-wrap"><i data-lucide="search"></i><input id="assetSearch" class="asset-search" type="search" value="${escapeAttr(assetQuery)}" placeholder="搜索素材"></label>
                    <button class="asset-btn ${assetManageMode ? 'primary' : ''}" type="button" data-asset-manage><i data-lucide="list-checks"></i><span>${assetManageMode ? '完成管理' : '批量管理'}</span></button>
                </div>
            </div>
            ${renderAssetClipboardBar()}
            ${renderLocalClipboardBar()}
            <div class="manage-tools">
                <span>已选择 ${selectedAssetIds.size} 个素材，支持拖拽框选或逐个勾选。</span>
                <div class="asset-tools">
                    <button class="asset-btn" type="button" data-asset-select-all ${items.length ? '' : 'disabled'}><i data-lucide="check-square"></i><span>全选</span></button>
                    <button class="asset-btn" type="button" data-asset-clear-selection ${selectedAssetIds.size ? '' : 'disabled'}><i data-lucide="square"></i><span>清空</span></button>
                    <button class="asset-btn" type="button" data-asset-cut-selected ${selectedAssetIds.size ? '' : 'disabled'}><i data-lucide="scissors"></i><span>剪切</span></button>
                    <button class="asset-btn" type="button" data-asset-copy-selected ${selectedAssetIds.size ? '' : 'disabled'}><i data-lucide="copy"></i><span>复制</span></button>
                    <button class="asset-btn danger" type="button" data-asset-delete-selected ${selectedAssetIds.size ? '' : 'disabled'}><i data-lucide="trash-2"></i><span>删除所选</span></button>
                </div>
            </div>
            <div class="content-scroll">
                <div class="asset-grid">
                    ${renderUploadCard(cat)}
                    ${items.map(item => renderAssetCard(item)).join('')}
                    ${items.length ? '' : '<div class="empty-state">当前分组还没有素材，可以上传，或从画布输出保存到素材库。</div>'}
                </div>
            </div>
        </section>
        <aside class="asset-panel asset-detail">
            ${renderAssetDetail(detail)}
        </aside>
    `;
    hydrateAssetDetailMetadata(detail);
}
function hydrateAssetDetailMetadata(item){
    if(!item || item._metadataLoading) return;
    const hasResolution = Number(item.natural_w || item.width || item.w || 0) > 0 && Number(item.natural_h || item.height || item.h || 0) > 0;
    const hasSize = Number(item.size || item.size_bytes || 0) > 0;
    const fileId = String(item.file_id || '').trim();
    if(hasResolution && (hasSize || !fileId)) return;
    item._metadataLoading = true;
    let changed = false;
    const finish = (width=0, height=0, fileMeta=null) => {
        if(width > 0 && height > 0 && (!hasResolution || item.natural_w !== width || item.natural_h !== height)){
            item.natural_w = width;
            item.natural_h = height;
            changed = true;
        }
        if(fileMeta){
            if(Number(fileMeta.size) > 0 && Number(item.size || item.size_bytes || 0) <= 0){ item.size = Number(fileMeta.size); changed = true; }
            if(Number(fileMeta.created_at) > 0 && !Number(item.created_at)){ item.created_at = Number(fileMeta.created_at); changed = true; }
        }
        delete item._metadataLoading;
        if(changed && selectedAsset() === item) render();
    };
    const mediaKind = assetKind(item);
    const metadataPromise = fileId
        ? fetch(`/api/files/${encodeURIComponent(fileId)}`).then(response => response.ok ? response.json() : null).catch(() => null)
        : Promise.resolve(null);
    if(mediaKind === 'video'){
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => metadataPromise.then(meta => finish(probe.videoWidth, probe.videoHeight, meta));
        probe.onerror = () => metadataPromise.then(meta => finish(0, 0, meta));
        probe.src = item.url || (fileId ? `/api/files/${encodeURIComponent(fileId)}/preview` : '');
    } else if(mediaKind === 'image'){
        const probe = new Image();
        probe.onload = () => metadataPromise.then(meta => finish(probe.naturalWidth, probe.naturalHeight, meta));
        probe.onerror = () => metadataPromise.then(meta => finish(0, 0, meta));
        probe.src = item.url || (fileId ? `/api/files/${encodeURIComponent(fileId)}/preview` : '');
    } else {
        metadataPromise.then(meta => finish(0, 0, meta));
    }
}
function renderUploadCard(cat){
    return `<button id="assetDrop" class="upload-grid-card" type="button" data-asset-upload ${!cat ? 'disabled' : ''}>
        <span class="upload-thumb"><i data-lucide="upload-cloud"></i></span>
        <span class="upload-body">
            <strong>上传到当前分组</strong>
            <small>拖入文件或点击上传</small>
        </span>
    </button>`;
}
function renderAssetClipboardBar(){
    if(!assetClipboard?.ids?.length) return '';
    const modeLabel = assetClipboard.mode === 'cut' ? '剪切' : '复制';
    const sameTarget = assetClipboard.sourceLibraryId === activeAssetLibraryId && assetClipboard.sourceCategoryId === activeAssetCategoryId;
    const pasteText = sameTarget && assetClipboard.mode === 'cut' ? '选择其他分组后粘贴' : '粘贴到当前分组';
    return `<div class="asset-clipboard-bar">
        <div class="asset-clipboard-info"><i data-lucide="clipboard"></i><span>${escapeHtml(modeLabel)}了 ${assetClipboard.ids.length} 个素材</span></div>
        <div class="asset-tools">
            <button class="asset-btn primary" type="button" data-asset-paste-clipboard ${sameTarget && assetClipboard.mode === 'cut' ? 'disabled' : ''}><i data-lucide="clipboard-paste"></i><span>${escapeHtml(pasteText)}</span></button>
            <button class="asset-icon-btn" type="button" data-asset-clear-clipboard title="清空剪贴板"><i data-lucide="x"></i></button>
        </div>
    </div>`;
}
function renderAssetTreeBranch(lib){
    const isActiveLib = lib.id === activeAssetLibraryId;
    const cats = (lib.categories || []).filter(cat => (cat.type || 'image') === 'image');
    const showLibActions = isActiveLib && assetTreeFocus === 'library';
    return `<div class="tree-branch ${isActiveLib ? 'expanded' : ''}">
        <button class="tree-row tree-parent ${isActiveLib ? 'contains-active' : ''} ${showLibActions ? 'active' : ''}" type="button" data-asset-lib="${escapeAttr(lib.id)}">
            <span class="tree-row-icon"><i data-lucide="${isActiveLib ? 'folder-open' : 'folder'}"></i></span>
            <span class="tree-row-name">${escapeHtml(lib.name || '资产库')}</span>
            <span class="tree-row-count">${assetCountForLibrary(lib)}</span>
        </button>
        ${showLibActions ? renderAssetTreeActionBar('library') : ''}
        <div class="tree-children">
            ${cats.length ? cats.map(cat => `<button class="tree-row tree-child ${isActiveLib && cat.id === activeAssetCategoryId && assetTreeFocus === 'category' ? 'active' : ''}" type="button" data-asset-cat="${escapeAttr(cat.id)}" data-asset-cat-lib="${escapeAttr(lib.id)}">
                <span class="tree-elbow"></span>
                <span class="tree-row-icon"><i data-lucide="image"></i></span>
                <span class="tree-row-name">${escapeHtml(cat.name || '分组')}</span>
                <span class="tree-row-count">${(cat.items || []).length}</span>
            </button>${isActiveLib && cat.id === activeAssetCategoryId && assetTreeFocus === 'category' ? renderAssetTreeActionBar('category') : ''}`).join('') : '<div class="tree-empty">暂无分组</div>'}
        </div>
    </div>`;
}
function renderAssetTreeActionBar(kind){
    const editHtml = renderAssetTreeInlineEdit(kind);
    if(editHtml) return editHtml;
    const deleteKey = kind === 'library' ? `asset-lib:${activeAssetLibraryId}` : `asset-cat:${activeAssetCategoryId}`;
    if(kind === 'library'){
        return `<div class="tree-action-bar library-actions">
            <button type="button" data-asset-cat-new><i data-lucide="folder-plus"></i><span>新分组</span></button>
            <button type="button" data-asset-lib-rename><i data-lucide="pencil"></i><span>重命名</span></button>
            <button type="button" class="danger ${pendingTreeDelete === deleteKey ? 'detail-confirm' : ''}" data-asset-lib-delete><i data-lucide="trash-2"></i><span>${pendingTreeDelete === deleteKey ? '确认删除' : '删除库'}</span></button>
        </div>`;
    }
    return `<div class="tree-action-bar child-actions">
        <button type="button" data-asset-cat-new><i data-lucide="folder-plus"></i><span>新分组</span></button>
        <button type="button" data-asset-cat-rename><i data-lucide="pencil"></i><span>重命名</span></button>
        <button type="button" class="danger ${pendingTreeDelete === deleteKey ? 'detail-confirm' : ''}" data-asset-cat-delete><i data-lucide="trash-2"></i><span>${pendingTreeDelete === deleteKey ? '确认删除' : '删除'}</span></button>
    </div>`;
}
function renderAssetTreeInlineEdit(kind){
    if(!assetTreeEdit) return '';
    const expectedKinds = kind === 'library'
        ? ['library-new', 'library-rename', 'category-new']
        : ['category-new', 'category-rename'];
    if(!expectedKinds.includes(assetTreeEdit.kind)) return '';
    const label = assetTreeEdit.label || '名称';
    return `<div class="tree-inline-edit ${kind === 'category' ? 'child-actions' : 'library-actions'}">
        <input id="assetTreeEditInput" type="text" value="${escapeAttr(assetTreeEdit.value || '')}" placeholder="${escapeAttr(label)}">
        <button type="button" class="primary" data-asset-tree-edit-save><i data-lucide="check"></i><span>保存</span></button>
        <button type="button" data-asset-tree-edit-cancel><i data-lucide="x"></i><span>取消</span></button>
    </div>`;
}
function renderAssetCard(item){
    return `<article class="asset-card ${item.id === selectedAssetId ? 'active' : ''}" data-asset-card="${escapeAttr(item.id)}">
        <input class="asset-card-check" type="checkbox" data-asset-check="${escapeAttr(item.id)}" ${selectedAssetIds.has(item.id) ? 'checked' : ''}>
        <div class="asset-thumb">${assetThumb(item)}</div>
        <div class="asset-card-body">
            <div class="asset-card-name" title="${escapeAttr(item.name || '')}">${escapeHtml(item.name || 'asset')}</div>
            <div class="asset-card-meta">${escapeHtml(assetKindLabel(item))} · ${escapeHtml(formatDate(item.created_at))}</div>
        </div>
    </article>`;
}
function renderAssetDetail(item){
    if(!item) return `<div class="panel-head"><div class="panel-title"><strong>素材预览</strong><span>选择一个素材查看详情</span></div></div><div class="detail-scroll"><div class="detail-empty"><i data-lucide="image"></i><span>暂无可预览素材</span></div></div>`;
    if(assetEditMode && item.id === selectedAssetId){
        const resolution = Number(item.natural_w || item.width || item.w || 0) > 0 && Number(item.natural_h || item.height || item.h || 0) > 0 ? `${Number(item.natural_w || item.width || item.w)} × ${Number(item.natural_h || item.height || item.h)}` : '未知';
        const size = Number(item.size || item.size_bytes || 0) > 0 ? formatFileSize(item.size || item.size_bytes) : '未知';
        return `
            <div class="panel-head">
                <div class="panel-title"><strong>编辑素材</strong><span>当前分组内直接保存</span></div>
                <div class="panel-actions">
                    <button class="asset-btn primary" type="button" data-asset-edit-save="${escapeAttr(item.id)}"><i data-lucide="check"></i><span>保存</span></button>
                    <button class="asset-icon-btn" type="button" data-asset-edit-cancel title="取消"><i data-lucide="x"></i></button>
                </div>
            </div>
            <div class="detail-scroll">
                <div class="detail-media"><button class="detail-media-frame detail-media-zoomable" type="button" data-asset-preview="${escapeAttr(item.id)}" title="点击放大预览">${assetThumb(item)}</button></div>
                <div class="inline-edit-form">
                    <label class="inline-edit-field"><span>素材名称</span><input id="assetEditName" type="text" value="${escapeAttr(item.name || '')}" placeholder="素材名称"></label>
                    <div class="detail-meta-grid">
                        <div class="detail-meta"><span>类型</span><strong>${escapeHtml(assetKindLabel(item))}</strong></div>
                        <div class="detail-meta"><span>分辨率</span><strong>${escapeHtml(resolution)}</strong></div>
                        <div class="detail-meta"><span>文件大小</span><strong>${escapeHtml(size)}</strong></div>
                        <div class="detail-meta"><span>创建时间</span><strong>${escapeHtml(formatDate(item.created_at))}</strong></div>
                    </div>
                    <div class="detail-url">${escapeHtml(item.url || '')}</div>
                </div>
            </div>
        `;
    }
    const resolution = Number(item.natural_w || item.width || item.w || 0) > 0 && Number(item.natural_h || item.height || item.h || 0) > 0 ? `${Number(item.natural_w || item.width || item.w)} × ${Number(item.natural_h || item.height || item.h)}` : '未知';
    const size = Number(item.size || item.size_bytes || 0) > 0 ? formatFileSize(item.size || item.size_bytes) : '未知';
    return `
        <div class="panel-head">
            <div class="panel-title"><strong>素材预览</strong><span>${escapeHtml(assetKindLabel(item))}</span></div>
            <div class="panel-actions">
                <button class="asset-icon-btn" type="button" data-asset-open="${escapeAttr(item.id)}" title="打开素材"><i data-lucide="external-link"></i></button>
                <button class="asset-icon-btn" type="button" data-asset-edit-start="${escapeAttr(item.id)}" title="编辑"><i data-lucide="pencil"></i></button>
                <button class="asset-icon-btn danger ${pendingDeleteAssetId === item.id ? 'detail-confirm' : ''}" type="button" data-asset-delete="${escapeAttr(item.id)}" title="${pendingDeleteAssetId === item.id ? '再次点击确认删除' : '删除'}"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
        <div class="detail-scroll">
            <div class="detail-media"><button class="detail-media-frame detail-media-zoomable" type="button" data-asset-preview="${escapeAttr(item.id)}" title="点击放大预览">${assetThumb(item)}</button></div>
            <div class="detail-body">
                <input class="detail-name-input" data-asset-inline-name="${escapeAttr(item.id)}" type="text" value="${escapeAttr(item.name || 'asset')}" title="直接修改名称">
                    <div class="detail-meta-grid">
                        <div class="detail-meta"><span>类型</span><strong>${escapeHtml(assetKindLabel(item))}</strong></div>
                        <div class="detail-meta"><span>分辨率</span><strong>${escapeHtml(resolution)}</strong></div>
                        <div class="detail-meta"><span>文件大小</span><strong>${escapeHtml(size)}</strong></div>
                        <div class="detail-meta"><span>创建时间</span><strong>${escapeHtml(formatDate(item.created_at))}</strong></div>
                    <div class="detail-meta"><span>资产库</span><strong>${escapeHtml(activeAssetLibrary()?.name || '资产库')}</strong></div>
                    <div class="detail-meta"><span>分组</span><strong>${escapeHtml(activeAssetCategory()?.name || '分组')}</strong></div>
                </div>
                <div class="detail-url">${escapeHtml(item.url || '')}</div>
                ${renderAvatarSection(item)}
            </div>
        </div>
    `;
}
async function uploadFiles(files){
    const cat = activeAssetCategory();
    if(!cat) throw new Error('请先创建图片分组');
    const form = new FormData();
    [...files].forEach(file => form.append('files', file));
    const uploaded = await window.MediaForgeUpload.upload(form);
    if(uploaded.quota_exceeded){
        setStatus('存储空间不足');
        return;
    }
    const items = (uploaded.files || []).filter(file => file?.file_id).map(file => ({
        library_id:activeAssetLibraryId,
        category_id:activeAssetCategoryId,
        file_id:file.file_id,
        name:file.name || 'asset'
    }));
    if(!items.length) throw new Error('没有可保存的素材');
    const data = await apiJson('/api/asset-library/items/batch', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({library_id:activeAssetLibraryId, category_id:activeAssetCategoryId, items})
    });
    assetLibrary = data.library || assetLibrary;
    selectedAssetIds.clear();
    selectedAssetId = data.items?.[0]?.id || selectedAssetId;
    render();
    setStatus(`已上传 ${items.length} 个素材`);
    return {count:items.length, items:data.items || []};
}
async function createAssetLibrary(){
    const name = window.prompt('资产库名称', '新资产库');
    if(!String(name || '').trim()) return;
    const data = await apiJson('/api/asset-library/libraries', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
    assetLibrary = data.library || assetLibrary;
    activeAssetLibraryId = data.asset_library?.id || activeAssetLibraryId;
    activeAssetCategoryId = '';
    selectedAssetId = '';
    render();
}
async function saveAssetTreeEdit(){
    if(!assetTreeEdit) return;
    const name = document.getElementById('assetTreeEditInput')?.value || '';
    if(!String(name || '').trim()){
        setStatus('名称不能为空');
        return;
    }
    let data = null;
    if(assetTreeEdit.kind === 'library-new'){
        data = await apiJson('/api/asset-library/libraries', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
        assetLibrary = data.library || assetLibrary;
        activeAssetLibraryId = data.asset_library?.id || activeAssetLibraryId;
        assetTreeFocus = 'library';
    } else if(assetTreeEdit.kind === 'library-rename'){
        const lib = activeAssetLibrary();
        if(!lib) return;
        data = await apiJson(`/api/asset-library/libraries/${encodeURIComponent(lib.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
        assetLibrary = data.library || assetLibrary;
        assetTreeFocus = 'library';
    } else if(assetTreeEdit.kind === 'category-new'){
        data = await apiJson('/api/asset-library/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:activeAssetLibraryId, name, type:'image'})});
        assetLibrary = data.library || assetLibrary;
        activeAssetCategoryId = data.category?.id || activeAssetCategoryId;
        assetTreeFocus = 'category';
    } else if(assetTreeEdit.kind === 'category-rename'){
        const cat = activeAssetCategory();
        if(!cat) return;
        data = await apiJson(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
        assetLibrary = data.library || assetLibrary;
        assetTreeFocus = 'category';
    }
    assetTreeEdit = null;
    pendingTreeDelete = '';
    render();
    setStatus('已保存');
}
async function renameAssetLibrary(){
    const lib = activeAssetLibrary();
    const name = window.prompt('资产库名称', lib?.name || '');
    if(!lib || !String(name || '').trim()) return;
    const data = await apiJson(`/api/asset-library/libraries/${encodeURIComponent(lib.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
    assetLibrary = data.library || assetLibrary;
    render();
}
async function deleteAssetLibrary(){
    const lib = activeAssetLibrary();
    if(!lib) return;
    const key = `asset-lib:${lib.id}`;
    if(pendingTreeDelete !== key){
        pendingTreeDelete = key;
        assetTreeEdit = null;
        render();
        setStatus('再次点击确认删除资产库');
        return;
    }
    const data = await apiJson(`/api/asset-library/libraries/${encodeURIComponent(lib.id)}`, {method:'DELETE'});
    assetLibrary = data.library || assetLibrary;
    activeAssetLibraryId = assetLibrary.active_library_id || assetLibraries()[0]?.id || '';
    activeAssetCategoryId = '';
    selectedAssetId = '';
    selectedAssetIds.clear();
    pendingTreeDelete = '';
    render();
}
async function createAssetCategory(){
    const name = window.prompt('分组名称', '新分组');
    if(!String(name || '').trim()) return;
    const data = await apiJson('/api/asset-library/categories', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:activeAssetLibraryId, name, type:'image'})});
    assetLibrary = data.library || assetLibrary;
    activeAssetCategoryId = data.category?.id || activeAssetCategoryId;
    selectedAssetId = '';
    render();
}
async function renameAssetCategory(){
    const cat = activeAssetCategory();
    const name = window.prompt('分组名称', cat?.name || '');
    if(!cat || !String(name || '').trim()) return;
    const data = await apiJson(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
    assetLibrary = data.library || assetLibrary;
    render();
}
async function deleteAssetCategory(){
    const cat = activeAssetCategory();
    if(!cat) return;
    const key = `asset-cat:${cat.id}`;
    if(pendingTreeDelete !== key){
        pendingTreeDelete = key;
        assetTreeEdit = null;
        render();
        setStatus('再次点击确认删除分组');
        return;
    }
    const data = await apiJson(`/api/asset-library/categories/${encodeURIComponent(cat.id)}`, {method:'DELETE'});
    assetLibrary = data.library || assetLibrary;
    activeAssetCategoryId = '';
    selectedAssetId = '';
    selectedAssetIds.clear();
    pendingTreeDelete = '';
    render();
}
async function renameAssetItem(id){
    const item = findAssetItem(id);
    const name = window.prompt('素材名称', item?.name || '');
    if(!item || !String(name || '').trim()) return;
    const data = await apiJson(`/api/asset-library/items/${encodeURIComponent(id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
    assetLibrary = data.library || assetLibrary;
    selectedAssetId = id;
    render();
}
async function saveAssetEdit(id){
    const item = findAssetItem(id);
    const name = document.getElementById('assetEditName')?.value || '';
    if(!item || !String(name || '').trim()) {
        setStatus('素材名称不能为空');
        return;
    }
    const data = await apiJson(`/api/asset-library/items/${encodeURIComponent(id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
    assetLibrary = data.library || assetLibrary;
    selectedAssetId = id;
    assetEditMode = false;
    render();
    setStatus('素材已保存');
}
async function saveAssetInlineName(id, name){
    const item = findAssetItem(id);
    if(!item || !String(name || '').trim()) return;
    if(String(item.name || '') === String(name || '')) return;
    const data = await apiJson(`/api/asset-library/items/${encodeURIComponent(id)}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})});
    assetLibrary = data.library || assetLibrary;
    selectedAssetId = id;
    render();
    setStatus('素材名称已保存');
}
async function deleteAssetItem(id){
    const item = findAssetItem(id);
    if(!item) return;
    const data = await apiJson(`/api/asset-library/items/${encodeURIComponent(id)}`, {method:'DELETE'});
    assetLibrary = data.library || assetLibrary;
    selectedAssetIds.delete(id);
    if(selectedAssetId === id) selectedAssetId = '';
    pendingDeleteAssetId = '';
    render();
    setStatus('已移出素材库，源文件仍保留');
}
async function deleteSelectedAssets(){
    if(!selectedAssetIds.size) return;
    const ids = [...selectedAssetIds];
    const data = await apiJson('/api/asset-library/items/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({library_id:activeAssetLibraryId, ids})});
    assetLibrary = data.library || assetLibrary;
    if(ids.includes(selectedAssetId)) selectedAssetId = '';
    selectedAssetIds.clear();
    pendingBatchDelete = '';
    render();
    setStatus(`已移出素材库 ${data.removed || ids.length} 个，源文件仍保留`);
}
function setAssetClipboard(mode){
    if(!selectedAssetIds.size) return;
    assetClipboard = {
        mode,
        ids:[...selectedAssetIds],
        sourceLibraryId:activeAssetLibraryId,
        sourceCategoryId:activeAssetCategoryId,
        items:[...selectedAssetIds].map(id => findAssetItem(id)).filter(Boolean)
    };
    selectedAssetIds.clear();
    pendingBatchDelete = '';
    render();
    const label = mode === 'cut' ? '剪切' : '复制';
    setStatus(`${label}了 ${assetClipboard.ids.length} 个素材，切换分组后粘贴`);
}
async function pasteAssetClipboard(){
    if(!assetClipboard?.ids?.length) return;
    if(assetClipboard.mode === 'cut'){
        if(assetClipboard.sourceLibraryId === activeAssetLibraryId && assetClipboard.sourceCategoryId === activeAssetCategoryId) return;
        const data = await apiJson('/api/asset-library/items/move', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:assetClipboard.sourceLibraryId, target_library_id:activeAssetLibraryId, target_category_id:activeAssetCategoryId, ids:assetClipboard.ids})
        });
        assetLibrary = data.library || assetLibrary;
        setStatus(`已移动 ${data.moved || 0} 个素材`);
    } else {
        const items = (assetClipboard.items || []).map(item => ({file_id:item.file_id, name:item.name || 'asset'})).filter(item => item.file_id);
        const data = await apiJson('/api/asset-library/items/batch', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({library_id:activeAssetLibraryId, category_id:activeAssetCategoryId, items})
        });
        assetLibrary = data.library || assetLibrary;
        setStatus(`已复制 ${data.items?.length || 0} 个素材`);
    }
    assetClipboard = null;
    selectedAssetIds.clear();
    selectedAssetId = '';
    render();
}
function setLocalClipboard(mode, ids=null){
    // 共享文件夹只读，仅支持「复制」（引用导入），不支持剪切删除源文件
    const sourceIds = Array.isArray(ids) ? ids.filter(Boolean) : [...selectedLocalIds];
    if(!sourceIds.length) return;
    const items = sourceIds.map(id => findLocalItem(id)).filter(Boolean);
    if(!items.length) return;
    localClipboard = {
        mode:'copy',
        ids:items.map(item => item.id),
        items,
        sourceRootName:activeSharedFolderName || '共享文件夹'
    };
    selectedLocalIds.clear();
    pendingBatchDelete = '';
    render();
    setStatus(`复制了 ${items.length} 个共享素材，导入后会拷贝到图片资产分组（共享文件夹原文件保留）`);
}
async function pasteLocalClipboardToAssets(){
    if(!localClipboard?.items?.length) return;
    if(!activeAssetCategory()){
        setStatus('请先在图片资产中创建或选择分组');
        return;
    }
    const clip = localClipboard;
    // 按所属共享文件夹分组，调用后端按路径导入（复制到素材库，无需走浏览器文件对象）
    const groups = new Map();
    clip.items.forEach(item => {
        if(!item || !item.folderId || !item.relativePath) return;
        if(!groups.has(item.folderId)) groups.set(item.folderId, []);
        groups.get(item.folderId).push(item.relativePath);
    });
    if(!groups.size) return;
    setStatus('正在导入共享素材...');
    let imported = 0;
    try {
        for(const [folderId, paths] of groups){
            const data = await apiJson('/api/shared-folders/import', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({library_id:activeAssetLibraryId, category_id:activeAssetCategoryId, folder_id:folderId, paths})
            });
            assetLibrary = data.library || assetLibrary;
            imported += (data.items?.length || 0);
        }
    } catch(err) {
        setStatus(err.message || '导入共享素材失败');
        return;
    }
    localClipboard = null;
    selectedLocalIds.clear();
    selectedLocalId = '';
    render();
    setStatus(`已导入 ${imported} 个素材到图片资产`);
}
async function moveSelectedAssets(){
    if(!selectedAssetIds.size || !assetMoveTarget) return;
    const [targetLibraryId, targetCategoryId] = assetMoveTarget.split('::');
    if(!targetLibraryId || !targetCategoryId) return;
    const ids = [...selectedAssetIds];
    const data = await apiJson('/api/asset-library/items/move', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({library_id:activeAssetLibraryId, target_library_id:targetLibraryId, target_category_id:targetCategoryId, ids})
    });
    assetLibrary = data.library || assetLibrary;
    selectedAssetIds.clear();
    if(ids.includes(selectedAssetId)) selectedAssetId = '';
    render();
    setStatus(`已移动 ${data.moved || 0} 个素材`);
}
