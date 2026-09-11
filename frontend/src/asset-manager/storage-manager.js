// asset-manager 页面 —— 存储用量管理子系统（拆分自 static/js/asset-manager.js）。
//
// 范围：存储用量总览（loadStorageUsage/storageUsagePercent，配额百分比）、
// 分页/排序/筛选后的文件列表拉取（loadStorageFiles，支持分类/关键字/
// 创建时间/是否已引用几种筛选）、批量删除与"删除全部匹配项"
// （deleteStorageEntries/deleteAllMatchingStorageEntries）、存储管理面板
// 和文件详情面板渲染（renderStorageManager/renderStorageDetail）。
//
// 经典 <script>，非 ES module：main.js 的 render()/switchTab() 需要直接
// 调用本模块的 renderStorageManager 等函数，经典脚本共享顶层作用域让这类
// 跨文件函数调用不需要 export/import（见 frontend/README.md 的方法论
// 说明）。asset-manager.html 本身零内联事件绑定，全部走 handleClick
// 委托，handleClick 留在 main.js。
//
// 依赖 main.js 保留的核心状态和函数：storageUsage/storageFiles/
// storageCategoryFilter/storageQuery/storageSortOrder/storageCreatedBefore/
// storageUnreferencedOnly/storageFiltersOpen/storageSelectedIds/
// storageManageMode（存储子系统的全部可变状态，读写方式跟 M1-M22 的
// state.js 模式一致——只搬函数，状态留在 main.js 由 handleClick 直接
// 读写）、meInfo（当前用户信息）、root（页面根节点）、
// escapeHtml/escapeAttr/formatDate/formatFileSize/setStatus/apiJson/
// refreshIcons（通用工具，被全部子系统共用，不重复搬移）、assetThumb
// （另一个通用缩略图渲染工具，同样留在 main.js）、render（主渲染入口）。

