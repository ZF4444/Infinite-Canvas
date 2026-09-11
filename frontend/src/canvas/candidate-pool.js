// 从 frontend/src/canvas/main.js 剪切出的候选素材池逻辑（M12 拆分批次）。
// 剪切时未改动任何函数签名/内部逻辑，只做了纯粹的位置搬移。
//
// 为什么这里不用 ES module 的 export/import（跟 M1-M11 同一个原因）：
// canvas.js 依赖经典 <script> 的全局作用域语义，
// static/canvas.html 里 57 处内联 onclick="xxx()" 都依赖这一点。
// 所以这里同样只做"物理文件拆分"：candidate-pool.js 保持经典脚本语法，通过
// <script src="candidate-pool.js"> 排在 media-display.js 之后、
// canvas-render.js 之前加载。
//
// 本文件覆盖"候选素材池"功能的全部逻辑（原文件 867-1126 行区间，约260行）
// ——生成节点一次返回多条媒体结果时，用户可以在候选池里切换/
// 展开查看/设为主素材：
//   1. 候选素材的归一化/合并：normalizeGeneratedCandidateImage /
//      candidateImageKey / candidateImageHasRunMeta /
//      generatedImageWithRunMeta / imageRunMetaForNodeFallback /
//      generatedImageWithNodeFallback / applyRunMetaFromImageToNode /
//      mergeCandidateImages
//   2. 候选池读取与写入：nodeCandidateImages / shouldUseCandidatePoolForImages /
//      isMaskImageItem / migrateGeneratedImagesToCandidatePool /
//      candidateCountForNode / setNodeMainCandidate /
//      syncCandidateImageDimensions / addGeneratedCandidatesToNode
//   3. 候选池面板 UI 状态与交互目标判定：isCandidatePanelInteractionTarget /
//      isExpandedCandidateGridInteractionTarget / closeExpandedCandidateGrids /
//      closeCandidatePanel / candidatePreviewIndexForNode /
//      candidateControlHtml
//   4. 候选池面板/展开网格的 HTML 渲染：candidateOverlayHtml /
//      expandedCandidateGridHtml
//
// 明确排除、留在 main.js 的内容：
//   - isSmartAssetImageNode / isUploadedImageOnlyNode：物理上紧邻本文件
//     开头，名字听起来跟候选池相关（isUploadedImageOnlyNode 被
//     shouldUseCandidatePoolForImages 调用），但实际是通用的节点类型
//     判定函数，被 composer（M7 canvas-render.js 的 updateComposer）、
//     cascade-run.js（isSmartAssetImageNode）等多处广泛调用，不是候选池
//     专属逻辑，本次不动。
//   - createGenerationNodeByKind（物理上紧邻本文件更前面）：耦合到
//     composer UI 的节点创建逻辑，M3 阶段已确认留在 main.js，同一判断
//     原则继续适用。

