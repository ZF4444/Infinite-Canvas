// asset-manager 页面 —— 详情预览灯箱 + 框选子系统（拆分自 static/js/asset-manager.js）。
//
// 范围两块，物理上相邻但逻辑独立：
// 1. 详情预览灯箱——点击卡片弹出全屏大图/视频预览（showDetailPreview/
//    closeDetailPreview），支持鼠标拖拽平移和滚轮缩放
//    （applyLightboxTransform/zoomDetailPreview/beginLightboxPan/
//    updateLightboxPan/endLightboxPan）。openAssetItem 是资产卡片的
//    "打开"入口，跟灯箱物理相邻但其实是新窗口打开而不是弹层，一并留在
//    这里因为原文件里紧邻。
// 2. 框选（marquee selection）——在卡片网格区域按住鼠标拖拽画一个选框，
//    框内的卡片自动进入多选状态（beginMarqueeSelection/
//    updateMarqueeSelection/endMarqueeSelection），rectsIntersect 是
//    矩形相交判断的纯函数，marqueeTargetSelector 决定当前标签页下框选
//    应该框中哪一种卡片（资产/提示词/本地上传/本地文件夹，视 activeTab
//    而定）。
//
// 经典 <script>，非 ES module，原因同 storage-manager.js。
//
// 依赖 main.js 保留的核心状态和函数：activeTab（决定框选目标）、
// selectedAssetIds/selectedPromptIds/selectedLocalIds/
// selectedLocalUploadIds（框选结果写入的多选状态集合，分别属于各自
// 子系统但框选本身是跨子系统的通用交互，所以框选逻辑本身独立成模块，
// 只读写这几个 Set，不重复声明）、marqueeState/lightboxPanState（框选和
// 灯箱平移各自的临时交互状态）、findAssetItem/findPromptItem/
// findLocalItem/findLocalUpload（拆分到其它模块的查找函数，跨模块
// 调用）、assetThumb（通用缩略图渲染）、escapeHtml/escapeAttr/setStatus/
// refreshIcons（通用工具）、render（主渲染入口）。