function formatDate(value){
    const num = Number(value || 0);
    if(!num) return '未知';
    try { return new Date(num).toLocaleString('zh-CN', {hour12:false}); }
    catch(e) { return '未知'; }
}
function formatFileSize(bytes=0){
    const size = Number(bytes || 0);
    if(!size) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
    return `${(size / Math.pow(1024, idx)).toFixed(idx ? 1 : 0)} ${units[idx]}`;
}
function storageDateInputValue(){
    if(!storageCreatedBefore) return '';
    const date = new Date(storageCreatedBefore);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
async function applyStorageFilters(){
    storageSelectedIds.clear();
    await loadStorageFiles({reset:true, page:1});
    render();
}
function storageUsagePercent(){
    const quota = Number(storageUsage?.quota_bytes || 0);
    const used = Number(storageUsage?.used_bytes || 0);
    if(!quota) return 0;
    return Math.max(0, Math.min(100, (used / quota) * 100));
}
function storageEntries(){
    return Array.isArray(storageFiles?.entries) ? storageFiles.entries : [];
}
function storageCategories(){
    return Array.isArray(storageUsage?.usage_by_category) ? storageUsage.usage_by_category : [];
}
function currentStorageEntries(){
    return storageEntries();
}
function findStorageEntry(fileId=''){
    return storageEntries().find(item => item.file_id === fileId) || null;
}
function selectedStorageEntry(){
    const ids = [...storageSelectedIds];
    return findStorageEntry(ids[0] || '') || currentStorageEntries()[0] || null;
}
function storagePageInfo(){
    const totalMatches = Number(storageFiles?.total_matches || 0);
    const limit = Math.max(1, Number(storageFiles?.limit || 50) || 50);
    const totalPages = Math.max(1, Math.ceil(totalMatches / limit) || 1);
    const currentPage = Math.min(totalPages, Math.max(1, Number(storageFiles?.current_page || Math.floor((Number(storageFiles?.offset || 0) || 0) / limit) + 1)));
    return {totalMatches, limit, totalPages, currentPage};
}
function storageThumbUrl(fileId=''){
    const id = String(fileId || '').trim();
    if(!id) return '';
    return `/api/files/${encodeURIComponent(id)}/thumb`;
}
function storageCardThumb(item){
    const fileId = String(item?.file_id || '').trim();
    const kind = String(item?.kind || '').toLowerCase();
    if(fileId && (kind === 'image' || kind === 'video')){
        return assetThumb({
            url: storageThumbUrl(fileId),
            name: item?.original_name || item?.filename || 'file',
            kind: item?.kind || 'document',
        });
    }
    return assetThumb({
        url: item?.url,
        name: item?.original_name || item?.filename || 'file',
        kind: item?.kind || 'document',
    });
}
async function loadStorageUsage(){
    storageUsage = await apiJson('/api/storage/usage');
    return storageUsage;
}
async function loadStorageFiles({reset=false, page=null}={}){
    const limit = Number(storageFiles?.limit || 50) || 50;
    const targetPage = page === null ? (reset ? 1 : Number(storageFiles?.current_page || 1) || 1) : Math.max(1, Number(page || 1) || 1);
    const offset = Math.max(0, (targetPage - 1) * limit);
    const params = new URLSearchParams();
    if(storageCategoryFilter) params.set('category', storageCategoryFilter);
    if(storageQuery.trim()) params.set('search', storageQuery.trim());
    params.set('sort_order', storageSortOrder);
    if(storageCreatedBefore) params.set('created_before', String(storageCreatedBefore));
    if(storageUnreferencedOnly) params.set('unreferenced_only', 'true');
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const data = await apiJson(`/api/storage/files?${params.toString()}`);
    const incoming = Array.isArray(data?.entries) ? data.entries : [];
    const totalMatches = Number(data?.total_matches || 0);
    const totalPages = Math.max(1, Math.ceil(totalMatches / limit) || 1);
    storageFiles = {
        entries: incoming,
        offset: Number(data?.offset || 0),
        limit: Number(data?.limit || limit),
        has_more: !!data?.has_more,
        total_matches: totalMatches,
        total_pages: totalPages,
        current_page: Math.min(totalPages, targetPage),
    };
    storageSelectedIds = new Set([...storageSelectedIds].filter(id => !!findStorageEntry(id)));
    return storageFiles;
}
async function deleteStorageEntries(fileIds){
    const ids = [...new Set((fileIds || []).map(id => String(id || '').trim()).filter(Boolean))];
    if(!ids.length) return;
    setStatus('正在删除媒体...');
    const {currentPage, totalPages, totalMatches, limit} = storagePageInfo();
    const result = await apiJson('/api/storage/delete', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({file_ids:ids})
    });
    const removed = Number(result?.removed || 0);
    const deletedIds = Array.isArray(result?.deleted) ? result.deleted.map(id => String(id || '').trim()).filter(Boolean) : [];
    const remainingMatches = Math.max(0, totalMatches - removed);
    const nextTotalPages = Math.max(1, Math.ceil(remainingMatches / Math.max(1, limit)) || 1);
    const nextPage = Math.min(Math.max(1, currentPage), Math.max(1, Math.min(totalPages, nextTotalPages)));
    await Promise.all([
        loadStorageUsage(),
        loadStorageFiles({reset:true, page: nextPage}),
    ]);
    storageSelectedIds = new Set([...storageSelectedIds].filter(id => !deletedIds.includes(id)));
    render();
    setStatus(removed > 0 ? `已删除 ${removed} 个文件` : '未删除任何文件');
}
async function deleteAllMatchingStorageEntries(){
    const {totalMatches} = storagePageInfo();
    if(!totalMatches) return;
    const scope = [
        storageCategoryFilter ? `类别“${storageCategoryFilter}”` : '',
        storageQuery.trim() ? `搜索“${storageQuery.trim()}”` : '',
        storageCreatedBefore ? `${storageDateInputValue()} 之前` : '',
        storageUnreferencedOnly ? '仅未被引用文件' : '',
    ].filter(Boolean).join('、') || '当前全部文件';
    if(!window.confirm(`确定删除符合“${scope}”的全部 ${totalMatches} 个文件？此操作不可恢复。`)) return;
    setStatus(`正在删除 ${totalMatches} 个符合条件的文件...`);
    const result = await apiJson('/api/storage/delete', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            all_matching:true,
            category:storageCategoryFilter,
            search:storageQuery.trim(),
            created_before:storageCreatedBefore,
            unreferenced_only:storageUnreferencedOnly,
        })
    });
    storageSelectedIds.clear();
    await Promise.all([loadStorageUsage(), loadStorageFiles({reset:true, page:1})]);
    render();
    setStatus(`已删除 ${Number(result?.removed || 0)} 个文件`);
}
function renderStorageManager(){
    const entries = currentStorageEntries();
    const detail = selectedStorageEntry();
    const categories = storageCategories();
    const percent = storageUsagePercent();
    const quotaBytes = Number(storageUsage?.quota_bytes || 0);
    const remainingBytes = storageUsage?.remaining_bytes;
    const {totalMatches, totalPages, currentPage} = storagePageInfo();
    const categoryUsageHtml = categories.map(entry => `<div class="detail-meta"><span>${escapeHtml(entry.category || 'unknown')}</span><strong>${escapeHtml(formatFileSize(entry.size_bytes || 0))} / ${entry.file_count}</strong></div>`).join('');
    const progressTone = percent >= 95 ? 'linear-gradient(90deg,#ef4444,#fb923c)' : percent >= 80 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#2563eb,#34d399)';
    root.innerHTML = `
        <aside class="asset-panel asset-nav">
            <div class="panel-head">
                <div class="panel-title"><strong>空间概览</strong><span>${escapeHtml(meInfo?.user_id || 'current')}</span></div>
            </div>
            <div class="nav-scroll">
                <div class="asset-clipboard-bar" style="margin:12px;">
                    <div class="asset-clipboard-info"><i data-lucide="hard-drive"></i><span>已用 ${escapeHtml(formatFileSize(storageUsage?.used_bytes || 0))}${quotaBytes ? ` / ${escapeHtml(formatFileSize(quotaBytes))}` : ' / 不限额'}</span></div>
                </div>
                <div style="padding:0 12px 12px;">
                    <div style="height:10px;border-radius:999px;background:rgba(148,163,184,.22);overflow:hidden;">
                        <div style="width:${percent.toFixed(1)}%;height:100%;background:${progressTone};"></div>
                    </div>
                    <div style="margin-top:8px;font-size:12px;opacity:.7;">剩余 ${quotaBytes && remainingBytes !== null ? escapeHtml(formatFileSize(remainingBytes)) : '不限'}</div>
                </div>
                <div class="nav-tree">
                    <button class="tree-row tree-parent ${storageCategoryFilter ? '' : 'active'}" type="button" data-storage-category="">
                        <span class="tree-row-icon"><i data-lucide="folders"></i></span>
                        <span class="tree-row-name">全部类别</span>
                        <span class="tree-row-count">${Number(storageUsage?.total_files || 0)}</span>
                    </button>
                    ${categories.map(item => `
                        <button class="tree-row tree-child ${storageCategoryFilter === item.category ? 'active' : ''}" type="button" data-storage-category="${escapeAttr(item.category)}">
                            <span class="tree-elbow"></span>
                            <span class="tree-row-icon"><i data-lucide="folder"></i></span>
                            <span class="tree-row-name">${escapeHtml(item.category || 'unknown')}</span>
                            <span class="tree-row-count">${item.file_count}</span>
                        </button>
                    `).join('')}
                </div>
                <section class="storage-category-usage">
                    <div class="storage-category-usage-title">按类别占用</div>
                    <div class="detail-meta-grid">${categoryUsageHtml || '<div class="detail-meta"><span>暂无数据</span><strong>0</strong></div>'}</div>
                </section>
            </div>
        </aside>
        <section class="asset-panel asset-content ${storageManageMode ? 'manage-on' : ''}">
            <div class="content-toolbar">
                <div class="content-heading">
                    <strong>空间管理</strong>
                    <span>${totalMatches} 个文件</span>
                </div>
                <div class="asset-tools">
                    <div class="storage-sort-control" role="group" aria-label="按创建时间排序">
                        <button class="${storageSortOrder === 'desc' ? 'active' : ''}" type="button" data-storage-sort="desc" aria-pressed="${storageSortOrder === 'desc'}" title="按创建时间倒序，最新文件在前"><i data-lucide="arrow-down"></i><span>最新</span></button>
                        <button class="${storageSortOrder === 'asc' ? 'active' : ''}" type="button" data-storage-sort="asc" aria-pressed="${storageSortOrder === 'asc'}" title="按创建时间正序，最早文件在前"><i data-lucide="arrow-up"></i><span>最早</span></button>
                    </div>
                    <label class="asset-search-wrap"><i data-lucide="search"></i><input id="storageSearch" class="asset-search" type="search" value="${escapeAttr(storageQuery)}" placeholder="搜索文件名或类别"></label>
                    <button class="asset-btn" type="button" data-storage-refresh><i data-lucide="refresh-cw"></i><span>刷新</span></button>
                    <button class="asset-btn ${storageManageMode ? 'primary' : ''}" type="button" data-storage-manage ${entries.length ? '' : 'disabled'}><i data-lucide="list-checks"></i><span>${storageManageMode ? '完成管理' : '批量管理'}</span></button>
                    <div class="storage-filter-menu">
                        <button class="asset-btn ${(storageFiltersOpen || storageCreatedBefore || storageUnreferencedOnly) ? 'primary' : ''}" type="button" data-storage-filter-toggle aria-expanded="${storageFiltersOpen}"><i data-lucide="list-filter"></i><span>条件筛选</span></button>
                        ${storageFiltersOpen ? `
                            <div class="storage-filter-popover">
                                <div class="storage-filter-head"><strong>筛选条件</strong><span>${totalMatches} 个文件符合条件</span></div>
                                <div class="storage-filter-field">
                                    <span>创建时间</span>
                                    <label class="storage-date-filter ${storageCreatedBefore ? 'active' : ''}" data-storage-date-trigger>
                                        <i data-lucide="calendar-days"></i>
                                        <span>${storageCreatedBefore ? `${escapeHtml(storageDateInputValue())} 之前` : '指定日期之前'}</span>
                                        <input id="storageBeforeDate" type="date" value="${escapeAttr(storageDateInputValue())}" aria-label="选择截止日期">
                                    </label>
                                </div>
                                <label class="storage-reference-filter"><input id="storageUnreferencedOnly" type="checkbox" ${storageUnreferencedOnly ? 'checked' : ''}><span>仅未被画布、历史、对话或素材库引用</span></label>
                                <button class="asset-btn danger storage-delete-matching" type="button" data-storage-delete-matching ${totalMatches ? '' : 'disabled'}><i data-lucide="trash-2"></i><span>删除全部符合条件的 ${totalMatches} 个文件</span></button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            <div class="manage-tools">
                <span>已选择 ${storageSelectedIds.size} 个文件。</span>
                <div class="asset-tools">
                    <button class="asset-btn" type="button" data-storage-select-all ${entries.length ? '' : 'disabled'}><i data-lucide="check-square"></i><span>全选</span></button>
                    <button class="asset-btn" type="button" data-storage-clear ${storageSelectedIds.size ? '' : 'disabled'}><i data-lucide="square"></i><span>清空</span></button>
                    <button class="asset-btn danger" type="button" data-storage-delete-selected ${storageSelectedIds.size ? '' : 'disabled'}><i data-lucide="trash-2"></i><span>删除</span></button>
                </div>
            </div>
            <div class="content-scroll">
                <div class="asset-grid">
                    ${entries.map(item => `
                        <article class="asset-card ${detail?.file_id === item.file_id ? 'active' : ''}" data-storage-card="${escapeAttr(item.file_id)}">
                            <input class="asset-card-check" type="checkbox" data-storage-check="${escapeAttr(item.file_id)}" ${storageSelectedIds.has(item.file_id) ? 'checked' : ''}>
                            <div class="asset-thumb">${storageCardThumb(item)}</div>
                            <div class="asset-card-body">
                                <div class="asset-card-name" title="${escapeAttr(item.original_name || item.filename || '')}">${escapeHtml(item.original_name || item.filename || 'file')}</div>
                                <div class="asset-card-meta">${escapeHtml(item.category || 'unknown')} · ${escapeHtml(formatFileSize(item.size))}</div>
                                <div class="asset-card-time">${escapeHtml(formatDate(item.created_at || 0))}</div>
                            </div>
                        </article>
                    `).join('') || '<div class="empty-state">当前筛选下没有文件。</div>'}
                </div>
                <div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:16px 0 4px;">
                    <span style="font-size:12px;opacity:.72;">第 ${currentPage} / ${totalPages} 页</span>
                    <button class="asset-btn" type="button" data-storage-page-prev ${currentPage <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i><span>上一页</span></button>
                    <button class="asset-btn" type="button" data-storage-page-next ${currentPage >= totalPages ? 'disabled' : ''}><i data-lucide="chevron-right"></i><span>下一页</span></button>
                </div>
            </div>
        </section>
        <aside class="asset-panel asset-detail">
            ${renderStorageDetail(detail)}
        </aside>
    `;
}
function renderStorageDetail(item){
    if(!item){
        return `
            <div class="panel-head"><div class="panel-title"><strong>空间详情</strong><span>选择文件查看详情</span></div></div>
            <div class="detail-scroll">
                <div class="detail-empty"><i data-lucide="file-search"></i><span>选择文件查看详情</span></div>
            </div>
        `;
    }
    const resolution = Number(item.natural_w || item.width || item.w || 0) > 0 && Number(item.natural_h || item.height || item.h || 0) > 0 ? `${Number(item.natural_w || item.width || item.w)} × ${Number(item.natural_h || item.height || item.h)}` : '未知';
    return `
        <div class="panel-head">
            <div class="panel-title"><strong>文件详情</strong><span>${escapeHtml(item.category || 'unknown')}</span></div>
            <div class="panel-actions">
                <button class="asset-icon-btn" type="button" data-storage-open="${escapeAttr(item.file_id)}" title="新窗口打开"><i data-lucide="external-link"></i></button>
                <button class="asset-icon-btn" type="button" data-storage-copy="${escapeAttr(item.file_id)}" title="复制链接"><i data-lucide="link"></i></button>
                <button class="asset-icon-btn danger" type="button" data-storage-delete-one="${escapeAttr(item.file_id)}" title="删除"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
        <div class="detail-scroll">
            <div class="detail-media"><button class="detail-media-frame detail-media-zoomable" type="button" data-storage-preview="${escapeAttr(item.file_id)}" title="点击放大预览">${assetThumb({url:item.url, name:item.original_name || item.filename, kind:item.kind})}</button></div>
            <div class="detail-body">
                <div class="detail-name">${escapeHtml(item.original_name || item.filename || 'file')}</div>
                    <div class="detail-meta-grid">
                        <div class="detail-meta"><span>类型</span><strong>${escapeHtml(item.kind || 'document')}</strong></div>
                        <div class="detail-meta"><span>类别</span><strong>${escapeHtml(item.category || 'unknown')}</strong></div>
                        <div class="detail-meta"><span>分辨率</span><strong>${escapeHtml(resolution)}</strong></div>
                        <div class="detail-meta"><span>大小</span><strong>${escapeHtml(formatFileSize(item.size || 0))}</strong></div>
                    <div class="detail-meta"><span>创建时间</span><strong>${escapeHtml(formatDate(item.created_at || 0))}</strong></div>
                </div>
                <div class="detail-url">${escapeHtml(item.url || '')}</div>
            </div>
        </div>
    `;
}
