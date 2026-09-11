// 从 frontend/src/canvas/main.js 剪切出的核心渲染/节点事件绑定逻辑（M7 拆分批次）。
// 剪切时未改动任何函数签名/内部逻辑，只做了纯粹的位置搬移。
//
// 为什么这里不用 ES module 的 export/import（跟 M1-M6 同一个原因）：
// canvas.js 依赖经典 <script> 的全局作用域语义，
// static/canvas.html 里 57 处内联 onclick="xxx()" 都依赖这一点。
// 所以这里同样只做"物理文件拆分"：canvas-render.js 保持经典脚本语法，通过
// <script src="canvas-render.js"> 排在 upload.js 之后、main.js 之前加载。
//
// 本文件包含两类东西：
//   1. 节点卡片 HTML 构建：smartGroupBodyHtml /
//      smartRecoverableImageTask / imageTaskRecoverBodyHtml / nodeBodyHtml
//   2. 主渲染循环与节点事件绑定：formatRunDuration / nodeRunElapsedMs /
//      runTimePillHtml / hideRunTimerForNode / refreshRunTimerPills /
//      render / measureSmartNodeImages / pickMediaForSmartNode /
//      bindNodeEvents / rectOverlapNode / dragConnectTargetFor /
//      canAutoConnectDraggedNode / restoreDraggedNodePosition
//
// 这是整个 canvas.js 中耦合度最高的模块：render()/bindNodeEvents() 直接
// 读写几乎所有全局状态（nodes/viewport/selectedId/selectedIds/selectedImage/
// dragState/portDragState/smartLoopContext 等），并调用其余全部模块导出的函数。
//
// 明确排除、留在 main.js 或其它模块的内容（按"实际调用关系"而非物理位置判断，
// 与 M3-M6 采用的判定原则一致）：
//   - bindPromptNodeControls / bindScrollableText（物理上紧邻，
//     但只服务于 smart-prompt 节点，属于未来 prompt-node.js 的范围）
//   - window.onmousemove / window.onmouseup（全局鼠标事件总线，横跨拖拽/
//     平移/裁剪/全景图/资产库等所有模块的交互状态，且是匿名函数赋值，
//     不是具名函数声明；本次不动，留在 main.js，避免过早耦合到还不存在的
//     image-editor.js / asset-library.js 的拆分边界）
//   - deleteNode / clearNodeMediaBeforeDelete / deleteNodeFromButton
//     （节点生命周期管理，非渲染/事件绑定核心，留待后续评估）

function smartGroupBodyHtml(node){
    const groupThumbLayout = smartGroupThumbLayout(node);
    const refThumbs = groupThumbLayout?.refs || [];
    const members = smartGroupMembers(node);
    const counts = members.reduce((acc, member) => {
        if(member.type === 'smart-prompt') acc.prompt += 1;
        else if(member.type === 'smart-loop') acc.loop += 1;
        return acc;
    }, {prompt:0, media:refThumbs.length, loop:0});
    const summary = [
        counts.prompt ? `${counts.prompt} 提示词` : '',
        counts.media ? `${counts.media} 图片` : '',
        counts.loop ? `${counts.loop} 循环` : ''
    ].filter(Boolean).join(' · ') || '双击或拖入图片';
    if(refThumbs.length){
        const totalThumbs = Math.max(1, Number(groupThumbLayout?.rows || 1) * Number(groupThumbLayout?.cols || 1));
        if(totalThumbs === 1 && refThumbs.length === 1){
            const ref = refThumbs[0];
            const innerW = Math.max(24, Number(groupThumbLayout.innerW || groupThumbLayout.width || SMART_GROUP_DEFAULT_WIDTH));
            const innerH = Math.max(24, Number(groupThumbLayout.innerH || groupThumbLayout.height || SMART_GROUP_DEFAULT_HEIGHT));
            return `<div class="smart-group-card has-thumbs">
                <div class="smart-group-summary"><i data-lucide="group"></i><span>${escapeHtml(summary)}</span></div>
                <div class="image-wrap smart-group-single-thumb ${selectedImage.nodeId === ref.nodeId && Number(selectedImage.index) === Number(ref.index) ? 'image-selected' : ''}" data-ref-node-id="${escapeAttr(ref.nodeId)}" data-ref-image-index="${ref.index}" data-image-index="${ref.index}" data-media-signature="${escapeAttr(`${mediaKindForItem(ref.item)}:${ref.item?.url || ''}`)}" style="--node-img-w:${innerW}px;--node-img-h:${innerH}px">${singleMediaHtml(ref.item, innerW, innerH)}${imageResolutionBadgeHtml(ref.item)}</div>
            </div>`;
        }
        return `<div class="smart-group-card has-thumbs">
            <div class="smart-group-summary"><i data-lucide="group"></i><span>${escapeHtml(summary)}</span></div>
            <div class="thumb-grid smart-group-thumb-grid" style="--thumb-cols:${groupThumbLayout.cols}; --thumb-size:${groupThumbLayout.thumb}px">${refThumbs.map(ref => {
                return `<div class="thumb-item ${selectedImage.nodeId === ref.nodeId && Number(selectedImage.index) === Number(ref.index) ? 'image-selected' : ''}" data-ref-node-id="${escapeAttr(ref.nodeId)}" data-ref-image-index="${ref.index}" data-image-index="${ref.index}" data-media-signature="${escapeAttr(`${mediaKindForItem(ref.item)}:${ref.item?.url || ''}`)}">${thumbMediaHtml(ref.item)}${imageResolutionBadgeHtml(ref.item)}</div>`;
            }).join('')}</div>
        </div>`;
    }
    return `<div class="smart-group-card">
        <div class="smart-group-summary"><i data-lucide="group"></i><span>${escapeHtml(summary)}</span></div>
        ${members.length ? '' : `<div class="smart-group-empty"><i data-lucide="plus"></i><span>拖入图片自动收进分组</span></div>`}
    </div>`;
}
function smartRecoverableImageTask(node){
    return smartPendingTasks(node).find(task => task.failed && task.recoverTaskId) || null;
}
function nodeBodyHtml(node, layout){
    if(node.type === 'smart-group') return smartGroupBodyHtml(node);
    if(node.type === 'smart-prompt') return promptNodeBodyHtml(node);
    if(node.type === 'smart-loop') return smartLoopBodyHtml(node);
    const imgs = (node.images || []).map(imageForDisplay);
    const recoverTask = smartRecoverableImageTask(node);
    if(recoverTask && imgs.length === 0){
        return imageTaskRecoverBodyHtml(node, recoverTask, layout);
    }
    if(node.queued && imgs.length === 0 && !node.pending){
        return `<div class="loading-cell single queued" style="width:${layout.width}px;height:${layout.height}px"></div>`;
    }
    if(node.pending && imgs.length === 0){
        const count = Math.max(1, Number(node.pending) || 1);
        if(count <= 1 || node.pendingCandidatePool) return `<div class="loading-cell single" style="width:${layout.width}px;height:${layout.height}px"></div>`;
        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
        const rows = Math.ceil(count / cols);
        return `<div class="loading-skeleton" style="grid-template-columns:repeat(${cols}, 1fr);grid-template-rows:repeat(${rows}, 1fr);width:${layout.width}px;height:${layout.height}px;padding:8px;box-sizing:border-box">${Array.from({length:count}).map(() => `<div class="loading-cell"></div>`).join('')}</div>`;
    }
    if(imgs.length > 1) return `<div class="thumb-grid" style="--thumb-cols:${layout.cols}; --thumb-size:${layout.thumb}px">${imgs.map((img, i) => `<div class="thumb-item ${selectedImage.nodeId === node.id && selectedImage.index === i ? 'image-selected' : ''}" data-image-index="${i}" data-media-signature="${escapeAttr(`${mediaKindForItem(img)}:${img?.url || ''}`)}">${thumbMediaHtml(img)}${imageResolutionBadgeHtml(img)}</div>`).join('')}</div>`;
    if(imgs[0]) return `<div class="image-wrap ${candidatePanelNodeId === node.id ? 'candidate-open' : ''} ${selectedImage.nodeId === node.id && selectedImage.index === 0 ? 'image-selected' : ''}" data-image-index="0" data-media-signature="${escapeAttr(`${mediaKindForItem(imgs[0])}:${imgs[0]?.url || ''}`)}" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">${singleMediaHtml(imgs[0], layout.width, layout.height)}${imageResolutionBadgeHtml(imgs[0])}${candidateOverlayHtml(node, layout)}</div>`;
    return `<div class="node-drop">
        <button class="generation-node-trigger" type="button" data-upload-action="files" title="${escapeHtml(genKindLabel(node))}">
            <span class="generation-node-main"><i data-lucide="${genKindIcon(node)}"></i></span>
            <span class="generation-node-title">${escapeHtml(genKindLabel(node))}</span>
            <span class="generation-node-sub">拖拽 / 粘贴 / 点击上传</span>
        </button>
    </div>`;
}
function imageTaskRecoverBodyHtml(node, task, layout){
    const querying = Boolean(task.querying);
    const failedCount = smartPendingTasks(node).filter(item => item.failed && item.recoverTaskId).length;
    const title = querying ? '查询中' : '任务未丢失';
    const sub = failedCount > 1 ? `还有 ${failedCount} 个任务可查询` : `任务 ID：${task.recoverTaskId || ''}`;
    return `<div class="task-recover-cell loading-cell single" style="width:${layout.width}px;height:${layout.height}px">
        <div class="task-recover-overlay">
            <div class="task-recover-spinner"><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i></div>
            <div class="task-recover-text">${escapeHtml(title)}</div>
            <div class="task-recover-sub">${escapeHtml(sub)}</div>
            <button class="task-recover-query" type="button" data-image-task-query="${escapeAttr(node.id)}" data-task-id="${escapeAttr(task.taskId)}" ${querying ? 'disabled' : ''}><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i><span>${querying ? '查询中…' : '查询结果'}</span></button>
        </div>
    </div>`;
}
// M1 拆分：nowMs 已迁移到 frontend/src/canvas/utils.js。
function formatRunDuration(ms){
    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return min ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}
