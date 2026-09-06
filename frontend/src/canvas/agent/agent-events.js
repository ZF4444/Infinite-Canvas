(function(){
  const state = window.CanvasAgentState;
  const active = status => ['running','planning','applying','awaiting_confirmation'].includes(status);
  function saveRun() {
    const canvasId = window.CanvasAgentBridge.canvasId();
    localStorage.setItem(`canvas-agent-run:${canvasId}`, state.runId);
    if (!state.runId) return;
    try {
      const key = `canvas-agent-runs:${canvasId}`;
      const history = JSON.parse(localStorage.getItem(key) || '[]').filter(Boolean).filter(id => id !== state.runId);
      history.unshift(state.runId);
      localStorage.setItem(key, JSON.stringify(history.slice(0, 100)));
    } catch (_) {}
  }
  function removeRun(runId) {
    const canvasId = window.CanvasAgentBridge.canvasId();
    try {
      const key = `canvas-agent-runs:${canvasId}`;
      const history = JSON.parse(localStorage.getItem(key) || '[]').filter(id => id && id !== runId);
      localStorage.setItem(key, JSON.stringify(history));
    } catch (_) {}
    if (localStorage.getItem(`canvas-agent-run:${canvasId}`) === runId) localStorage.removeItem(`canvas-agent-run:${canvasId}`);
  }
  function applyEvent(event) {
    if (!event || Number(event.sequence) <= state.sequence) return;
    state.sequence = Number(event.sequence);
    const projector = window.CanvasAgentEventProjector;
    const type = projector?.normalizeType?.(event.type) || String(event.type || '').replace(/^agent\./, '');
    const data = projector?.payloadOf?.(event) || event.payload || event.payload_json || event.data || {};
    const projection = projector?.project?.({ ...event, type, payload: data }) || {};
    state.lastEvent = event;
    if (projection.progress) {
      window.CanvasAgentPanel.liveEvent?.({
        sequence: event.sequence,
        type,
        data,
        message: projection.progress.message,
      });
    }
    if (['operation.succeeded','operation.failed','operation.cancelled'].includes(type)) state.operationId = '';
    if (data.message) window.CanvasAgentPanel.status(data.message);
    else if (type.startsWith('operation.')) window.CanvasAgentPanel.status(type);
    else window.CanvasAgentPanel.status(type || '处理中');
    if (type === 'message.replied' && data.reply) {
      window.CanvasAgentPanel.message(data.reply, 'agent', data.media_references || []);
    }
    if (type === 'plan.created' && data.plan) { window.CanvasAgentPanel.resetConfirmationState?.(); window.CanvasAgentPlan.render({version:data.plan_version, content_json:data.plan}); }
    if (type === 'operation.failed') window.CanvasAgentPanel.confirmationFailed?.();
    if (projection.skillBadge?.name) {
      const badge = projection.skillBadge;
      const key = `${badge.name}:${badge.version || ''}`;
      if (!state.skills.some(skill => `${skill.name}:${skill.version || ''}` === key)) state.skills.push(badge);
      window.CanvasAgentPanel.renderSkills();
    }
    if (projection.refreshCanvas) window.CanvasAgentBridge.refreshCanvas?.(projection.refreshCanvas);
    if (projection.notice) window.CanvasAgentPanel.system(projection.notice.message);
    if (['run.failed','run.blocked','run.cancelled'].includes(type) && !projection.notice) {
      window.CanvasAgentPanel.system(data.error || data.reason || type);
    }
  }
  async function catchUp() {
    if (!state.runId) return;
    const data = await window.CanvasAgentClient.events(state.sequence);
    (data.events || []).forEach(applyEvent);
  }
  async function recover() {
    const saved = state.runId || localStorage.getItem(`canvas-agent-run:${window.CanvasAgentBridge.canvasId()}`);
    if (!saved) { window.CanvasAgentPanel.status('就绪 · 新对话'); return; }
    state.runId = saved;
    window.CanvasAgentPanel.status('正在恢复会话');
    try { const data = await window.CanvasAgentClient.getRun(); window.CanvasAgentPanel.renderRun(data); saveRun(); await window.CanvasAgentPanel.refreshRuns(); await catchUp(); if (active(data.run?.status)) start(); else stop(); }
    catch (error) {
      if (error.status === 404) {
        localStorage.removeItem(`canvas-agent-run:${window.CanvasAgentBridge.canvasId()}`);
        state.runId = '';
        state.sequence = 0;
        window.CanvasAgentPanel.status('就绪 · 新对话');
      } else {
        window.CanvasAgentPanel.status('连接中断，等待重连');
      }
    }
  }
  async function tick() { try { await catchUp(); const data=await window.CanvasAgentClient.getRun(); window.CanvasAgentPanel.renderRun(data); if (!active(data.run?.status) && !state.operationId) stop(); } catch (_) { window.CanvasAgentPanel.status('连接中断，等待重连'); } }
  function start() { const interval=state.operationId ? 1000 : 10000; if (state.pollTimer && state.pollInterval !== interval) { clearInterval(state.pollTimer); state.pollTimer=null; } if (!state.pollTimer) { state.pollTimer=setInterval(tick, interval); state.pollInterval=interval; } tick(); }
  function stop() { if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer=null; } state.pollInterval=0; }
  async function switchRun(runId) {
    if (!runId || runId === state.runId) return;
    stop(); state.runId = runId; state.sequence = 0; state.skills = []; saveRun();
    window.CanvasAgentPanel.clearRun();
    await recover();
  }
  window.canvasAgentHandleEvent = message => {
    const event = message?.type === 'agent.event' ? message.data : {sequence:message?.sequence,type:message?.type,data:message?.data,run_id:message?.run_id};
    if (event?.run_id === state.runId) applyEvent(event);
  };
  window.addEventListener('online', recover); document.addEventListener('visibilitychange', () => { if (!document.hidden) recover(); });
  window.CanvasAgentEvents = { applyEvent, catchUp, recover, start, stop, saveRun, removeRun, switchRun };
})();
