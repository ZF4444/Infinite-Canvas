(function(){
  let taskSync = Promise.resolve();
  const canvasId = () => new URLSearchParams(location.search).get('id') || '';
  const selectedNodeIds = () => Array.from(document.querySelectorAll('.image-node.selected[data-id]')).map(el => el.dataset.id).filter(Boolean);
  const nodeLabel = id => document.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`)?.querySelector('.node-title,.smart-node-title')?.textContent?.trim() || id;
  const nodeMentionCandidates = () => Array.from(document.querySelectorAll('.image-node[data-id]')).map(el => ({id:el.dataset.id || '', label:el.querySelector('.node-title,.smart-node-title')?.textContent?.trim() || el.dataset.id || ''})).filter(item => item.id && item.label);
  const focusNode = id => Boolean(window.focusCanvasNode?.(id));
  let referencePicking = false;
  let referencePicked = null;
  let referenceNotice = null;

  function materialReference(nodeId, requestedIndex = null) {
    const node = nodes.find(item => String(item?.id || '') === String(nodeId || ''));
    if (!node) return null;
    const imageIndex = requestedIndex == null ? (node?.images || []).findIndex(media => String(media?.url || media?.preview_url || media?.previewUrl || '').trim()) : Number(requestedIndex);
    const item = imageIndex >= 0 ? node.images[imageIndex] : null;
    if (!item) return { nodeId: String(node.id), imageIndex: -1, label: nodeLabel(node.id), src: '', previewSrc: '', kind: 'node', empty: true };
    const source = typeof thumbMediaUrl === 'function' ? thumbMediaUrl(item) : String(item.url || item.preview_url || item.previewUrl || '');
    const preview = typeof displayMediaUrl === 'function' ? displayMediaUrl(item) : source;
    if (!source) return null;
    return { nodeId: String(node.id), imageIndex, label: nodeLabel(node.id), src: source, previewSrc: preview, kind: typeof mediaKindForItem === 'function' ? mediaKindForItem(item) : 'image' };
  }

  function renderReferencePicking() {
    document.body.classList.toggle('canvas-agent-reference-picking', referencePicking);
    document.querySelectorAll('.image-node[data-id]').forEach(nodeEl => {
      nodeEl.classList.toggle('canvas-agent-reference-eligible', Boolean(referencePicking && nodes.some(item => String(item?.id || '') === String(nodeEl.dataset.id || ''))));
    });
    window.dispatchEvent(new CustomEvent('canvas-agent-reference-picking-changed', {detail: {active: referencePicking}}));
    if (!referencePicking) { referenceNotice?.remove(); referenceNotice = null; return; }
    if (!referenceNotice) {
      referenceNotice = document.createElement('div');
      referenceNotice.className = 'canvas-agent-reference-notice';
      referenceNotice.innerHTML = '<span><strong>从画布添加</strong><small>点击节点以添加为引用</small></span>';
      const exit = document.createElement('button'); exit.type = 'button'; exit.textContent = '退出';
      exit.addEventListener('click', () => endReferencePicking());
      referenceNotice.appendChild(exit); document.body.appendChild(referenceNotice);
    }
  }

  function beginReferencePicking(onPick) { referencePicking = true; referencePicked = onPick; renderReferencePicking(); }
  function endReferencePicking() { referencePicking = false; referencePicked = null; renderReferencePicking(); }
  function canvasMaterialReferences() {
    return nodes.flatMap(node => (node.images || []).map((_, index) => materialReference(node.id, index)).filter(Boolean));
  }

  document.addEventListener('click', event => {
    if (!referencePicking || event.target.closest('#canvasAgentPanel')) return;
    const nodeEl = event.target.closest('.image-node[data-id]');
    if (!nodeEl) return;
    const reference = materialReference(nodeEl.dataset.id);
    if (!reference) return;
    event.preventDefault(); event.stopImmediatePropagation();
    referencePicked?.(reference);
  }, true);
  function enqueue(work) {
    taskSync = taskSync.then(work, work);
    return taskSync;
  }
  function refreshCanvas() {
    return enqueue(async () => {
      return await window.loadCanvas?.({renderCanvas:true});
    });
  }
  window.CanvasAgentBridge = { canvasId, selectedNodeIds, nodeLabel, nodeMentionCandidates, canvasMaterialReferences, focusNode, beginReferencePicking, endReferencePicking, refreshCanvas };
})();