function nodeRunElapsedMs(node){
    if(!node) return 0;
    if(node.runFinishedAt && node.runStartedAt) return Number(node.runElapsedMs) || (Number(node.runFinishedAt) - Number(node.runStartedAt));
    if(node.runStartedAt) return nowMs() - Number(node.runStartedAt);
    return 0;
}
function runTimePillHtml(node){
    if(!node || node.runTimerHidden || node.type === 'smart-prompt') return '';
    const running = Boolean(node.pending || node.running);
    if(!running && !node.runFinishedAt) return '';
    const cls = running ? '' : ' done';
    return `<span class="run-time-pill${cls}" data-run-timer="${escapeHtml(node.id)}">${formatRunDuration(nodeRunElapsedMs(node))}</span>`;
}
function hideRunTimerForNode(node){
    if(!node || node.runTimerHidden || node.pending || node.running || !node.runFinishedAt) return false;
    node.runTimerHidden = true;
    scheduleSave();
    return true;
}
function refreshRunTimerPills(){
    const active = nodes.some(n => n.type !== 'smart-prompt' && !n.runTimerHidden && (n.pending || n.running || n.runFinishedAt));
    document.querySelectorAll('[data-run-timer]').forEach(el => {
        const node = nodes.find(n => n.id === el.dataset.runTimer);
        if(!node || node.runTimerHidden || node.type === 'smart-prompt') {
            el.remove();
            return;
        }
        el.textContent = formatRunDuration(nodeRunElapsedMs(node));
        el.classList.toggle('done', Boolean(!node.pending && !node.running && node.runFinishedAt));
    });
    if(active && !runTimerInterval) runTimerInterval = setInterval(refreshRunTimerPills, 1000);
    if(!active && runTimerInterval){ clearInterval(runTimerInterval); runTimerInterval = null; }
}
// 统一名称栏：每种节点类型对应的小图标，复用右键（画布）菜单里的节点图标。
// 生成节点按 genKind 区分（图片 image / 视频 play-square / 工作流 workflow），
// 与 canvasContextMenuHtml() 中的创建项一一对应。
function nodeTypeIcon(node){
    if(!node) return 'image';
    if(node.type === 'smart-prompt') return 'text-cursor-input';
    if(node.type === 'smart-loop') return 'repeat-2';
    if(node.type === 'smart-group') return 'group';
    // 图片 / 视频 / 工作流生成节点：复用 genKindIcon（image / play-square / workflow）。
    return genKindIcon(node);
}
// 统一名称栏显示的名称：优先使用用户编辑并持久化的 node.title，
// 缺省时回退到各类型的默认名称。
function nodeDisplayTitle(node){
    if(!node) return '';
    const custom = typeof node.title === 'string' ? node.title.trim() : '';
    if(custom) return node.title;
    if(node.type === 'smart-group') return '智能分组';
    if(node.type === 'smart-prompt') return 'Prompt';
    if(node.type === 'smart-loop') return 'Loop';
    const imgs = node.images || [];
    return imgs.length > 1 ? 'Group' : imgs.length ? 'Image' : genKindLabel(node);
}
function smartNodeHtmlEntry(node){
        const migratedCandidates = migrateGeneratedImagesToCandidatePool(node);
        const imgs = node.images || [];
        const title = nodeDisplayTitle(node);
        const nameIcon = nodeTypeIcon(node);
        const scale = nodeScale(node);
        const layout = imageLayout(imgs, scale, node);
        const isPrompt = node.type === 'smart-prompt';
        const isLoop = node.type === 'smart-loop';
        const isSmartGroup = node.type === 'smart-group';
        const isCompactMember = isSmartGroupCompactMember(node);
        const isImageNode = node.type === 'smart-image' || !node.type;
        const isQueued = Boolean(node.queued && imgs.length === 0 && !node.pending);
        const isEmpty = isImageNode && imgs.length === 0 && !node.pending && !isQueued;
        const isHistory = isHistoryGroupNode(node);
        const isGroup = isImageNode && imgs.length > 1;
        const isPending = ((node.pending || isQueued) && imgs.length === 0);
        const body = nodeBodyHtml(node, layout);
        const hint = isSmartGroup ? '拖入图片、提示词或循环节点' : isPending ? escapeHtml(tr('smart.hintPending')) : (imgs.length > 1 ? escapeHtml(tr('smart.hintMulti')) : imgs.length ? escapeHtml(tr('smart.hintSingle')) : escapeHtml(node.genKind === 'video' ? '支持视频 / 音频，也可直接文生视频' : node.genKind === 'workflow' ? '支持图片 / 视频 / 音频，ComfyUI 工作流生成' : '支持图片 / 视频 / 音频，也可直接文生图'));
        const floatingActions = candidateControlHtml(node);
        const html = `<div class="image-node ${isEmpty ? 'empty-node' : ''} ${isGroup ? 'group-node' : ''} ${isHistory ? 'history-group-node' : ''} ${isPrompt ? 'prompt-smart-node' : ''} ${isLoop ? 'loop-smart-node' : ''} ${isSmartGroup ? 'smart-group-node' : ''} ${isCompactMember ? 'smart-group-member-node' : ''} ${candidatePanelNodeId === node.id ? 'candidate-panel-open-node' : ''} ${isNodeSelected(node.id) ? 'selected' : ''} ${(dragState?.groupIds?.includes(node.id) || dragState?.id === node.id) ? 'dragging' : ''} ${node.running ? 'node-running' : ''} ${isPending ? 'node-pending' : ''}" data-id="${escapeHtml(node.id)}" style="left:${node.x || 0}px;top:${node.y || 0}px;width:${layout.width}px;height:${layout.height}px">
            <div class="node-head"><div class="node-name-bar" title="${escapeAttr(title)}"><span class="node-name-icon"><i data-lucide="${escapeAttr(nameIcon)}"></i></span><span class="node-title" data-node-title="${escapeAttr(node.id)}" spellcheck="false">${escapeHtml(title)}</span></div></div>
            ${!isEmpty && floatingActions ? `<div class="floating-node-actions">${floatingActions}</div>` : ''}
            ${runTimePillHtml(node)}
            <div class="node-body">${body}</div>
            ${expandedCandidateGridHtml(node)}
            <div class="node-hint">${hint}</div>
            <div class="node-port port-in" data-port="in" title="input"></div>
            <div class="node-port port-out" data-port="out" title="output"></div>
        </div>`;
        return {node, html, migratedCandidates};
}
function render(){
    const mediaStates = captureMediaPlaybackStates();
    const reusableNodes = new Map();
    world.querySelectorAll('.image-node').forEach(el => {
        const node = nodes.find(n => n.id === el.dataset.id);
        if(smartNodeHasLiveMedia(node)) reusableNodes.set(node.id, el);
    });
    let migratedCandidates = false;
    const nodeHtmlEntries = nodes.map(node => {
        const entry = smartNodeHtmlEntry(node);
        if(entry.migratedCandidates) migratedCandidates = true;
        return entry;
    });
    const tpl = document.createElement('template');
    tpl.innerHTML = nodeHtmlEntries.map(entry => entry.html).join('');
    const renderedNodeEls = new Map();
    nodeHtmlEntries.forEach(entry => {
        const fresh = tpl.content.querySelector(`.image-node[data-id="${CSS.escape(entry.node.id)}"]`);
        if(fresh) renderedNodeEls.set(entry.node.id, fresh);
    });
    const keepEls = new Set();
    reusableNodes.forEach(el => keepEls.add(el));
    [...world.childNodes].forEach(child => {
        if(!keepEls.has(child)) child.remove();
    });
    world.insertAdjacentHTML('beforeend', renderConnections());
    nodeHtmlEntries.forEach(entry => {
        const fresh = renderedNodeEls.get(entry.node.id);
        if(!fresh) return;
        world.appendChild(fresh);
        const reusable = reusableNodes.get(entry.node.id);
        if(reusable){
            transplantSmartMediaElements(reusable, fresh);
            if(reusable !== fresh) reusable.remove();
        }
    });
    restoreMediaPlaybackStates(mediaStates);
    bindNodeEvents();
    bindConnectionEvents();
    updateComposer();
    updatePromptComposer();
    requestRenderMinimap();
    if(window.lucide) lucide.createIcons();
    measureSmartNodeImages();
    refreshRunTimerPills();
    updateSelectionActions();
    return;
    world.innerHTML = '';
    world.insertAdjacentHTML('beforeend', renderConnections());
    const nodesHtml = nodes.map(node => {
        const imgs = node.images || [];
        const title = node.type === 'smart-prompt' ? 'Prompt' : node.type === 'smart-loop' ? 'Loop' : (imgs.length > 1 ? 'Group' : 'Image');
        const scale = nodeScale(node);
        const layout = imageLayout(imgs, scale, node);
        const isPrompt = node.type === 'smart-prompt';
        const isLoop = node.type === 'smart-loop';
        const isImageNode = node.type === 'smart-image' || !node.type;
        const isQueued = Boolean(node.queued && imgs.length === 0 && !node.pending);
        const isEmpty = isImageNode && imgs.length === 0 && !node.pending && !isQueued;
        const isGroup = isImageNode && imgs.length > 1;
        const isPending = (node.pending || isQueued) && imgs.length === 0;
        const body = nodeBodyHtml(node, layout);
        const deleteBtn = `<button class="mini-x node-delete" type="button" title="${escapeHtml(tr('smart.deleteNode'))}"><i data-lucide="trash-2"></i></button>`;
        return `<div class="image-node ${isEmpty ? 'empty-node' : ''} ${isGroup ? 'group-node' : ''} ${isPrompt ? 'prompt-smart-node' : ''} ${isLoop ? 'loop-smart-node' : ''} ${isNodeSelected(node.id) ? 'selected' : ''} ${(dragState?.groupIds?.includes(node.id) || dragState?.id === node.id) ? 'dragging' : ''} ${node.running ? 'node-running' : ''} ${isPending ? 'node-pending' : ''}" data-id="${escapeHtml(node.id)}" style="left:${node.x || 0}px;top:${node.y || 0}px;width:${layout.width}px;height:${layout.height}px">
            <div class="node-head"><div class="node-title">${title}</div><div class="node-actions">${deleteBtn}</div></div>
            ${!isEmpty ? `<div class="floating-node-actions"><button class="mini-x node-delete" type="button" title="${escapeHtml(tr('smart.deleteNode'))}"><i data-lucide="trash-2"></i></button></div>` : ''}
            ${runTimePillHtml(node)}
            <div class="node-body">${body}</div>
            <div class="node-hint">${isPending ? escapeHtml(tr('smart.hintPending')) : (imgs.length > 1 ? escapeHtml(tr('smart.hintMulti')) : imgs.length ? escapeHtml(tr('smart.hintSingle')) : escapeHtml(tr('smart.hintEmpty')))}</div>
            <div class="node-port port-in" data-port="in" title="输入"></div>
            <div class="node-port port-out" data-port="out" title="输出"></div>
        </div>`;
    }).join('');
    world.insertAdjacentHTML('beforeend', nodesHtml);
    bindNodeEvents();
    bindConnectionEvents();
    updateComposer();
    updatePromptComposer();
    renderMinimap();
    if(window.lucide) lucide.createIcons();
    measureSmartNodeImages();
    refreshRunTimerPills();
    if(migratedCandidates) scheduleSave();
}
async function renderBootCanvas(onProgress, batchSize=40){
    const total = nodes.length;
    const safeBatchSize = Math.max(1, Number(batchSize) || 40);
    const report = (percent, label) => onProgress?.(percent, label);
    report(0, `正在构建节点 0 / ${total}`);
    await nextFrame();

    world.replaceChildren();
    world.insertAdjacentHTML('beforeend', renderConnections());
    for(let start = 0; start < total; start += safeBatchSize){
        const entries = nodes.slice(start, start + safeBatchSize).map(smartNodeHtmlEntry);
        const tpl = document.createElement('template');
        tpl.innerHTML = entries.map(entry => entry.html).join('');
        world.appendChild(tpl.content);
        const completed = Math.min(start + safeBatchSize, total);
        report(total ? completed / total * 50 : 50, `正在构建节点 ${completed} / ${total}`);
        await nextFrame();
    }
    const nodeElements = [...world.querySelectorAll('.image-node')];
    for(let start = 0; start < nodeElements.length; start += safeBatchSize){
        const completed = Math.min(start + safeBatchSize, nodeElements.length);
        bindNodeEvents(nodeElements.slice(start, completed));
        report(50 + (nodeElements.length ? completed / nodeElements.length * 15 : 15), `正在绑定节点 ${completed} / ${nodeElements.length}`);
        await nextFrame();
    }
    if(!nodeElements.length) report(65, '正在绑定节点 0 / 0');

    const connectionElements = [...world.querySelectorAll('[data-conn-index]')];
    for(let start = 0; start < connectionElements.length; start += safeBatchSize){
        const completed = Math.min(start + safeBatchSize, connectionElements.length);
        bindConnectionEvents(connectionElements.slice(start, completed));
        report(65 + (connectionElements.length ? completed / connectionElements.length * 5 : 5), `正在绑定连线 ${completed} / ${connectionElements.length}`);
        await nextFrame();
    }
    if(!connectionElements.length) report(70, '正在准备资源');
    updateComposer();
    updatePromptComposer();
    refreshRunTimerPills();
    updateSelectionActions();
    report(70, '正在准备资源');
}
function measureSmartNodeImages({applyReady=false, renderOnChange=true}={}){
    let changed = false;
    world.querySelectorAll('.image-node img,.image-node video').forEach(imgEl => {
        const candidatePanel = imgEl.closest('.candidate-panel');
        const candidateGridItem = imgEl.closest('[data-candidate-grid-item]');
        const nodeEl = imgEl.closest('.image-node');
        const itemEl = imgEl.closest('[data-image-index]');
        const node = nodes.find(n => n.id === nodeEl?.dataset.id);
        const candidateIndex = Number(candidatePanel?.dataset.candidateIndex ?? candidateGridItem?.dataset.candidateGridItem ?? -1);
        const index = Number(itemEl?.dataset.imageIndex ?? 0);
        const isCandidateImage = Boolean(candidatePanel || candidateGridItem);
        const candidatePool = isCandidateImage ? nodeCandidateImages(node) : [];
        const image = isCandidateImage ? candidatePool[candidateIndex] : node?.images?.[index];
        const isVideo = imgEl.tagName?.toLowerCase() === 'video';
        if(imgEl.tagName?.toLowerCase() === 'img' && image?.url) bindImageProxyFallback(imgEl, image);
        if(!node || !image) return;
        const apply = () => {
            const w = imgEl.naturalWidth || imgEl.videoWidth || 0;
            const h = imgEl.naturalHeight || imgEl.videoHeight || 0;
            if(w <= 0 || h <= 0) return;
            const currentW = Number(image.natural_w || image.width || image.w || 0);
            const currentH = Number(image.natural_h || image.height || image.h || 0);
            if(currentW === w && currentH === h) return;
            image.natural_w = w;
            image.natural_h = h;
            changed = true;
            if(isCandidateImage || image.generatedResult) syncCandidateImageDimensions(node, image, w, h);
            applyThumbDisplaySizeToElement(itemEl, image, Math.max(itemEl?.clientWidth || 0, itemEl?.clientHeight || 0));
            if(renderOnChange){
                render();
                scheduleSave();
            }
        };
        if(isVideo){
            if(imgEl.readyState >= 1){
                if(applyReady) apply();
            }
            else imgEl.addEventListener('loadedmetadata', apply, {once:true});
        } else if(imgEl.complete){
            if(applyReady) apply();
        }
        else imgEl.addEventListener('load', apply, {once:true});
    });
    return changed;
}