function openAssetItem(id){
    const item = findAssetItem(id);
    if(item?.url) window.open(item.url, '_blank', 'noopener');
}
function showDetailPreview(source, id){
    const item = source === 'local'
        ? findLocalItem(id)
        : source === 'localup'
            ? findLocalUpload(id)
            : source === 'storage'
                ? findStorageEntry(id)
                : findAssetItem(id);
    if(!item) return;
    const kind = source === 'local' ? (item.kind || localItemKind(item)) : source === 'storage' ? String(item.kind || 'document') : assetKind(item);
    if(kind !== 'image'){
        setStatus('仅图片支持放大预览');
        return;
    }
    const url = source === 'local' ? localObjectUrl(item) : item.url;
    if(!url) return;
    document.querySelector('.asset-lightbox')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'asset-lightbox';
    overlay.dataset.scale = '1';
    overlay.dataset.x = '0';
    overlay.dataset.y = '0';
    overlay.innerHTML = `
        <div class="asset-lightbox-inner" role="dialog" aria-modal="true" aria-label="图片预览">
            <img class="asset-lightbox-image" src="${escapeAttr(url)}" alt="${escapeAttr(item.name || 'preview')}" draggable="false">
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('asset-lightbox-open');
}
function closeDetailPreview(){
    document.querySelector('.asset-lightbox')?.remove();
    document.body.classList.remove('asset-lightbox-open');
    lightboxPanState = null;
}
function applyLightboxTransform(overlay){
    const image = overlay?.querySelector?.('.asset-lightbox-image');
    if(!image) return;
    const scale = Number(overlay.dataset.scale || 1);
    const x = Number(overlay.dataset.x || 0);
    const y = Number(overlay.dataset.y || 0);
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    overlay.classList.toggle('zoomed', scale > 1.01);
}
function zoomDetailPreview(event){
    const overlay = event.target.closest?.('.asset-lightbox');
    const image = event.target.closest?.('.asset-lightbox-image');
    if(!overlay || !image) return;
    event.preventDefault();
    const current = Number(overlay.dataset.scale || 1);
    const next = Math.max(0.25, Math.min(8, current * (event.deltaY < 0 ? 1.15 : 0.87)));
    const rect = overlay.getBoundingClientRect();
    const anchorX = event.clientX - (rect.left + rect.width / 2);
    const anchorY = event.clientY - (rect.top + rect.height / 2);
    const currentX = Number(overlay.dataset.x || 0);
    const currentY = Number(overlay.dataset.y || 0);
    const ratio = next / current;
    overlay.dataset.scale = String(next);
    if(next <= 1.01){
        overlay.dataset.x = '0';
        overlay.dataset.y = '0';
    } else {
        overlay.dataset.x = String(anchorX - ratio * (anchorX - currentX));
        overlay.dataset.y = String(anchorY - ratio * (anchorY - currentY));
    }
    applyLightboxTransform(overlay);
}
function beginLightboxPan(event){
    const image = event.target.closest?.('.asset-lightbox-image');
    const overlay = event.target.closest?.('.asset-lightbox');
    if(!image || !overlay) return;
    const scale = Number(overlay.dataset.scale || 1);
    if(scale <= 1.01) return;
    event.preventDefault();
    lightboxPanState = {
        overlay,
        pointerId:event.pointerId,
        startX:event.clientX,
        startY:event.clientY,
        originX:Number(overlay.dataset.x || 0),
        originY:Number(overlay.dataset.y || 0)
    };
    image.setPointerCapture?.(event.pointerId);
    overlay.classList.add('dragging');
}
function updateLightboxPan(event){
    if(!lightboxPanState || event.pointerId !== lightboxPanState.pointerId) return;
    const {overlay, startX, startY, originX, originY} = lightboxPanState;
    overlay.dataset.x = String(originX + event.clientX - startX);
    overlay.dataset.y = String(originY + event.clientY - startY);
    applyLightboxTransform(overlay);
}
function endLightboxPan(event){
    if(!lightboxPanState || event.pointerId !== lightboxPanState.pointerId) return;
    lightboxPanState.overlay?.classList.remove('dragging');
    lightboxPanState = null;
}
function rectsIntersect(a, b){
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function marqueeTargetSelector(){
    if(activeTab === 'assets' && assetManageMode) return '[data-asset-card]';
    if(activeTab === 'prompts' && promptManageMode) return '[data-prompt-row]';
    if(activeTab === 'local' && localManageMode) return '[data-local-card]';
    return '';
}
function beginMarqueeSelection(event){
    const selector = marqueeTargetSelector();
    if(!selector) return;
    if(event.button !== 0) return;
    if(event.target.closest?.('button,input,textarea,select,.side-upload-card,.upload-grid-card,.asset-search-wrap')) return;
    const area = event.target.closest?.('.content-scroll');
    if(!area) return;
    event.preventDefault();
    const box = document.createElement('div');
    box.className = 'selection-marquee';
    area.appendChild(box);
    marqueeState = {
        startX:event.clientX,
        startY:event.clientY,
        area,
        box,
        selector,
        baseAsset:new Set(selectedAssetIds),
        basePrompt:new Set(selectedPromptIds),
        baseLocal:new Set(selectedLocalIds)
    };
    updateMarqueeSelection(event);
}
function updateMarqueeSelection(event){
    if(!marqueeState) return;
    const left = Math.min(marqueeState.startX, event.clientX);
    const top = Math.min(marqueeState.startY, event.clientY);
    const right = Math.max(marqueeState.startX, event.clientX);
    const bottom = Math.max(marqueeState.startY, event.clientY);
    const areaRect = marqueeState.area.getBoundingClientRect();
    const boxLeft = left - areaRect.left + marqueeState.area.scrollLeft;
    const boxTop = top - areaRect.top + marqueeState.area.scrollTop;
    Object.assign(marqueeState.box.style, {
        left:`${boxLeft}px`,
        top:`${boxTop}px`,
        width:`${Math.max(1, right - left)}px`,
        height:`${Math.max(1, bottom - top)}px`
    });
    const rect = {left, top, right, bottom};
    if(activeTab === 'assets'){
        selectedAssetIds = new Set(marqueeState.baseAsset);
        document.querySelectorAll(marqueeState.selector).forEach(el => {
            if(rectsIntersect(rect, el.getBoundingClientRect())) selectedAssetIds.add(el.dataset.assetCard);
        });
    } else if(activeTab === 'prompts') {
        selectedPromptIds = new Set(marqueeState.basePrompt);
        document.querySelectorAll(marqueeState.selector).forEach(el => {
            if(rectsIntersect(rect, el.getBoundingClientRect())) selectedPromptIds.add(el.dataset.promptRow);
        });
    } else if(activeTab === 'local') {
        selectedLocalIds = new Set(marqueeState.baseLocal);
        document.querySelectorAll(marqueeState.selector).forEach(el => {
            if(rectsIntersect(rect, el.getBoundingClientRect())) selectedLocalIds.add(el.dataset.localCard);
        });
    }
    document.querySelectorAll('[data-asset-check]').forEach(input => { input.checked = selectedAssetIds.has(input.dataset.assetCheck); });
    document.querySelectorAll('[data-prompt-check]').forEach(input => { input.checked = selectedPromptIds.has(input.dataset.promptCheck); });
    document.querySelectorAll('[data-local-check]').forEach(input => { input.checked = selectedLocalIds.has(input.dataset.localCheck); });
}
function endMarqueeSelection(){
    if(!marqueeState) return;
    marqueeState.box.remove();
    marqueeState = null;
    pendingBatchDelete = '';
    render();
}