function normalizeGeneratedCandidateImage(img){
    if(!img?.url) return null;
    const kind = img.kind || mediaKindForItem(img) || 'image';
    const clean = {...img, generatedResult:true, kind};
    delete clean.runInputRefs;
    return clean;
}
function candidateImageKey(img){
    return String(img?.url || '');
}
function promptDraftHtmlFromRunMeta(meta){
    if(!meta || meta.promptHtml == null) return '';
    const htmlHasToken = String(meta.promptHtml || '').includes('mention-image-token');
    if(htmlHasToken) return meta.promptHtml;
    const ownPrompt = meta.promptText ?? meta.promptDraftText ?? meta.runPrompt ?? '';
    return promptHtmlWithMentionTokens(ownPrompt, meta.promptRefs || meta.runPromptRefs || []) || meta.promptHtml;
}
function generatedImageWithRunMeta(img, meta){
    if(!img?.url || !meta) return img;
    const out = {...img, generatedResult:true};
    const settingsSource = meta.settings || meta.runSettings || null;
    out.runPrompt = meta.promptText ?? meta.promptDraftText ?? meta.runPrompt ?? '';
    out.runModelPrompt = meta.prompt || meta.runModelPrompt || '';
    out.runPromptRefs = (meta.promptRefs || meta.runPromptRefs || []).map(ref => ({...ref}));
    delete out.runInputRefs;
    if(settingsSource && Object.keys(settingsSource).length) out.runSettings = settingsForStorage(settingsSource);
    if(meta.sourceNodeId) out.sourceNodeId = meta.sourceNodeId;
    out.runAt = meta.createdAt || meta.runAt || Date.now();
    if(meta.promptDraftHtml !== undefined){
        out.promptDraftHtml = meta.promptDraftHtml;
        out.promptDraftText = meta.promptDraftText || '';
    } else if(meta.promptHtml != null){
        out.promptDraftHtml = promptDraftHtmlFromRunMeta(meta);
        out.promptDraftText = meta.promptText || '';
    }
    return out;
}
function imageRunMetaForNodeFallback(node){
    if(!node) return null;
    if(!node.runPrompt && !node.runModelPrompt && !node.runSettings && !node.sourceNodeId && !node.runAt && !node.promptDraftHtml) return null;
    return {
        runPrompt:node.runPrompt || '',
        runModelPrompt:node.runModelPrompt || '',
        runPromptRefs:(node.runPromptRefs || []).map(ref => ({...ref})),
        runSettings:node.runSettings ? cloneSmartSettings(node.runSettings) : undefined,
        sourceNodeId:node.sourceNodeId || '',
        runAt:node.runAt || '',
        promptDraftHtml:node.promptDraftHtml,
        promptDraftText:node.promptDraftText
    };
}
function candidateImageHasRunMeta(img){
    return Boolean(img?.runPrompt || img?.runModelPrompt || img?.runSettings || img?.sourceNodeId || img?.runAt || img?.promptDraftHtml);
}
function generatedImageWithNodeFallback(img, node){
    if(!img?.url || candidateImageHasRunMeta(img)) return img;
    return generatedImageWithRunMeta(img, imageRunMetaForNodeFallback(node));
}
function applyRunMetaFromImageToNode(node, image){
    if(!node || !image) return false;
    const fallback = imageRunMetaForNodeFallback(node);
    const meta = {
        runPrompt:image.runPrompt,
        runModelPrompt:image.runModelPrompt,
        runPromptRefs:image.runPromptRefs,
        runSettings:image.runSettings,
        sourceNodeId:image.sourceNodeId,
        runAt:image.runAt,
        promptDraftHtml:image.promptDraftHtml,
        promptDraftText:image.promptDraftText
    };
    const hasImageMeta = Boolean(meta.runPrompt || meta.runModelPrompt || meta.runSettings || meta.sourceNodeId || meta.runAt || meta.promptDraftHtml);
    const source = hasImageMeta ? meta : fallback;
    if(!source) return false;
    node.runPrompt = source.runPrompt || '';
    node.runModelPrompt = source.runModelPrompt || '';
    node.runPromptRefs = (source.runPromptRefs || []).map(ref => ({...ref}));
    delete node.runInputRefs;
    if(source.runSettings) node.runSettings = settingsForStorage(source.runSettings);
    else delete node.runSettings;
    if(source.sourceNodeId) node.sourceNodeId = source.sourceNodeId;
    else delete node.sourceNodeId;
    if(source.runAt) node.runAt = source.runAt;
    else delete node.runAt;
    if(source.promptDraftHtml !== undefined) node.promptDraftHtml = source.promptDraftHtml;
    else delete node.promptDraftHtml;
    if(source.promptDraftText !== undefined) node.promptDraftText = source.promptDraftText;
    else delete node.promptDraftText;
    return true;
}
function mergeCandidateImages(...groups){
    const out = [];
    const seen = new Map();
    groups.flat().forEach(img => {
        const clean = normalizeGeneratedCandidateImage(img);
        const key = candidateImageKey(clean);
        if(!key) return;
        if(seen.has(key)){
            const index = seen.get(key);
            if(!candidateImageHasRunMeta(out[index]) && candidateImageHasRunMeta(clean)) out[index] = {...out[index], ...clean};
            return;
        }
        seen.set(key, out.length);
        out.push(clean);
    });
    return out;
}
function nodeCandidateImages(node){
    if(!isSmartImageNode(node)) return [];
    const explicit = Array.isArray(node.candidateImages) ? node.candidateImages : [];
    const displayed = (node.images || []).filter(img => img?.url && img?.generatedResult).map(img => generatedImageWithNodeFallback(img, node));
    return mergeCandidateImages(explicit, displayed);
}
function shouldUseCandidatePoolForImages(node, images=node?.images || []){
    if(!isSmartImageNode(node) || isHistoryGroupNode(node)) return false;
    const valid = (images || []).filter(img => img?.url && !isMaskImageItem(img));
    if(valid.length <= 1) return false;
    return valid.some(img => img.generatedResult || img.runPrompt || img.runModelPrompt || img.runSettings || img.sourceNodeId || img.runAt || node.runPrompt || node.runModelPrompt || node.sourceNodeId || node.runAt);
}
function isMaskImageItem(img){
    return Boolean(img && (String(img.role || '').toLowerCase() === 'mask' || /_mask\.png$/i.test(String(img.name || ''))));
}
function migrateGeneratedImagesToCandidatePool(node, options={}){
    if(!shouldUseCandidatePoolForImages(node)) return false;
    // 遮罩图不进候选池：它是配套的输入素材，需随主图保留在 node.images 里传给下游生成。
    const generatedImages = (node.images || []).filter(img => img?.url && !isMaskImageItem(img)).map(img => generatedImageWithNodeFallback(img, node));
    node.candidateImages = mergeCandidateImages(node.candidateImages || [], generatedImages);
    const index = options.mainIndex ?? node.candidateIndex ?? 0;
    return setNodeMainCandidate(node, index);
}
function candidateCountForNode(node){
    return nodeCandidateImages(node).length;
}
function isCandidatePanelInteractionTarget(target){
    return Boolean(target?.closest?.('[data-candidate-toggle],[data-candidate-expand],[data-candidate-prev],[data-candidate-next],[data-candidate-set-main],[data-candidate-remove],[data-candidate-grid-item],.candidate-panel,.candidate-toggle,.candidate-grid'));
}
function isExpandedCandidateGridInteractionTarget(target){
    const grid = target?.closest?.('[data-candidate-grid]');
    if(grid && expandedCandidateNodeIds.has(grid.dataset.candidateGrid)) return true;
    const toggle = target?.closest?.('[data-candidate-expand]');
    return Boolean(toggle && expandedCandidateNodeIds.has(toggle.dataset.candidateExpand));
}
function closeExpandedCandidateGrids(){
    if(!expandedCandidateNodeIds.size) return false;
    expandedCandidateNodeIds.clear();
    return true;
}
function closeCandidatePanel(options={}){
    if(!candidatePanelNodeId) return false;
    const closingId = candidatePanelNodeId;
    candidatePanelNodeId = '';
    candidatePanelIndex = 0;
    candidatePanelAttentionNodeId = '';
    if(options.suppressComposer !== false && selectedId === closingId) suppressComposerForCandidateNodeId = closingId;
    return true;
}
function setNodeMainCandidate(node, index=0){
    const pool = nodeCandidateImages(node);
    if(!node || !pool.length) return false;
    const safeIndex = Math.max(0, Math.min(pool.length - 1, Number(index) || 0));
    // 保留已有的遮罩图，重建 node.images 时把它们跟在主图后面，避免被候选池覆盖丢失。
    const masks = (node.images || []).filter(img => img?.url && isMaskImageItem(img));
    node.candidateImages = pool;
    node.candidateIndex = safeIndex;
    node.images = [{...pool[safeIndex], generatedResult:true}, ...masks];
    applyRunMetaFromImageToNode(node, node.images[0]);
    node.outputKind = mediaKindForItem(node.images[0]);
    node.scale = mediaNodeDefaultScale(node);
    delete node.w;
    delete node.h;
    return true;
}
function removeCandidateFromNode(node, index){
    if(!node) return null;
    const pool = nodeCandidateImages(node);
    const removeIndex = Number(index);
    if(!Number.isInteger(removeIndex) || removeIndex < 0 || removeIndex >= pool.length) return null;
    const removed = pool[removeIndex];
    const currentIndex = Math.max(0, Math.min(pool.length - 1, Number(node.candidateIndex) || 0));
    const nextPool = pool.filter((_, i) => i !== removeIndex);
    node.candidateImages = nextPool;
    if(!nextPool.length){
        // 遮罩是配套输入，不属于候选池，删除最后一个候选时仍需保留它。
        node.images = (node.images || []).filter(img => img?.url && isMaskImageItem(img));
        node.candidateIndex = 0;
        return removed;
    }
    const nextIndex = currentIndex === removeIndex
        ? Math.min(removeIndex, nextPool.length - 1)
        : currentIndex > removeIndex ? currentIndex - 1 : currentIndex;
    if(currentIndex === removeIndex){
        // Remove the displayed copy first so nodeCandidateImages cannot merge
        // the deleted main candidate back into the pool.
        node.images = (node.images || []).filter(img => img?.url && isMaskImageItem(img));
    }
    setNodeMainCandidate(node, nextIndex);
    return removed;
}
function syncCandidateImageDimensions(node, image, w, h){
    if(!node || !image?.url || !(w > 0 && h > 0)) return false;
    const key = candidateImageKey(image);
    let changed = false;
    const apply = item => {
        if(!item || candidateImageKey(item) !== key) return;
        // Candidate entries and the displayed main image are separate copies.
        // The browser's decoded dimensions are authoritative, including when
        // persisted metadata came from a different candidate in the same run.
        if(Number(item.natural_w || 0) !== w){
            item.natural_w = w;
            changed = true;
        }
        if(Number(item.natural_h || 0) !== h){
            item.natural_h = h;
            changed = true;
        }
    };
    (node.candidateImages || []).forEach(apply);
    (node.images || []).forEach(apply);
    return changed;
}
function addGeneratedCandidatesToNode(node, additions=[], options={}){
    if(!node) return [];
    const existingPool = nodeCandidateImages(node);
    const existingDisplayed = (node.images || []).filter(img => img?.url && img?.generatedResult).map(img => generatedImageWithNodeFallback(img, node));
    const nextAdditions = (additions || []).map(img => generatedImageWithNodeFallback(img, node)).map(normalizeGeneratedCandidateImage).filter(Boolean);
    const pool = mergeCandidateImages(existingPool, existingDisplayed, nextAdditions);
    node.candidateImages = pool;
    if(!pool.length){
        node.images = [];
        node.candidateIndex = 0;
        return [];
    }
    let mainIndex = Number.isFinite(Number(node.candidateIndex)) ? Number(node.candidateIndex) : 0;
    if(options.main === 'firstNew' && nextAdditions.length){
        const firstNewKey = candidateImageKey(nextAdditions[0]);
        const found = pool.findIndex(img => candidateImageKey(img) === firstNewKey);
        if(found >= 0) mainIndex = found;
    } else if(options.main === 'lastNew' && nextAdditions.length){
        const lastNewKey = candidateImageKey(nextAdditions[nextAdditions.length - 1]);
        const found = pool.findIndex(img => candidateImageKey(img) === lastNewKey);
        if(found >= 0) mainIndex = found;
    } else if(!node.images?.length && nextAdditions.length){
        const firstNewKey = candidateImageKey(nextAdditions[0]);
        const found = pool.findIndex(img => candidateImageKey(img) === firstNewKey);
        if(found >= 0) mainIndex = found;
    }
    setNodeMainCandidate(node, mainIndex);
    return nextAdditions;
}
function candidateControlHtml(node){
    const count = candidateCountForNode(node);
    if(count <= 1 || isHistoryGroupNode(node) || node.pending || node.queued) return '';
    const open = candidatePanelNodeId === node.id;
    const expanded = expandedCandidateNodeIds.has(node.id);
    return `<button class="candidate-expand ${expanded ? 'open' : ''}" type="button" data-candidate-expand="${escapeAttr(node.id)}" title="展开全部候选素材"><i data-lucide="${expanded ? 'grid-2x2-x' : 'grid-2x2'}"></i></button><button class="candidate-toggle ${open ? 'open' : ''}" type="button" data-candidate-toggle="${escapeAttr(node.id)}" title="候选素材"><span class="candidate-count">${count}</span><i data-lucide="chevron-down"></i></button>`;
}
function candidatePreviewIndexForNode(node, count){
    if(candidatePanelNodeId !== node?.id) return Math.max(0, Math.min(count - 1, Number(node?.candidateIndex) || 0));
    return Math.max(0, Math.min(count - 1, Number(candidatePanelIndex) || 0));
}
function candidateOverlayHtml(node, layout){
    const pool = nodeCandidateImages(node);
    if(candidatePanelNodeId !== node.id || pool.length <= 1) return '';
    const index = candidatePreviewIndexForNode(node, pool.length);
    const preview = imageForDisplay(pool[index]);
    if(!preview?.url) return '';
    const current = Math.max(0, Math.min(pool.length - 1, Number(node.candidateIndex) || 0));
    const indexText = `${index + 1} / ${pool.length}`;
    const dots = pool.map((_, i) => `<span class="candidate-dot ${i === index ? 'active' : ''}"></span>`).join('');
    const attentionClass = candidatePanelAttentionNodeId === node.id ? ' candidate-panel-attention' : '';
    return `<div class="candidate-panel${attentionClass}" data-candidate-panel="${escapeAttr(node.id)}" data-candidate-index="${index}" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">
        ${singleMediaHtml(preview, layout.width, layout.height)}
        ${imageResolutionBadgeHtml(preview)}
        <button class="candidate-nav candidate-prev" type="button" data-candidate-prev="${escapeAttr(node.id)}" title="上一张"><i data-lucide="chevron-left"></i></button>
        <button class="candidate-nav candidate-next" type="button" data-candidate-next="${escapeAttr(node.id)}" title="下一张"><i data-lucide="chevron-right"></i></button>
        <button class="candidate-main-btn" type="button" data-candidate-set-main="${escapeAttr(node.id)}" ${index === current ? 'disabled' : ''}>设为主素材</button>
        <div class="candidate-index">${escapeHtml(indexText)}</div>
        <div class="candidate-dots">${dots}</div>
    </div>`;
}
function expandedCandidateGridHtml(node){
    if(!expandedCandidateNodeIds.has(node.id)) return '';
    const pool = nodeCandidateImages(node);
    if(pool.length <= 1) return '';
    const current = Math.max(0, Math.min(pool.length - 1, Number(node.candidateIndex) || 0));
    return `<div class="candidate-grid" data-candidate-grid="${escapeAttr(node.id)}">${pool.map((img, i) => `<div class="candidate-grid-item ${i === current ? 'is-main' : ''}" data-candidate-grid-item="${i}">${thumbMediaHtml(img)}<button class="candidate-grid-remove" type="button" data-candidate-remove="${escapeAttr(node.id)}" data-candidate-remove-index="${i}" title="从候选池移除" aria-label="从候选池移除"><i data-lucide="trash-2"></i></button><span class="candidate-grid-idx">${i + 1}</span></div>`).join('')}</div>`;
}