function pickMediaForSmartNode(nodeId){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*';
    input.multiple = true;
    input.onchange = () => {
        if(input.files?.length) handleFiles(input.files, nodeId);
        input.remove();
    };
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.click();
}
function bindNodeTitleEditing(el, id){
    const titleEl = el.querySelector('.node-title[data-node-title]');
    if(!titleEl) return;
    const enterEdit = () => {
        if(titleEl.classList.contains('editing')) return;
        const node = nodes.find(n => n.id === id);
        if(!node) return;
        titleEl.classList.add('editing');
        titleEl.setAttribute('contenteditable', 'plaintext-only');
        // plaintext-only 在部分浏览器不支持时回退为普通 contenteditable。
        if(titleEl.contentEditable !== 'plaintext-only') titleEl.setAttribute('contenteditable', 'true');
        titleEl.textContent = nodeDisplayTitle(node);
        titleEl.focus();
        // 选中全部文本，便于直接替换。
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    };
    const commit = () => {
        if(!titleEl.classList.contains('editing')) return;
        const node = nodes.find(n => n.id === id);
        titleEl.classList.remove('editing');
        titleEl.removeAttribute('contenteditable');
        const raw = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
        if(node){
            // 空名称视为清除自定义标题，回退到该类型默认名称。
            if(raw) node.title = raw;
            else delete node.title;
            scheduleSave();
        }
        // 重新渲染以恢复省略号/大写样式并刷新标题文本。
        render();
    };
    const cancel = () => {
        if(!titleEl.classList.contains('editing')) return;
        const node = nodes.find(n => n.id === id);
        titleEl.classList.remove('editing');
        titleEl.removeAttribute('contenteditable');
        titleEl.textContent = nodeDisplayTitle(node);
    };
    titleEl.addEventListener('mousedown', e => {
        // 编辑态时吞掉 mousedown，避免触发节点拖拽 / 选中逻辑。
        if(titleEl.classList.contains('editing')) e.stopPropagation();
    });
    titleEl.addEventListener('click', e => {
        if(titleEl.classList.contains('editing')) e.stopPropagation();
    });
    titleEl.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        enterEdit();
    });
    titleEl.addEventListener('keydown', e => {
        if(!titleEl.classList.contains('editing')) return;
        if(e.key === 'Enter'){
            e.preventDefault();
            titleEl.blur();
        } else if(e.key === 'Escape'){
            e.preventDefault();
            cancel();
            titleEl.blur();
        }
        e.stopPropagation();
    });
    titleEl.addEventListener('blur', () => { commit(); });
}
function bindNodeEvents(nodeElements=world.querySelectorAll('.image-node')){
    nodeElements.forEach(el => {
        const id = el.dataset.id;
        const nodeForControls = nodes.find(n => n.id === id);
        if(nodeForControls?.type === 'smart-prompt') bindPromptNodeControls(el, nodeForControls);
        if(nodeForControls?.type === 'smart-loop') bindLoopNodeControls(el, nodeForControls);
        // Native <video controls> can swallow click events without bubbling, so use a
        // capture-phase mousedown on the whole node to reliably select it and (re)open
        // the composer even when the press lands on the video's own control surface.
        el.addEventListener('mousedown', e => {
            if(Date.now() < suppressNodeClickUntil) return;
            if(e.button !== 0) return;
            if(!e.target.closest('video')) return;
            const node = nodes.find(n => n.id === id);
            if(!node) return;
            const timerHidden = hideRunTimerForNode(node);
            // Preserve an existing multi-selection (e.g. after a box-select) so dragging
            // still moves the whole group; only collapse to single-select otherwise.
            if(!selectedIds.includes(id)){
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                suppressComposerForCandidateNodeId = '';
                if(smartCascadeAnyRunning()) smartCascadeSilentSelection = false;
                syncSelectionUi();
            }
            updateComposer();
            if(timerHidden) render();
        }, true);
        el.onclick = e => {
            e.stopPropagation();
            // 名称栏：单击不重渲染，避免打断双击进入编辑态；编辑态更不处理。
            if(e.target.closest('.node-title')) return;
            if(Date.now() < suppressNodeClickUntil) return;
            const node = nodes.find(n => n.id === id);
            hideRunTimerForNode(node);
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            suppressComposerForCandidateNodeId = '';
        if(smartCascadeAnyRunning()) smartCascadeSilentSelection = false;
            render();
        };
        el.ondblclick = e => {
            e.stopPropagation();
            if(e.target.closest('.node-title')) return;
            if(nodeForControls?.type === 'smart-group' && !e.target.closest('.thumb-item,.image-wrap,.mini-x,.node-port')){
                openCreateMenu(e);
            }
        };
        bindNodeTitleEditing(el, id);
        const uploadTrigger = el.querySelector('.generation-node-main');
        uploadTrigger?.addEventListener('mousedown', e => {
            if(e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
        uploadTrigger?.addEventListener('click', e => {
            e.preventDefault(); e.stopPropagation();
            hideRunTimerForNode(nodes.find(n => n.id === id));
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            suppressComposerForCandidateNodeId = '';
            pendingGroupUploadPoint = null;
            uploadTargetId = id;
            syncSelectionUi();
            updateComposer();
            pickMediaForSmartNode(id);
        });
        el.querySelectorAll('[data-candidate-toggle]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                const node = nodes.find(n => n.id === id);
                const count = candidateCountForNode(node);
                if(count <= 1) return;
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                suppressComposerForCandidateNodeId = id;
                if(candidatePanelNodeId === id){
                    closeCandidatePanel();
                } else {
                    candidatePanelNodeId = id;
                    candidatePanelIndex = Math.max(0, Math.min(count - 1, Number(node?.candidateIndex) || 0));
                    candidatePanelAttentionNodeId = id;
                }
                render();
                candidatePanelAttentionNodeId = '';
            });
        });
        el.querySelectorAll('[data-candidate-panel]').forEach(panel => {
            panel.addEventListener('dblclick', e => {
                if(e.target.closest('button')) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                clearImageClickTimer();
                suppressImageClickUntil = Date.now() + 260;
                const candidateIndex = Number(panel.dataset.candidateIndex) || 0;
                selectedIds = [];
                openImagePreview(id, candidateIndex, {source:'candidates'});
            });
        });
        el.querySelectorAll('[data-candidate-prev],[data-candidate-next]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                const node = nodes.find(n => n.id === id);
                const count = candidateCountForNode(node);
                if(count <= 1) return;
                const delta = btn.dataset.candidatePrev ? -1 : 1;
                candidatePanelNodeId = id;
                candidatePanelIndex = (candidatePreviewIndexForNode(node, count) + delta + count) % count;
                suppressComposerForCandidateNodeId = id;
                render();
            });
        });
        el.querySelectorAll('[data-candidate-set-main]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                const node = nodes.find(n => n.id === id);
                const count = candidateCountForNode(node);
                if(count <= 1) return;
                pushUndo();
                candidatePanelIndex = candidatePreviewIndexForNode(node, count);
                setNodeMainCandidate(node, candidatePanelIndex);
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:'', index:-1};
                closeCandidatePanel({suppressComposer:false});
                suppressComposerForCandidateNodeId = '';
                render();
                scheduleSave();
            });
        });
        el.querySelectorAll('[data-candidate-expand]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                if(expandedCandidateNodeIds.has(id)) expandedCandidateNodeIds.delete(id);
                else expandedCandidateNodeIds.add(id);
                render();
            });
        });
        el.querySelectorAll('[data-candidate-remove]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                const node = nodes.find(n => n.id === id);
                if(!node) return;
                const removed = Number(btn.dataset.candidateRemoveIndex);
                if(!Number.isInteger(removed)) return;
                pushUndo();
                removeCandidateFromNode(node, removed);
                render();
                scheduleSave();
            });
        });
        el.querySelectorAll('[data-candidate-grid-item]').forEach(item => {
            item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            item.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                if(e.target.closest('[data-candidate-remove]')) return;
                const node = nodes.find(n => n.id === id);
                if(!node) return;
                pushUndo();
                setNodeMainCandidate(node, Number(item.dataset.candidateGridItem) || 0);
                render();
                scheduleSave();
            });
        });
        el.querySelectorAll('[data-image-task-query]').forEach(btn => {
            btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
            btn.addEventListener('click', e => {
                e.preventDefault(); e.stopPropagation();
                querySmartImageTaskNow(btn.dataset.imageTaskQuery, btn.dataset.taskId);
            });
        });
        el.querySelectorAll('.thumb-item,.image-wrap').forEach(item => {
            const refNodeId = item.dataset.refNodeId || id;
            const refIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
            const refNode = nodes.find(n => n.id === refNodeId);
            const dragPayload = canvasImageDragPayload(refNode, refIndex);
            item.setAttribute('draggable', dragPayload?.file_id ? 'true' : 'false');
            item.addEventListener('dragstart', e => {
                const latestNode = nodes.find(n => n.id === refNodeId);
                const latestPayload = canvasImageDragPayload(latestNode, refIndex);
                if(!latestPayload?.file_id){
                    e.preventDefault();
                    return;
                }
                e.stopPropagation();
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('application/x-canvas-image', JSON.stringify(latestPayload));
                e.dataTransfer.setData('text/plain', latestPayload.url || '');
            });
            const hasVideoPreview = Boolean(item.querySelector('[data-video-preview-container="1"]'));
            if(hasVideoPreview){
                item.addEventListener('mouseenter', () => {
                    activateCanvasVideoPreview(item);
                });
                item.addEventListener('mouseleave', () => {
                    deactivateCanvasVideoPreview(item);
                });
            }
            item.addEventListener('mousedown', e => {
                if(isCandidatePanelInteractionTarget(e.target)) return;
                if(e.button !== 0) return;
                if(e.detail < 2) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                clearImageClickTimer();
                suppressImageClickUntil = Date.now() + 260;
                const refNodeId = item.dataset.refNodeId || id;
                const refIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
                selectedId = id;
                selectedIds = [];
                selectedImage = {nodeId:refNodeId, index:refIndex};
                openImagePreview(refNodeId, refIndex);
            }, true);
            item.addEventListener('click', e => {
                if(isCandidatePanelInteractionTarget(e.target)) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if(Date.now() < suppressImageClickUntil) return;
                const imageIndex = Number(item.dataset.imageIndex || 0);
                const refNodeId = item.dataset.refNodeId || id;
                const refIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
                if(e.detail >= 2){
                    clearImageClickTimer();
                    suppressImageClickUntil = Date.now() + 260;
                    selectedId = id;
                    selectedIds = [];
                    selectedImage = {nodeId:refNodeId, index:refIndex};
                    openImagePreview(refNodeId, refIndex);
                    return;
                }
                clearImageClickTimer();
                imageClickTimer = setTimeout(() => {
                    imageClickTimer = null;
                const owner = nodes.find(n => n.id === id);
                hideRunTimerForNode(owner);
                const isGroupOwner = (owner?.images || []).length > 1 || isSmartGroupNode(owner);
                const isUploadOnlyOwner = isUploadedImageOnlyNode(owner);
                selectedId = id;
                selectedIds = [];
                // 分组节点：单击具体图片时选中该图片（出现按图片的快捷栏）；
                // 非分组的上传单图节点仍保持节点级（不穿透）。
                selectedImage = isGroupOwner
                    ? {nodeId:refNodeId, index:refIndex}
                    : (isUploadOnlyOwner
                        ? {nodeId:'', index:-1}
                        : {nodeId:id, index:imageIndex});
                    suppressComposerForCandidateNodeId = '';
                    if(smartCascadeAnyRunning()) smartCascadeSilentSelection = false;
                    syncSelectionUi();
                    updateComposer();
                }, 220);
            });
        item.addEventListener('dblclick', e => {
            if(isCandidatePanelInteractionTarget(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            clearImageClickTimer();
            suppressImageClickUntil = Date.now() + 260;
            const refNodeId = item.dataset.refNodeId || id;
            const refIndex = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);
            selectedId = id;
            selectedIds = [];
            selectedImage = {nodeId:refNodeId, index:refIndex};
            openImagePreview(refNodeId, refIndex);
        }, true);
        });
        el.querySelectorAll('.thumb-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                if(e.button !== 0 || e.target.closest('.mini-x')) return;
                if(e.detail >= 2) return;
                if(item.dataset.refNodeId && item.dataset.refNodeId !== id) return;
                const node = nodes.find(n => n.id === id);
                if(!node || (node.images || []).length <= 1) return;
                e.preventDefault(); e.stopPropagation();
                thumbDragState = {nodeId:id, imgIndex:Number(item.dataset.imageIndex || 0), startX:e.clientX, startY:e.clientY, detached:false};
                capturePendingUndo();
            });
        });
        const beginNodeDrag = e => {
            const isMultiSelected = selectedIds.length > 1 && selectedIds.includes(id);
            // 名称栏进入编辑态时（.node-title.editing），不触发节点拖拽，允许选择文本。
            if(e.target.closest('.node-title.editing')) return;
            // Allow starting a group drag even when the press lands on a thumb-item/video
            // (native <video controls> can swallow the click), as long as this node is
            // part of an existing multi-selection — otherwise thumb-item clicks are
            // reserved for image reordering / preview interactions.
            if(e.button !== 0 || (!isMultiSelected && e.target.closest('.mini-x, .thumb-item, .node-port, select, input, button'))) return;
            if(isMultiSelected && e.target.closest('.mini-x, .node-port, select, input, button')) return;
            if(e.target.closest('.prompt-node-pill, textarea:not(.prompt-node-text)')) return;
            e.preventDefault(); e.stopPropagation();
            window.getSelection?.()?.removeAllRanges?.();
            if(document.activeElement?.blur) document.activeElement.blur();
            let node = nodes.find(n => n.id === id);
            if(!node) return;
            if(e.altKey) node = duplicateForAltDrag(node);
            const dragIds = selectedIds.includes(node.id) ? selectedIds.slice() : [node.id];
            const group = dragIds.map(dragId => {
                const n = nodes.find(x => x.id === dragId);
                return n ? {id:n.id, ox:Number(n.x) || 0, oy:Number(n.y) || 0} : null;
            }).filter(Boolean);
            dragState = {id:node.id, startX:e.clientX, startY:e.clientY, ox:node.x || 0, oy:node.y || 0, group, groupIds:group.map(item => item.id), ctrlGroup:Boolean(e.ctrlKey)};
            document.body.classList.add('smart-node-drag');
            capturePendingUndo();
        };
        el.querySelectorAll('.node-port').forEach(port => {
            port.addEventListener('mousedown', e => {
                if(e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                const portType = port.dataset.port;
                const p = screenToWorld(e);
                portDragState = {
                    fromId:id,
                    fromPort:portType,
                    currentWorld:p,
                    hoverTargetId:'',
                    hoverPort:'',
                    moved:false
                };
                shell.classList.add('port-dragging');
                capturePendingUndo();
                ensurePortDragPathElement();
                updatePortDragVisual();
            });
            port.addEventListener('click', e => { e.stopPropagation(); });
            port.addEventListener('dblclick', e => { e.stopPropagation(); });
        });
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            openNodeContextMenu(id, e);
        });
        el.onmousedown = beginNodeDrag;
        el.ondragover = e => setSmartDropCopyEffect(e);
        el.ondrop = async e => {
            e.preventDefault();
            e.stopPropagation();
            const payload = await resolveSmartImageDropPayload(e.dataTransfer);
            if(payload.type === 'none') return;
            await handleSmartImageDropPayload(payload, id);
        };
    });
}
function rectOverlapNode(draggedId, x, y, w, h, excludeIds=[]){
    const cx = x + w/2, cy = y + h/2;
    const excluded = new Set([draggedId, ...(excludeIds || [])]);
    for(const n of nodes){
        if(excluded.has(n.id)) continue;
        const r = nodeRect(n);
        if(cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) return n;
    }
    return null;
}
function dragConnectTargetFor(sourceNode, point=lastMouseWorld){
    if(!sourceNode || (dragState?.group || []).length > 1) return null;
    if(['smart-prompt', 'smart-loop'].includes(sourceNode.type) && point){
        return rectOverlapNode(sourceNode.id, point.x - 1, point.y - 1, 2, 2, dragState?.groupIds || []);
    }
    const r = nodeRect(sourceNode);
    return rectOverlapNode(sourceNode.id, r.x, r.y, r.width, r.height, dragState?.groupIds || []);
}
function canAutoConnectDraggedNode(sourceNode, targetNode){
    if(!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;
    if(isHistoryGroupNode(sourceNode) || isHistoryGroupNode(targetNode)) return false;
    if(isSmartImageNode(sourceNode)) return isSmartImageNode(targetNode) || targetNode.type === 'smart-loop' || targetNode.type === 'smart-prompt';
    if(sourceNode.type === 'smart-prompt') return isSmartImageNode(targetNode) || targetNode.type === 'smart-loop' || targetNode.type === 'smart-prompt';
    if(sourceNode.type === 'smart-loop') return isSmartImageNode(targetNode);
    if(sourceNode.type === 'smart-group') return isSmartImageNode(targetNode) || targetNode.type === 'smart-loop';
    return false;
}
function restoreDraggedNodePosition(){
    if(!dragState) return;
    (dragState.group || [{id:dragState.id, ox:dragState.ox, oy:dragState.oy}]).forEach(item => {
        const n = nodes.find(x => x.id === item.id);
        if(n){
            n.x = item.ox;
            n.y = item.oy;
        }
    });
}

// M19 追加：window.onmousemove / window.onmouseup 全局交互状态调度中心
// + 右键拖拽取消处理。从 frontend/src/canvas/main.js 原样剪切，未改动
// 任何函数内部逻辑，只做了纯粹的位置搬移，追加到本文件（canvas-render.js）
// 末尾——它们和上面的 dragConnectTargetFor/rectOverlapNode/
// canAutoConnectDraggedNode/restoreDraggedNodePosition（M7 已迁移）
// 本来就是同一个"节点拖拽/画布交互"关注点，物理上放在一起合情合理。
//
// 背景（M7 阶段的架构判断，M18 已完成前置步骤，本次 M19 完成物理拆分）：
// M7 拆本文件时发现 `window.onmousemove`/`window.onmouseup` 是用
// `window.onxxx = e => {...}` 匿名函数表达式赋值的形式，AST 符号扫描
// 看不到，当时判断风险太高（10+ 种互斥交互状态耦合，横跨图片编辑器/
// 资产库/连线等多个模块）暂不拆分。M18 先把这两个函数改成具名函数
// 声明（不改变任何行为，纯语法转换）。M19 在此基础上完成真正的物理
// 搬移。
//
// 本次追加包含：
//   handleWindowMouseMove —— 全局 mousemove 调度中心，按互斥优先级
//     依次判断：右键平移中 / 小地图拖拽中 / 端口连线拖拽中 / 提示词
//     输入框高度拖拽中 / 框选中 / 预览对比拖拽中 / 全景图拖拽中 /
//     预览图平移中 / 图片编辑器画面平移中 / 裁剪框拖拽中 / 缩略图
//     拖拽中（含"拖出缩略图独立成节点"的特殊逻辑）/ 画布平移中 /
//     节点拖拽中（含拖入资产库面板的高亮反馈、自动连线/合并/插入
//     分组的候选目标高亮）。
//   finishCanvasRightClick / cancelCanvasRightClick —— 右键按下后
//     判断"是否发生了拖动"，没有拖动才在 pointerup 时打开右键菜单；
//     pointercancel 时取消平移状态。这两个函数被
//     `window.addEventListener('pointerup'/'pointercancel', ...)`
//     绑定（这两行 addEventListener 调用也随本次搬移一并迁移）。
//   handleWindowMouseUp —— 全局 mouseup 调度中心，按 mousemove 建立
//     的各种状态逐一收尾：结束端口连线拖拽并尝试建立连线 / 结束提示词
//     输入框拖拽并保存 / 结束框选 / 结束预览对比拖拽 / 结束全景图
//     拖拽 / 结束预览图平移 / 结束图片编辑器画面平移 / 结束裁剪框
//     拖拽 / 结束缩略图拖拽（撤销未分离的临时状态）/ 结束画布平移
//     （延迟保存）/ 结束小地图拖拽 / 结束节点拖拽（这是最复杂的
//     分支：拖到资产库面板则保存所有图片到资产库并还原节点位置；
//     否则按优先级依次尝试"插入循环节点连接"/"加入智能分组"/"自动
//     连接输入"/"合并为图片组"/"连接输入节点"，最后落地判断是否
//     真的发生了有效变更从而决定 commit 还是 discard 撤销快照）。
//
// 依赖的外部全局（刻意留在 frontend/src/canvas/main.js / main.js 里，
// 通过共享脚本作用域访问，未随本次搬移迁移，因为被 main.js 里其它
// 大量代码——尤其是各种 mousedown/pointerdown/dragstart 事件绑定——
// 同样读写，属于跨文件共享的可变交互状态，风险量级和 state.js 一致，
// 本次只搬移读写它们的函数本体，状态本身不搬）：
//   交互状态变量：dragState, loopInsertPreview, selectionState,
//     thumbDragState, panState, didPan, portDragState, smartMinimapDrag,
//     rightMouseDownPoint, rightMouseDownViewport, cropState, cropDrag,
//     previewPanDrag, previewCompareDrag, imageEditPanDrag,
//     promptResizeState（声明在文件靠后位置，但属于同一类交互状态）,
//     panoramaState, previewPan, suppressNodeClickUntil, undoSuppressed,
//     assetLibraryOpen, lastMouseWorld
//   核心选中状态：selectedId, selectedImage（本文件内会重新赋值，
//     同 M2 loop-node.js 的写法）
//   状态变量：nodes, viewport（只读/直接修改属性，未整体重新赋值）,
//     settings（读写 promptH 字段）
//   DOM 元素常量：promptInput, shell, assetPanel
//
// 反过来，本次追加的函数会调用以下仍留在 main.js 或其它已拆分模块
// 里的函数（通过共享脚本作用域，未做任何改动，函数本身物理位置不影响
// 调用方式）：
//   留在 main.js：updateCanvasRightPan, centerViewportOnWorldPoint,
//     minimapEventToWorld, updateSelectionBox, persistActiveSmartSettings,
//     applyViewport, flushDeferredViewportRendering, applyNodeMetaToImage,
//     inheritNodeMetaFromImage, commitPendingUndo, discardPendingUndo,
//     moveNodeElementsDuringDrag, updateLoopInsertPreview, setDropHighlight,
//     clearDropHighlight, setAssetDragOver, finishSelection,
//     mergeImageNodesIntoGroup, smartGroupTargetForDraggedNode,
//     addDraggedNodesToSmartGroup, scheduleSave, render, screenToWorld,
//     openCanvasContextMenu
//   connections.js（M4）：updatePortDragVisual, handlePortDrop,
//     insertionConnectionForNode, connectInputNode, refreshConnectionLayer
//   image-editor.js（M8）：setPreviewComparePos, applyPreviewTransform,
//     resizeOutpaintFromDrag, clampCrop, renderCropBox
//   node-model.js（M3）：createImageNodeAt
//   asset-library.js（M9）：addFileToAssetLibrary
//   loop-node.js（M2）：insertLoopNodeIntoConnection
//   node-layout.js（M3）：nodeRect
//   本文件（canvas-render.js，M7）：dragConnectTargetFor, rectOverlapNode,
//     canAutoConnectDraggedNode, restoreDraggedNodePosition
//
// main.js 里仍保留的部分会调用本次追加的函数（通过共享脚本作用域）：
//   各处 mousedown/pointerdown 事件绑定设置好 dragState/panState/
//   cropDrag 等初始状态之后，等待 window.onmousemove/onmouseup 接管
//   后续交互（这本身就是这套状态机的设计方式：mousedown 建立状态，
//   mousemove 更新状态，mouseup 收尾状态，三段分散在不同的事件绑定
//   点，只有后两段是本次搬移的对象）。
function handleWindowMouseMove(e){
    lastMouseWorld = screenToWorld(e);
    if(updateCanvasRightPan(e)) return;
    if(smartMinimapDrag){
        e.preventDefault();
        centerViewportOnWorldPoint(minimapEventToWorld(e));
        return;
    }
    if(portDragState){
        e.preventDefault();
        const p = screenToWorld(e);
        portDragState.currentWorld = p;
        portDragState.moved = true;
        const hitEl = document.elementFromPoint(e.clientX, e.clientY);
        const portEl = hitEl?.closest?.('.node-port');
        const nodeEl = portEl?.closest?.('.image-node') || hitEl?.closest?.('.image-node');
        let targetId = '', targetPort = '';
        if(nodeEl && nodeEl.dataset.id && nodeEl.dataset.id !== portDragState.fromId){
            targetId = nodeEl.dataset.id;
            if(portEl){
                targetPort = portEl.dataset.port;
            } else {
                const rect = nodeEl.getBoundingClientRect();
                targetPort = (e.clientX - rect.left) < rect.width / 2 ? 'in' : 'out';
            }
            const compatible = (portDragState.fromPort === 'out' && targetPort === 'in') || (portDragState.fromPort === 'in' && targetPort === 'out');
            if(!compatible){ targetId = ''; targetPort = ''; }
        }
        portDragState.hoverTargetId = targetId;
        portDragState.hoverPort = targetPort;
        updatePortDragVisual();
        return;
    }
    if(promptResizeState){
        e.preventDefault();
        const dy = e.clientY - promptResizeState.startY;
        settings.promptH = Math.max(60, Math.min(380, promptResizeState.startH + dy));
        promptInput.style.setProperty('--prompt-h', `${settings.promptH}px`);
        persistActiveSmartSettings();
        return;
    }
    if(selectionState){
        e.preventDefault();
        updateSelectionBox(e);
        return;
    }
    if(previewCompareDrag){
        e.preventDefault();
        setPreviewComparePos(e.clientX);
        return;
    }
    if(panoramaState.drag){
        e.preventDefault();
        const dx = e.clientX - panoramaState.drag.clientX;
        const dy = e.clientY - panoramaState.drag.clientY;
        panoramaState.yaw = panoramaState.drag.yaw - dx * 0.18;
        panoramaState.pitch = Math.max(-85, Math.min(85, panoramaState.drag.pitch + dy * 0.18));
        document.getElementById('previewStage')?.classList.add('panning');
        return;
    }
    if(previewPanDrag){
        const stage = document.getElementById('previewStage');
        previewPan = {
            x:previewPanDrag.startX + (e.clientX - previewPanDrag.clientX),
            y:previewPanDrag.startY + (e.clientY - previewPanDrag.clientY)
        };
        stage?.classList.add('panning');
        applyPreviewTransform();
        return;
    }
    if(imageEditPanDrag){
        const stage = document.getElementById('imageEditStage');
        if(stage){
            stage.scrollLeft = imageEditPanDrag.scrollLeft - (e.clientX - imageEditPanDrag.clientX);
            stage.scrollTop = imageEditPanDrag.scrollTop - (e.clientY - imageEditPanDrag.clientY);
        }
        return;
    }
    if(cropDrag && cropState){
        const dx = e.clientX - cropDrag.sx;
        const dy = e.clientY - cropDrag.sy;
        if(cropDrag.mode === 'move'){
            cropState.x = cropDrag.start.x + dx;
            cropState.y = cropDrag.start.y + dy;
        } else if(cropDrag.mode === 'image'){
            cropState.x = cropDrag.start.x + dx;
            cropState.y = cropDrag.start.y + dy;
        } else if(String(cropDrag.mode || '').startsWith('outpaint-')){
            resizeOutpaintFromDrag(dx, dy);
        } else {
            cropState.w = cropDrag.start.w + dx;
            cropState.h = cropDrag.start.h + dy;
        }
        clampCrop();
        renderCropBox();
        return;
    }
    if(thumbDragState){
        const dx = e.clientX - thumbDragState.startX;
        const dy = e.clientY - thumbDragState.startY;
        const source = nodes.find(n => n.id === thumbDragState.nodeId);
        if(!thumbDragState.detached && Math.abs(dx) + Math.abs(dy) > 6){
            if(source && (source.images || []).length > 1){
                const img = source.images[thumbDragState.imgIndex];
                if(img){
                    commitPendingUndo();
                    undoSuppressed = true;
                    applyNodeMetaToImage(img, source);
                    source.images.splice(thumbDragState.imgIndex, 1);
                    if(source.images.length <= 1){
                        source.title = 'Image';
                        delete source.w; delete source.h;
                        inheritNodeMetaFromImage(source);
                    }
                    const point = screenToWorld(e);
                    selectedId = '';
                    selectedImage = {nodeId:'', index:-1};
                    const newNode = createImageNodeAt(point, [img], {type:'smart-asset-image', select:false, skipUndo:true});
                    undoSuppressed = false;
                    dragState = {id:newNode.id, startX:e.clientX, startY:e.clientY, ox:newNode.x, oy:newNode.y, thumbDetached:true};
                    thumbDragState.detached = true;
                    render();
                }
            }
        }
        if(thumbDragState.detached) thumbDragState = null;
        else return;
    }
    if(panState){
        const dx = e.clientX - panState.startX;
        const dy = e.clientY - panState.startY;
        if(Math.abs(dx) + Math.abs(dy) > 3) didPan = true;
        viewport.x = panState.ox + dx;
        viewport.y = panState.oy + dy;
        applyViewport();
        return;
    }
    if(!dragState) return;
    const node = nodes.find(n => n.id === dragState.id);
    if(!node) return;
    const moveDx = (e.clientX - dragState.startX) / viewport.scale;
    const moveDy = (e.clientY - dragState.startY) / viewport.scale;
    (dragState.group || [{id:dragState.id, ox:dragState.ox, oy:dragState.oy}]).forEach(item => {
        const n = nodes.find(x => x.id === item.id);
        if(!n) return;
        n.x = item.ox + moveDx;
        n.y = item.oy + moveDy;
    });
    if(assetLibraryOpen){
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        if(hit && assetPanel?.contains(hit)){
            setAssetDragOver(true);
            clearDropHighlight();
            setAssetDragOver(true);
            return;
        }
        setAssetDragOver(false);
    }
    const draggedRect = nodeRect(node);
    const rawTarget = (dragState.ctrlGroup || ['smart-image','smart-prompt','smart-loop','smart-group'].includes(node.type))
        ? (['smart-prompt','smart-loop'].includes(node.type)
            ? dragConnectTargetFor(node, screenToWorld(e))
            : rectOverlapNode(node.id, draggedRect.x, draggedRect.y, draggedRect.width, draggedRect.height, dragState.groupIds))
        : null;
    const target = rawTarget;
    setDropHighlight(target?.id || '');
    moveNodeElementsDuringDrag();
    updateLoopInsertPreview();
    if(target) setDropHighlight(target.id);
}
window.onmousemove = handleWindowMouseMove;
function finishCanvasRightClick(e){
    if(e.button !== 2 || !rightMouseDownPoint) return;
    const moved = panState?.button === 2;
    const contextEvent = {clientX:e.clientX, clientY:e.clientY, target:e.target};
    rightMouseDownPoint = null;
    rightMouseDownViewport = null;
    if(!moved && !e.ctrlKey && !e.metaKey){
        setTimeout(() => openCanvasContextMenu(contextEvent), 0);
    }
}
function cancelCanvasRightClick(){
    rightMouseDownPoint = null;
    rightMouseDownViewport = null;
    if(panState?.button === 2){
        panState = null;
        shell.classList.remove('panning');
        flushDeferredViewportRendering();
        setTimeout(() => { didPan = false; }, 0);
    }
}
window.addEventListener('pointerup', finishCanvasRightClick, true);
window.addEventListener('pointercancel', cancelCanvasRightClick, true);
function handleWindowMouseUp(e){
    finishCanvasRightClick(e);
    document.body.classList.remove('smart-node-drag');
    if(portDragState){
        const drag = portDragState;
        portDragState = null;
        shell.classList.remove('port-dragging');
        handlePortDrop(drag, e);
        return;
    }
    if(promptResizeState){ promptResizeState = null; scheduleSave(); }
    if(selectionState) finishSelection(e);
    if(previewCompareDrag) previewCompareDrag = false;
    if(panoramaState.drag){
        panoramaState.drag = null;
        document.getElementById('previewStage')?.classList.remove('panning');
    }
    if(previewPanDrag){
        previewPanDrag = null;
        document.getElementById('previewStage')?.classList.remove('panning');
    }
    if(imageEditPanDrag) imageEditPanDrag = null;
    if(cropDrag){
        document.getElementById('cropCanvas')?.classList.remove('dragging-image');
        cropDrag = null;
    }
    if(thumbDragState){
        if(!thumbDragState.detached) discardPendingUndo();
        thumbDragState = null;
    }
    if(panState) {
        panState = null;
        shell.classList.remove('panning');
        flushDeferredViewportRendering();
        scheduleSave(900);
        setTimeout(() => { didPan = false; }, 0);
    }
    if(smartMinimapDrag){
        smartMinimapDrag = false;
        flushDeferredViewportRendering();
    }
    if(dragState){
        const draggedNode = nodes.find(n => n.id === dragState.id);
        let stateChanged = false;
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const droppedOnAssetPanel = assetLibraryOpen && hit && assetPanel?.contains(hit);
        if(droppedOnAssetPanel && draggedNode && (draggedNode.images || []).length){
            const imagesToSave = (draggedNode.images || []).filter(img => img?.file_id);
            imagesToSave.forEach(img => { void addFileToAssetLibrary(img.file_id, img.name || draggedNode.title || 'image'); });
            (dragState.group || [{id:dragState.id, ox:dragState.ox, oy:dragState.oy}]).forEach(item => {
                const n = nodes.find(x => x.id === item.id);
                if(n){ n.x = item.ox; n.y = item.oy; }
            });
            setAssetDragOver(false);
            discardPendingUndo();
            clearDropHighlight();
            dragState = null;
            document.body.classList.remove('smart-node-drag');
            render();
            scheduleSave();
            return;
        }
        const autoTarget = draggedNode ? dragConnectTargetFor(draggedNode, screenToWorld(e)) : null;
        const insertHit = draggedNode?.type === 'smart-loop' && dragState.ctrlGroup && (dragState.group || []).length <= 1
            ? insertionConnectionForNode(draggedNode)
            : null;
        const draggedNodes = (dragState.group || []).map(item => nodes.find(n => n.id === item.id)).filter(Boolean);
        const smartGroupTarget = draggedNode ? smartGroupTargetForDraggedNode(draggedNode) : null;
        if(
            insertHit &&
            insertLoopNodeIntoConnection(draggedNode, insertHit)
        ){
            stateChanged = true;
            render();
        } else if(
            smartGroupTarget &&
            addDraggedNodesToSmartGroup(draggedNodes.length ? draggedNodes : [draggedNode], smartGroupTarget)
        ){
            stateChanged = true;
            render();
        } else if(
            draggedNode &&
            autoTarget &&
            !dragState.ctrlGroup &&
            (dragState.group || []).length <= 1 &&
            canAutoConnectDraggedNode(draggedNode, autoTarget) &&
            connectInputNode(draggedNode.id, autoTarget.id)
        ){
            stateChanged = true;
            restoreDraggedNodePosition();
            if(selectedId === draggedNode.id) selectedId = '';
            render();
        } else if(draggedNode && (draggedNode.images || []).length && (dragState.ctrlGroup || (dragState.group || []).length <= 1)){
            const r = nodeRect(draggedNode);
            const target = rectOverlapNode(draggedNode.id, r.x, r.y, r.width, r.height, dragState.groupIds);
            if(target && (target.images || []).length && (dragState.ctrlGroup || (target.images || []).length > 1)){
                stateChanged = true;
                mergeImageNodesIntoGroup(draggedNode.id, target.id);
                render();
            } else if(target && !dragState.ctrlGroup && (dragState.group || []).length <= 1){
                stateChanged = true;
                connectInputNode(draggedNode.id, target.id);
                if(!dragState.thumbDetached) restoreDraggedNodePosition();
                if(selectedId === draggedNode.id) selectedId = '';
                render();
            } else if((dragState.group || []).some(item => {
                const n = nodes.find(x => x.id === item.id);
                return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);
            })){
                stateChanged = true;
            }
        } else if((dragState.group || []).some(item => {
            const n = nodes.find(x => x.id === item.id);
            return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);
        }) || (draggedNode && (Math.abs((draggedNode.x || 0) - dragState.ox) > 1 || Math.abs((draggedNode.y || 0) - dragState.oy) > 1))){
            stateChanged = true;
        }
        if(dragState.thumbDetached) stateChanged = true;
        const thumbDetached = Boolean(dragState.thumbDetached);
        if(stateChanged) commitPendingUndo();
        else discardPendingUndo();
        if(stateChanged || thumbDetached) suppressNodeClickUntil = Date.now() + 180;
        clearDropHighlight();
        loopInsertPreview = null;
        dragState = null;
        if(stateChanged || thumbDetached) scheduleSave();
        refreshConnectionLayer();
    }
}
window.onmouseup = handleWindowMouseUp;
