const root = document.getElementById('assetManagerRoot');
const statusEl = document.getElementById('assetStatus');
const refreshBtn = document.getElementById('refreshBtn');
const uploadInput = document.getElementById('assetUploadInput');

const ASSET_MANAGER_TABS = new Set(['assets', 'prompts', 'canvas-assets', 'local', 'storage']);
let requestedInitialTab = '';
try {
    requestedInitialTab = new URLSearchParams(location.search).get('tab') || (location.pathname.endsWith('/storage-manager.html') ? 'storage' : '') || localStorage.getItem('asset_manager_requested_tab') || '';
    localStorage.removeItem('asset_manager_requested_tab');
} catch (_) {}
let activeTab = ASSET_MANAGER_TABS.has(requestedInitialTab) ? requestedInitialTab : 'assets';
let assetLibrary = {libraries:[], categories:[]};
let promptLibrary = {libraries:[]};
let aiConnections = [];
let avatarRegisterProvider = '';
let avatarBusyId = '';
let activeAssetLibraryId = '';
let activeAssetCategoryId = '';
let activePromptLibraryId = '';
let activePromptCategory = 'all';
let assetTreeFocus = 'category';
let promptTreeFocus = 'category';
let selectedAssetId = '';
let selectedPromptId = '';
let selectedAssetIds = new Set();
let selectedPromptIds = new Set();
let assetQuery = '';
let promptQuery = '';
let assetManageMode = false;
let promptManageMode = false;
let assetMoveTarget = '';
let assetClipboard = null;
let assetEditMode = false;
let promptEditMode = false;
let promptCreateMode = false;
let pendingDeleteAssetId = '';
let pendingDeletePromptId = '';
let pendingBatchDelete = '';
let assetTreeEdit = null;
let promptTreeEdit = null;
let pendingTreeDelete = '';
let marqueeState = null;
let sharedFolders = [];
let activeSharedFolderId = '';
let activeSharedFolderName = '';
let localFolders = [];
let localFolderMap = new Map();
let localItemMap = new Map();
let activeLocalFolderId = '';
let selectedLocalId = '';
let selectedLocalIds = new Set();
let localQuery = '';
let localManageMode = false;
let localClipboard = null;
let localAssets = [];
let localAssetsLoaded = false;
let selectedLocalUploadId = '';
let selectedLocalUploadIds = new Set();
let localUploadQuery = '';
let localUploadManageMode = false;
let lightboxPanState = null;
let storageUsage = {usage_by_category:[]};
let storageFiles = {entries:[], offset:0, limit:50, has_more:false, total_matches:0, total_pages:0, current_page:1};
let storageCategoryFilter = '';
let storageQuery = '';
let storageSortOrder = 'desc';
let storageCreatedBefore = null;
let storageUnreferencedOnly = false;
let storageFiltersOpen = false;
let storageSelectedIds = new Set();
let storageManageMode = false;
let meInfo = {is_admin:false, user_id:''};
let storageSearchTimer = 0;

const LOCAL_MEDIA_EXTS = /\.(png|jpe?g|webp|gif|bmp|avif|svg|mp4|webm|mov|m4v|mp3|wav|flac|ogg|m4a|aac)(\?|#|$)/i;

function refreshIcons(){ if(window.lucide) lucide.createIcons(); }
function setStatus(text='准备就绪'){ if(statusEl) statusEl.textContent = text || '准备就绪'; }
function escapeHtml(value=''){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function escapeAttr(value=''){ return escapeHtml(value); }
async function copyTextToClipboard(text){
    const value = String(text || '');
    if(!value) return false;
    try {
        if(navigator.clipboard?.writeText){ await navigator.clipboard.writeText(value); return true; }
    } catch(_) {}
    try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch(_) { return false; }
}
async function apiJson(url, options={}){
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.detail || data.message || '操作失败');
    return data;
}
// [asset-manager 迁移] formatDate/formatFileSize/storageDateInputValue/applyStorageFilters/
// storageUsagePercent/storageEntries/storageCategories/currentStorageEntries/findStorageEntry/
// selectedStorageEntry/storagePageInfo/storageThumbUrl/storageCardThumb 已拆分到
// frontend/src/asset-manager/storage-manager.js。
// [asset-manager 迁移] assetLibraries/activeAssetLibrary/assetCategories/activeAssetCategory/
// assetCountForLibrary 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] promptLibraries/isSystemPromptLibrary/activePromptLibrary/
// activePromptCategories/promptCategoryLabel/promptCountForCategory 已拆分到
// frontend/src/asset-manager/prompt-library.js。
function assetKind(item){
    const url = String(item?.url || '').toLowerCase();
    const kind = String(item?.kind || item?.type || '').toLowerCase();
    if(kind.includes('video') || /\.(mp4|webm|mov|m4v)(\?|#|$)/.test(url)) return 'video';
    if(kind.includes('audio') || /\.(mp3|wav|flac|ogg|m4a)(\?|#|$)/.test(url)) return 'audio';
    return 'image';
}
function assetKindLabel(item){
    const kind = assetKind(item);
    if(kind === 'video') return '视频';
    if(kind === 'audio') return '音频';
    return '图片';
}
function assetThumb(item){
    const kind = assetKind(item);
    if(kind === 'video') return `<video src="${escapeAttr(item.url)}" muted preload="metadata" playsinline></video>`;
    if(kind === 'audio') return `<div class="asset-file-icon"><i data-lucide="file-audio"></i><span>音频</span></div>`;
    return `<img src="${escapeAttr(item.url)}" alt="${escapeAttr(item.name || 'asset')}" loading="lazy">`;
}
// [asset-manager 迁移] isLocalMediaFile/localItemKind/localObjectUrl/localAssetThumb/
// activeLocalFolder/localItemsForFolder/findLocalItem/normalizeLocalState/localFolderTotal/
// localFolderId/localChildPath/loadSharedFolders/loadLocalAssets/registerSharedFolder/
// unregisterSharedFolder/indexSharedTree/openSharedFolder 已拆分到
// frontend/src/asset-manager/local-assets.js。
// [asset-manager 迁移] currentAssetItems/assetMoveTargets/normalizeAssetMoveTarget 已拆分到
// frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] currentPromptItems 已拆分到 frontend/src/asset-manager/prompt-library.js。
// 认证支持的平台键（与后端 AVATAR_SUPPORTED_PLATFORMS 保持一致；新增平台时同步）
// [asset-manager 迁移] AVATAR_SUPPORTED_PLATFORMS/AVATAR_PLATFORM_LABELS/providerAvatarPlatform/
// providerAvatarSupported/avatarPlatformLabel/avatarCandidateProviders/activeAvatarProvider/
// avatarProviderOptionLabel/avatarProviderIdForPlatform 已拆分到
// frontend/src/asset-manager/avatar-registration.js。
// [asset-manager 迁移] findAssetItem 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] findPromptItem 已拆分到 frontend/src/asset-manager/prompt-library.js。
// [asset-manager 迁移] selectedAsset 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] selectedPrompt 已拆分到 frontend/src/asset-manager/prompt-library.js。
// [asset-manager 迁移] normalizeAssetState 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] normalizePromptState 已拆分到 frontend/src/asset-manager/prompt-library.js。
async function loadAll(){
    setStatus('加载中...');
    const [assetData, promptData, configurationData, _sharedFolders, _localAssets, meData, usageData] = await Promise.all([
        apiJson('/api/asset-library'),
        apiJson('/api/prompt-libraries'),
        // Asset users need model choices but must not require API-settings access.
        apiJson('/api/ai/resources').catch(() => ({connections:[],models:[]})),
        loadSharedFolders(),
        loadLocalAssets(),
        apiJson('/api/access-control/me').catch(() => ({user_id:'', pages:[]})),
        apiJson('/api/storage/usage').catch(() => ({usage_by_category:[]}))
    ]);
    assetLibrary = assetData.library || {libraries:[], categories:[]};
    promptLibrary = promptData.library || {libraries:[]};
    const connections = Array.isArray(configurationData.connections) ? configurationData.connections : [];
    const models = Array.isArray(configurationData.models) ? configurationData.models : [];
    aiConnections = connections.map(connection => ({...connection, id: connection.id, image_models: models.filter(model => model.connection_id === connection.id && model.kind === 'image').map(model => model.upstream_model), chat_models: models.filter(model => model.connection_id === connection.id && model.kind === 'chat').map(model => model.upstream_model), video_models: models.filter(model => model.connection_id === connection.id && model.kind === 'video').map(model => model.upstream_model)}));
    meInfo = meData || {user_id:'', pages:[]};
    storageUsage = usageData || {usage_by_category:[]};
    storageFiles = {entries:[], offset:0, limit:50, has_more:false, total_matches:0, total_pages:0, current_page:1};
    if(activeTab === 'storage'){
        await loadStorageFiles({reset:true}).catch(() => null);
    }
    // 刷新时默认回到「默认资产库」
    const libs = assetLibraries();
    activeAssetLibraryId = (libs.find(lib => lib.id === 'default') || libs[0])?.id || '';
    activeAssetCategoryId = '';
    selectedAssetId = '';
    selectedAssetIds.clear();
    selectedPromptIds.clear();
    render();
    setStatus('准备就绪');
}
// [asset-manager 迁移] loadStorageUsage/loadStorageFiles/deleteStorageEntries/
// deleteAllMatchingStorageEntries 已拆分到 frontend/src/asset-manager/storage-manager.js。
async function switchTab(tab='assets'){
    activeTab = tab || 'assets';
    selectedAssetIds.clear();
    selectedPromptIds.clear();
    selectedLocalIds.clear();
    selectedLocalUploadIds.clear();
    if(activeTab === 'storage'){
        await Promise.all([
            loadStorageUsage().catch(() => null),
            loadStorageFiles({reset:true}).catch(() => null),
        ]);
    }
    render();
}
function render(){
    document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
    if(activeTab === 'prompts') renderPromptManager();
    else if(activeTab === 'local') renderLocalManager();
    else if(activeTab === 'storage') renderStorageManager();
    else if(activeTab === 'canvas-assets') renderCanvasAssetsManager();
    else renderAssetManager();
    refreshIcons();
}
// [asset-manager 迁移] renderStorageManager/renderStorageDetail 已拆分到
// frontend/src/asset-manager/storage-manager.js。
function renderCanvasAssetsManager(){
    root.innerHTML = `
        <aside class="asset-panel asset-nav">
            <div class="panel-head"><div class="panel-title"><strong>画布资产</strong><span>画布内保存的素材集合</span></div></div>
            <div class="nav-scroll"><div class="nav-empty">画布资产功能待完善</div></div>
        </aside>
        <section class="asset-panel asset-content">
            <div class="content-toolbar">
                <div class="content-heading"><strong>画布资产</strong><span>后续会按画布、节点和输出记录整理</span></div>
            </div>
            <div class="content-scroll"><div class="empty-state">这里先预留给画布资产。当前请继续使用「图片资产」和「本地素材」。</div></div>
        </section>
        <aside class="asset-panel asset-detail">
            <div class="panel-head"><div class="panel-title"><strong>资产预览</strong><span>选择画布资产查看详情</span></div></div>
            <div class="detail-scroll"><div class="detail-empty"><i data-lucide="layout-dashboard"></i><span>暂无可预览资产</span></div></div>
        </aside>
    `;
}
// [asset-manager 迁移] localUploadItems/findLocalUpload/renderLocalManager/
// renderLocalUploadAddCard/renderLocalUploadCard/renderLocalUploadDetail/
// renderLocalFolderBranch/folderContainsLocalActive/renderLocalCard/renderLocalClipboardBar/
// renderLocalDetail 已拆分到 frontend/src/asset-manager/local-assets.js。
// [asset-manager 迁移] renderAssetManager/renderUploadCard/renderAssetClipboardBar/
// renderAssetTreeBranch/renderAssetTreeActionBar/renderAssetTreeInlineEdit/renderAssetCard
// 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] renderAvatarRegistrationCard/renderAvatarSection 已拆分到
// frontend/src/asset-manager/avatar-registration.js。
// [asset-manager 迁移] renderAssetDetail 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] renderPromptManager/renderPromptTreeBranch/renderPromptTreeActionBar/
// renderPromptTreeInlineEdit/renderPromptRow/renderPromptDetail 已拆分到
// frontend/src/asset-manager/prompt-library.js。
// [asset-manager 迁移] uploadFiles 已拆分到 frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] uploadLocalAssets/deleteLocalAssets 已拆分到
// frontend/src/asset-manager/local-assets.js。
async function handleClick(event){
    const target = event.target;
    const tabBtn = target.closest?.('[data-tab]');
    if(tabBtn){
        await switchTab(tabBtn.dataset.tab || 'assets');
        return;
    }
    if(target.closest?.('#refreshBtn')){ await loadAll(); return; }
    const assetPreview = target.closest?.('[data-asset-preview]');
    if(assetPreview){ showDetailPreview('asset', assetPreview.dataset.assetPreview || ''); return; }
    const localPreview = target.closest?.('[data-local-preview]');
    if(localPreview){ showDetailPreview('local', localPreview.dataset.localPreview || ''); return; }
    const localUpPreview = target.closest?.('[data-localup-preview]');
    if(localUpPreview){ showDetailPreview('localup', localUpPreview.dataset.localupPreview || ''); return; }
    const storagePreview = target.closest?.('[data-storage-preview]');
    if(storagePreview){ showDetailPreview('storage', storagePreview.dataset.storagePreview || ''); return; }
    if(target.closest?.('[data-localup-upload]')){ uploadInput?.click(); return; }
    if(target.closest?.('[data-storage-refresh]')){ await Promise.all([loadStorageUsage(), loadStorageFiles({reset:true, page:1})]); render(); return; }
    const storageSort = target.closest?.('[data-storage-sort]');
    if(storageSort){
        const nextOrder = storageSort.dataset.storageSort === 'asc' ? 'asc' : 'desc';
        if(nextOrder === storageSortOrder) return;
        storageSortOrder = nextOrder;
        storageSelectedIds.clear();
        await loadStorageFiles({reset:true, page:1});
        render();
        return;
    }
    if(target.closest?.('[data-storage-filter-toggle]')){
        storageFiltersOpen = !storageFiltersOpen;
        render();
        return;
    }
    const storageDateTrigger = target.closest?.('[data-storage-date-trigger]');
    if(storageDateTrigger){
        const input = storageDateTrigger.querySelector('#storageBeforeDate');
        try { input?.showPicker?.(); } catch(_) { input?.focus(); }
        return;
    }
    if(target.closest?.('[data-storage-delete-matching]')){
        await deleteAllMatchingStorageEntries();
        return;
    }
    if(target.closest?.('[data-storage-manage]')){
        storageManageMode = !storageManageMode;
        if(!storageManageMode) storageSelectedIds.clear();
        render();
        return;
    }
    if(target.closest?.('[data-storage-select-all]')){ currentStorageEntries().forEach(item => storageSelectedIds.add(item.file_id)); render(); return; }
    if(target.closest?.('[data-storage-clear]')){ storageSelectedIds.clear(); render(); return; }
    if(target.closest?.('[data-storage-delete-selected]')){ await deleteStorageEntries([...storageSelectedIds]); return; }
    const storageDeleteOne = target.closest?.('[data-storage-delete-one]');
    if(storageDeleteOne){ await deleteStorageEntries([storageDeleteOne.dataset.storageDeleteOne || '']); return; }
    const storageCheck = target.closest?.('[data-storage-check]');
    if(storageCheck){
        const id = storageCheck.dataset.storageCheck || '';
        if(storageSelectedIds.has(id)) storageSelectedIds.delete(id); else storageSelectedIds.add(id);
        render();
        return;
    }
    const storageOpen = target.closest?.('[data-storage-open]');
    if(storageOpen){ const it = findStorageEntry(storageOpen.dataset.storageOpen || ''); if(it?.url) window.open(it.url, '_blank'); return; }
    const storageCopy = target.closest?.('[data-storage-copy]');
    if(storageCopy){ const it = findStorageEntry(storageCopy.dataset.storageCopy || ''); const ok = await copyTextToClipboard(it?.url || ''); setStatus(ok ? '已复制链接' : '复制失败'); return; }
    if(target.closest?.('[data-storage-page-prev]')){
        const {currentPage} = storagePageInfo();
        await loadStorageFiles({page: Math.max(1, currentPage - 1)});
        render();
        return;
    }
    if(target.closest?.('[data-storage-page-next]')){
        const {currentPage, totalPages} = storagePageInfo();
        await loadStorageFiles({page: Math.min(totalPages, currentPage + 1)});
        render();
        return;
    }
    const storageCard = target.closest?.('[data-storage-card]');
    if(storageCard){
        const id = storageCard.dataset.storageCard || '';
        if(storageManageMode){
            if(storageSelectedIds.has(id)) storageSelectedIds.delete(id); else storageSelectedIds.add(id);
        } else {
            storageSelectedIds = new Set(id ? [id] : []);
        }
        render();
        return;
    }
    const storageCategory = target.closest?.('[data-storage-category]');
    if(storageCategory){
        storageCategoryFilter = storageCategory.dataset.storageCategory || '';
        storageSelectedIds.clear();
        await loadStorageFiles({reset:true, page:1});
        render();
        return;
    }
    if(target.closest?.('[data-localup-manage]')){
        localUploadManageMode = !localUploadManageMode;
        if(!localUploadManageMode) selectedLocalUploadIds.clear();
        render();
        return;
    }
    if(target.closest?.('[data-localup-select-all]')){ localUploadItems().forEach(item => selectedLocalUploadIds.add(item.id)); render(); return; }
    if(target.closest?.('[data-localup-clear]')){ selectedLocalUploadIds.clear(); render(); return; }
    if(target.closest?.('[data-localup-delete-selected]')){ await deleteLocalAssets([...selectedLocalUploadIds]); return; }
    const localUpDeleteOne = target.closest?.('[data-localup-delete-one]');
    if(localUpDeleteOne){ await deleteLocalAssets([localUpDeleteOne.dataset.localupDeleteOne || '']); return; }
    const localUpCheck = target.closest?.('[data-localup-check]');
    if(localUpCheck){
        const id = localUpCheck.dataset.localupCheck || '';
        if(selectedLocalUploadIds.has(id)) selectedLocalUploadIds.delete(id); else selectedLocalUploadIds.add(id);
        render();
        return;
    }
    const localUpOpen = target.closest?.('[data-localup-open]');
    if(localUpOpen){ const it = findLocalUpload(localUpOpen.dataset.localupOpen || ''); if(it?.url) window.open(it.url, '_blank'); return; }
    const localUpCopy = target.closest?.('[data-localup-copy]');
    if(localUpCopy){ const it = findLocalUpload(localUpCopy.dataset.localupCopy || ''); const ok = await copyTextToClipboard(it?.url || ''); setStatus(ok ? '已复制链接' : '复制失败'); return; }
    const localUpCard = target.closest?.('[data-localup-card]');
    if(localUpCard){
        if(localUploadManageMode){
            const id = localUpCard.dataset.localupCard || '';
            if(selectedLocalUploadIds.has(id)) selectedLocalUploadIds.delete(id); else selectedLocalUploadIds.add(id);
        } else {
            selectedLocalUploadId = localUpCard.dataset.localupCard || '';
        }
        render();
        return;
    }
    if(target.closest?.('[data-local-pick-folder]')){ await registerSharedFolder(); return; }
    const sharedRemove = target.closest?.('[data-shared-remove]');
    if(sharedRemove){ event.stopPropagation(); await unregisterSharedFolder(sharedRemove.dataset.sharedRemove || ''); return; }
    const sharedOpen = target.closest?.('[data-shared-open]');
    if(sharedOpen){ await openSharedFolder(sharedOpen.dataset.sharedOpen || ''); return; }
    if(target.closest?.('[data-local-manage]')){
        localManageMode = !localManageMode;
        pendingBatchDelete = '';
        if(!localManageMode) selectedLocalIds.clear();
        render();
        return;
    }
    if(target.closest?.('[data-local-select-all]')){ localItemsForFolder().forEach(item => selectedLocalIds.add(item.id)); pendingBatchDelete = ''; render(); return; }
    if(target.closest?.('[data-local-clear-selection]')){ selectedLocalIds.clear(); pendingBatchDelete = ''; render(); return; }
    if(target.closest?.('[data-local-copy-selected]')){ setLocalClipboard('copy'); return; }
    if(target.closest?.('[data-local-import-clipboard]')){ await pasteLocalClipboardToAssets(); return; }
    if(target.closest?.('[data-local-clear-clipboard]')){ localClipboard = null; render(); return; }
    const localImportOne = target.closest?.('[data-local-import-one]');
    if(localImportOne){ setLocalClipboard('copy', [localImportOne.dataset.localImportOne || '']); await pasteLocalClipboardToAssets(); return; }
    const localOpen = target.closest?.('[data-local-open]');
    if(localOpen){ openLocalItem(localOpen.dataset.localOpen || ''); return; }
    const localFolder = target.closest?.('[data-local-folder]');
    if(localFolder){ activeLocalFolderId = localFolder.dataset.localFolder || ''; selectedLocalId = ''; selectedLocalIds.clear(); pendingBatchDelete = ''; render(); return; }
    const localCard = target.closest?.('[data-local-card]');
    if(localCard){ selectedLocalId = localCard.dataset.localCard || ''; render(); return; }
    if(target.closest?.('[data-asset-tree-edit-save]')){ await saveAssetTreeEdit(); return; }
    if(target.closest?.('[data-asset-tree-edit-cancel]')){ assetTreeEdit = null; render(); return; }
    if(target.closest?.('[data-prompt-tree-edit-save]')){ await savePromptTreeEdit(); return; }
    if(target.closest?.('[data-prompt-tree-edit-cancel]')){ promptTreeEdit = null; render(); return; }
    const assetEditSave = target.closest?.('[data-asset-edit-save]');
    if(assetEditSave){ await saveAssetEdit(assetEditSave.dataset.assetEditSave || ''); return; }
    if(target.closest?.('[data-asset-edit-cancel]')){ assetEditMode = false; render(); return; }
    const assetEditStart = target.closest?.('[data-asset-edit-start]');
    if(assetEditStart){ selectedAssetId = assetEditStart.dataset.assetEditStart || selectedAssetId; assetEditMode = true; pendingDeleteAssetId = ''; render(); return; }
    if(target.closest?.('[data-asset-manage]')){
        assetManageMode = !assetManageMode;
        pendingBatchDelete = '';
        if(!assetManageMode) selectedAssetIds.clear();
        render();
        return;
    }
    if(target.closest?.('[data-asset-select-all]')){ currentAssetItems().forEach(item => selectedAssetIds.add(item.id)); pendingBatchDelete = ''; render(); return; }
    if(target.closest?.('[data-asset-clear-selection]')){ selectedAssetIds.clear(); pendingBatchDelete = ''; render(); return; }
    if(target.closest?.('[data-asset-cut-selected]')){ setAssetClipboard('cut'); return; }
    if(target.closest?.('[data-asset-copy-selected]')){ setAssetClipboard('copy'); return; }
    if(target.closest?.('[data-asset-paste-clipboard]')){ await pasteAssetClipboard(); return; }
    if(target.closest?.('[data-asset-clear-clipboard]')){ assetClipboard = null; render(); return; }
    const assetRename = target.closest?.('[data-asset-rename]');
    if(assetRename){ await renameAssetItem(assetRename.dataset.assetRename || ''); return; }
    const assetDelete = target.closest?.('[data-asset-delete]');
    if(assetDelete){ await deleteAssetItem(assetDelete.dataset.assetDelete || ''); return; }
    const assetOpen = target.closest?.('[data-asset-open]');
    if(assetOpen){ openAssetItem(assetOpen.dataset.assetOpen || ''); return; }
    const avatarCopy = target.closest?.('[data-avatar-copy]');
    if(avatarCopy){
        const uri = avatarCopy.dataset.avatarCopy || '';
        const ok = await copyTextToClipboard(uri);
        setStatus(ok ? '已复制 asset:// 地址' : `复制失败，请手动复制：${uri}`);
        return;
    }
    const avatarRegister = target.closest?.('[data-avatar-register]');
    if(avatarRegister){ await registerAssetAvatar(avatarRegister.dataset.avatarRegister || '', avatarRegister.dataset.avatarProv || ''); return; }
    const avatarCheck = target.closest?.('[data-avatar-check]');
    if(avatarCheck){ await checkAssetAvatarStatus(avatarCheck.dataset.avatarCheck || '', false, avatarCheck.dataset.avatarProv || ''); return; }
    if(target.closest?.('[data-asset-delete-selected]')){ await deleteSelectedAssets(); return; }
    if(target.closest?.('[data-asset-upload]')){ uploadInput?.click(); return; }
    if(target.closest?.('[data-asset-lib-new]')){ assetTreeFocus = 'library'; assetTreeEdit = {kind:'library-new', value:'新资产库', label:'资产库名称'}; render(); return; }
    if(target.closest?.('[data-asset-lib-rename]')){
        const row = target.closest('[data-asset-lib]');
        if(row) activeAssetLibraryId = row.dataset.assetLib || activeAssetLibraryId;
        assetTreeFocus = 'library';
        assetTreeEdit = {kind:'library-rename', value:activeAssetLibrary()?.name || '', label:'资产库名称'};
        pendingTreeDelete = '';
        render(); return;
    }
    if(target.closest?.('[data-asset-lib-delete]')){
        const row = target.closest('[data-asset-lib]');
        if(row) activeAssetLibraryId = row.dataset.assetLib || activeAssetLibraryId;
        await deleteAssetLibrary(); return;
    }
    if(target.closest?.('[data-asset-cat-new]')){
        const row = target.closest('[data-asset-lib]');
        const catRow = target.closest('[data-asset-cat]');
        if(row) activeAssetLibraryId = row.dataset.assetLib || activeAssetLibraryId;
        if(catRow) activeAssetLibraryId = catRow.dataset.assetCatLib || activeAssetLibraryId;
        assetTreeEdit = {kind:'category-new', value:'新分组', label:'分组名称'};
        pendingTreeDelete = '';
        render(); return;
    }
    if(target.closest?.('[data-asset-cat-rename]')){
        const row = target.closest('[data-asset-cat]');
        if(row){ activeAssetLibraryId = row.dataset.assetCatLib || activeAssetLibraryId; activeAssetCategoryId = row.dataset.assetCat || activeAssetCategoryId; }
        assetTreeFocus = 'category';
        assetTreeEdit = {kind:'category-rename', value:activeAssetCategory()?.name || '', label:'分组名称'};
        pendingTreeDelete = '';
        render(); return;
    }
    if(target.closest?.('[data-asset-cat-delete]')){
        const row = target.closest('[data-asset-cat]');
        if(row){ activeAssetLibraryId = row.dataset.assetCatLib || activeAssetLibraryId; activeAssetCategoryId = row.dataset.assetCat || activeAssetCategoryId; }
        await deleteAssetCategory(); return;
    }
    const assetLib = target.closest?.('[data-asset-lib]');
    if(assetLib){ activeAssetLibraryId = assetLib.dataset.assetLib || ''; assetTreeFocus = 'library'; activeAssetCategoryId = assetCategories()[0]?.id || ''; selectedAssetId = ''; selectedAssetIds.clear(); render(); return; }
    const assetCat = target.closest?.('[data-asset-cat]');
    if(assetCat){ activeAssetLibraryId = assetCat.dataset.assetCatLib || activeAssetLibraryId; activeAssetCategoryId = assetCat.dataset.assetCat || ''; assetTreeFocus = 'category'; selectedAssetId = ''; selectedAssetIds.clear(); render(); return; }
    const assetCard = target.closest?.('[data-asset-card]');
    if(assetCard){ selectedAssetId = assetCard.dataset.assetCard || ''; assetEditMode = false; pendingDeleteAssetId = ''; render(); return; }

    const promptEditSave = target.closest?.('[data-prompt-edit-save]');
    if(promptEditSave){ await savePromptEdit(promptEditSave.dataset.promptEditSave || ''); return; }
    if(target.closest?.('[data-prompt-create-save]')){ await savePromptCreate(); return; }
    if(target.closest?.('[data-prompt-edit-cancel]')){ promptEditMode = false; promptCreateMode = false; render(); return; }
    const promptEditStart = target.closest?.('[data-prompt-edit-start]');
    if(promptEditStart){ selectedPromptId = promptEditStart.dataset.promptEditStart || selectedPromptId; promptEditMode = true; promptCreateMode = false; pendingDeletePromptId = ''; render(); return; }
    if(target.closest?.('[data-prompt-manage]')){
        promptManageMode = !promptManageMode;
        pendingBatchDelete = '';
        if(!promptManageMode) selectedPromptIds.clear();
        render();
        return;
    }
    if(target.closest?.('[data-prompt-select-all]')){ currentPromptItems().forEach(item => selectedPromptIds.add(item.id)); pendingBatchDelete = ''; render(); return; }
    if(target.closest?.('[data-prompt-clear-selection]')){ selectedPromptIds.clear(); pendingBatchDelete = ''; render(); return; }
    const promptEdit = target.closest?.('[data-prompt-edit]');
    if(promptEdit){ await editPromptItem(promptEdit.dataset.promptEdit || ''); return; }
    const promptDelete = target.closest?.('[data-prompt-delete]');
    if(promptDelete){ await deletePromptItem(promptDelete.dataset.promptDelete || ''); return; }
    if(target.closest?.('[data-prompt-delete-selected]')){ await deleteSelectedPrompts(); return; }
    const promptNewBtn = target.closest?.('[data-prompt-new]');
    if(promptNewBtn){
        const libId = promptNewBtn.dataset.libId || target.closest('[data-prompt-lib]')?.dataset.promptLib;
        const catRow = target.closest('[data-prompt-cat]');
        if(libId){ activePromptLibraryId = libId; activePromptCategory = 'all'; }
        if(catRow){ activePromptLibraryId = catRow.dataset.promptCatLib || activePromptLibraryId; activePromptCategory = catRow.dataset.promptCat || activePromptCategory; }
        promptCreateMode = true; promptEditMode = false; pendingDeletePromptId = ''; render(); return;
    }
    if(target.closest?.('[data-prompt-lib-new]')){ promptTreeFocus = 'library'; promptTreeEdit = {kind:'library-new', value:'新提示词库', label:'提示词库名称'}; render(); return; }
    if(target.closest?.('[data-prompt-cat-new]')){
        const libRow = target.closest('[data-prompt-lib]');
        if(libRow) activePromptLibraryId = libRow.dataset.promptLib || activePromptLibraryId;
        promptTreeFocus = 'library';
        promptTreeEdit = {kind:'category-new', value:'新分组', label:'分组名称'};
        pendingTreeDelete = '';
        render(); return;
    }
    if(target.closest?.('[data-prompt-cat-rename]')){
        promptTreeFocus = 'category';
        const cat = activePromptCategories().find(c => c.id === activePromptCategory);
        promptTreeEdit = {kind:'category-rename', value:cat?.name || '', label:'分组名称'};
        pendingTreeDelete = '';
        render(); return;
    }
    if(target.closest?.('[data-prompt-cat-delete]')){ await deletePromptCategory(); return; }
    const promptLibRenameBtn = target.closest?.('[data-prompt-lib-rename]');
    if(promptLibRenameBtn){
        const libRow = target.closest('[data-prompt-lib]');
        if(promptLibRenameBtn.dataset.libId) activePromptLibraryId = promptLibRenameBtn.dataset.libId;
        if(libRow) activePromptLibraryId = libRow.dataset.promptLib || activePromptLibraryId;
        promptTreeFocus = 'library';
        promptTreeEdit = {kind:'library-rename', value:activePromptLibrary()?.name || '', label:'提示词库名称'};
        render(); return;
    }
    const promptLibDeleteBtn = target.closest?.('[data-prompt-lib-delete]');
    if(promptLibDeleteBtn){
        if(promptLibDeleteBtn.dataset.libId) activePromptLibraryId = promptLibDeleteBtn.dataset.libId;
        await deletePromptLibrary(); return;
    }
    const promptLib = target.closest?.('[data-prompt-lib]');
    if(promptLib){ activePromptLibraryId = promptLib.dataset.promptLib || ''; activePromptCategory = 'all'; promptTreeFocus = 'library'; selectedPromptId = ''; promptCreateMode = false; promptEditMode = false; selectedPromptIds.clear(); render(); return; }
    const promptCat = target.closest?.('[data-prompt-cat]');
    if(promptCat){ activePromptLibraryId = promptCat.dataset.promptCatLib || activePromptLibraryId; activePromptCategory = promptCat.dataset.promptCat || 'all'; promptTreeFocus = 'category'; selectedPromptId = ''; promptCreateMode = false; promptEditMode = false; selectedPromptIds.clear(); render(); return; }
    const promptRow = target.closest?.('[data-prompt-row]');
    if(promptRow){ selectedPromptId = promptRow.dataset.promptRow || ''; promptEditMode = false; promptCreateMode = false; pendingDeletePromptId = ''; render(); return; }
}
// [asset-manager 迁移] openAssetItem/showDetailPreview/closeDetailPreview/
// applyLightboxTransform/zoomDetailPreview/beginLightboxPan/updateLightboxPan/endLightboxPan/
// rectsIntersect/marqueeTargetSelector/beginMarqueeSelection/updateMarqueeSelection/
// endMarqueeSelection 已拆分到 frontend/src/asset-manager/detail-lightbox.js。
// [asset-manager 迁移] createAssetLibrary/saveAssetTreeEdit/renameAssetLibrary/
// deleteAssetLibrary/createAssetCategory/renameAssetCategory/deleteAssetCategory/
// renameAssetItem/saveAssetEdit/saveAssetInlineName 已拆分到
// frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] registerAssetAvatar/avatarRegistrationOf/checkAssetAvatarStatus/
// scheduleAvatarPoll 已拆分到 frontend/src/asset-manager/avatar-registration.js。
// [asset-manager 迁移] deleteAssetItem/deleteSelectedAssets 已拆分到
// frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] setAssetClipboard/pasteAssetClipboard/setLocalClipboard/
// pasteLocalClipboardToAssets/moveSelectedAssets 已拆分到
// frontend/src/asset-manager/asset-library.js。
// [asset-manager 迁移] openLocalItem 已拆分到 frontend/src/asset-manager/local-assets.js。
// [asset-manager 迁移] createPromptLibrary/savePromptTreeEdit/deletePromptCategory/
// renamePromptLibrary/deletePromptLibrary/createPromptItem/savePromptCreate/editPromptItem/
// savePromptEdit/deletePromptItem/deleteSelectedPrompts 已拆分到
// frontend/src/asset-manager/prompt-library.js。
root.addEventListener('click', event => {
    handleClick(event).catch(err => setStatus(err.message || '操作失败'));
});
document.addEventListener('click', event => {
    if(event.target.closest?.('.asset-lightbox') && !event.target.closest?.('.asset-lightbox-image')) closeDetailPreview();
    if(storageFiltersOpen && !event.target.closest?.('.storage-filter-menu')){
        storageFiltersOpen = false;
        render();
    }
});
document.addEventListener('keydown', event => {
    if(event.key === 'Escape'){
        closeDetailPreview();
        if(storageFiltersOpen){ storageFiltersOpen = false; render(); }
    }
});
document.addEventListener('wheel', zoomDetailPreview, {passive:false});
document.addEventListener('pointerdown', beginLightboxPan);
document.addEventListener('pointermove', updateLightboxPan);
document.addEventListener('pointerup', endLightboxPan);
document.addEventListener('pointercancel', endLightboxPan);
root.addEventListener('pointerdown', beginMarqueeSelection);
document.addEventListener('pointermove', event => updateMarqueeSelection(event));
document.addEventListener('pointerup', endMarqueeSelection);
root.addEventListener('input', event => {
    if(event.target?.id === 'assetSearch'){
        const pos = event.target.selectionStart || 0;
        assetQuery = event.target.value || '';
        selectedAssetId = '';
        render();
        requestAnimationFrame(() => {
            const input = document.getElementById('assetSearch');
            input?.focus();
            input?.setSelectionRange?.(pos, pos);
        });
    }
    if(event.target?.id === 'promptSearch'){
        const pos = event.target.selectionStart || 0;
        promptQuery = event.target.value || '';
        selectedPromptId = '';
        render();
        requestAnimationFrame(() => {
            const input = document.getElementById('promptSearch');
            input?.focus();
            input?.setSelectionRange?.(pos, pos);
        });
    }
    if(event.target?.id === 'localSearch'){
        const pos = event.target.selectionStart || 0;
        localQuery = event.target.value || '';
        selectedLocalId = '';
        render();
        requestAnimationFrame(() => {
            const input = document.getElementById('localSearch');
            input?.focus();
            input?.setSelectionRange?.(pos, pos);
        });
    }
    if(event.target?.id === 'localUploadSearch'){
        const pos = event.target.selectionStart || 0;
        localUploadQuery = event.target.value || '';
        selectedLocalUploadId = '';
        render();
        requestAnimationFrame(() => {
            const input = document.getElementById('localUploadSearch');
            input?.focus();
            input?.setSelectionRange?.(pos, pos);
        });
    }
    if(event.target?.id === 'storageSearch'){
        const pos = event.target.selectionStart || 0;
        storageQuery = event.target.value || '';
        if(storageSearchTimer) clearTimeout(storageSearchTimer);
        storageSearchTimer = window.setTimeout(async () => {
            await loadStorageFiles({reset:true, page:1}).catch(err => setStatus(err.message || '加载失败'));
            render();
        }, 250);
        render();
        requestAnimationFrame(() => {
            const input = document.getElementById('storageSearch');
            input?.focus();
            input?.setSelectionRange?.(pos, pos);
        });
    }
});
root.addEventListener('change', event => {
    if(event.target?.id === 'storageBeforeDate'){
        const value = event.target.value || '';
        storageCreatedBefore = value ? new Date(`${value}T00:00:00`).getTime() : null;
        applyStorageFilters().catch(err => setStatus(err.message || '加载失败'));
        return;
    }
    if(event.target?.id === 'storageUnreferencedOnly'){
        storageUnreferencedOnly = !!event.target.checked;
        applyStorageFilters().catch(err => setStatus(err.message || '加载失败'));
        return;
    }
    const inlineAssetName = event.target.closest?.('[data-asset-inline-name]');
    if(inlineAssetName){
        saveAssetInlineName(inlineAssetName.dataset.assetInlineName || '', inlineAssetName.value || '').catch(err => setStatus(err.message || '保存失败'));
        return;
    }
    const assetCheck = event.target.closest?.('[data-asset-check]');
    if(assetCheck){
        if(!assetManageMode) return;
        if(assetCheck.checked) {
            selectedAssetIds.add(assetCheck.dataset.assetCheck);
            selectedAssetId = assetCheck.dataset.assetCheck;
        } else selectedAssetIds.delete(assetCheck.dataset.assetCheck);
        render();
    }
    const promptCheck = event.target.closest?.('[data-prompt-check]');
    if(promptCheck){
        if(!promptManageMode) return;
        if(promptCheck.checked) {
            selectedPromptIds.add(promptCheck.dataset.promptCheck);
            selectedPromptId = promptCheck.dataset.promptCheck;
        } else selectedPromptIds.delete(promptCheck.dataset.promptCheck);
        render();
    }
    const localCheck = event.target.closest?.('[data-local-check]');
    if(localCheck){
        if(!localManageMode) return;
        if(localCheck.checked) {
            selectedLocalIds.add(localCheck.dataset.localCheck);
            selectedLocalId = localCheck.dataset.localCheck;
        } else selectedLocalIds.delete(localCheck.dataset.localCheck);
        render();
    }
    if(event.target?.id === 'assetMoveTarget'){
        assetMoveTarget = event.target.value || '';
        pendingBatchDelete = '';
        render();
    }
    const avatarProvider = event.target.closest?.('[data-avatar-provider]');
    if(avatarProvider){
        avatarRegisterProvider = avatarProvider.value || '';
        render();
    }
});
root.addEventListener('dragover', event => {
    const drop = event.target.closest?.('#assetDrop, #localUploadDrop');
    if(!drop) return;
    event.preventDefault();
    drop.classList.add('drag-over');
});
root.addEventListener('dragleave', event => {
    event.target.closest?.('#assetDrop, #localUploadDrop')?.classList.remove('drag-over');
});
root.addEventListener('drop', event => {
    const drop = event.target.closest?.('#assetDrop, #localUploadDrop');
    if(!drop) return;
    event.preventDefault();
    drop.classList.remove('drag-over');
    if(drop.id === 'localUploadDrop') uploadLocalAssets(event.dataTransfer.files);
    else uploadFiles(event.dataTransfer.files).catch(err => setStatus(err.message || '上传失败'));
});
uploadInput?.addEventListener('change', event => {
    const files = event.target.files;
    if(files?.length){
        if(activeTab === 'local') uploadLocalAssets(files);
        else uploadFiles(files).catch(err => setStatus(err.message || '上传失败'));
    }
    event.target.value = '';
});
document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab || 'assets').catch(err => setStatus(err.message || '加载失败'));
    });
});
refreshBtn?.addEventListener('click', () => loadAll().catch(err => setStatus(err.message || '加载失败')));
window.addEventListener('message', event => {
    if(event.origin && event.origin !== location.origin) return;
    if(event.data?.type === 'studio-theme') window.StudioTheme?.apply?.(event.data.theme);
    if(event.data?.type === 'asset-manager-open-tab' && ASSET_MANAGER_TABS.has(event.data.tab)) {
        switchTab(event.data.tab).catch(err => setStatus(err.message || '加载失败'));
    }
});
document.addEventListener('DOMContentLoaded', () => loadAll().catch(err => setStatus(err.message || '加载失败')));
