/* Project the server-owned Agent event contract into small UI updates. */
(function () {
  const presentationTargets = new Set([
    'conversation_progress', 'skill_badge', 'canvas_refresh', 'system_notice',
  ]);
  const reportedUnknownTargets = new Set();
  const normalizeType = value => String(value || '').replace(/^agent\./, '');
  const payloadOf = event => event?.payload || event?.payload_json || event?.data || {};
  const reportUnknownTarget = target => {
    if (!target || presentationTargets.has(target) || reportedUnknownTargets.has(target)) return;
    reportedUnknownTargets.add(target);
    console.warn('[canvas-agent] unknown event presentation target', target);
    if (typeof fetch !== 'function') return;
    fetch('/api/canvas-agent/presentation-diagnostics', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({target}),
    }).catch(() => {});
  };
  function project(event) {
    const type = normalizeType(event?.type);
    const payload = payloadOf(event);
    const presentation = payload.presentation && typeof payload.presentation === 'object' ? payload.presentation : {};
    const declaredTargets = Array.isArray(presentation.targets) ? presentation.targets.filter(Boolean).map(String) : [];
    declaredTargets.forEach(reportUnknownTarget);
    const targets = declaredTargets.filter(target => presentationTargets.has(target));
    const subject = payload.subject && typeof payload.subject === 'object' ? payload.subject : {};
    const skill = payload.skill && typeof payload.skill === 'object' ? payload.skill : {};
    const progress = targets.includes('conversation_progress') && presentation.group_id ? {
      groupId: String(presentation.group_id),
      state: String(presentation.state || 'updated'),
      message: String(payload.message || '').trim() || '处理中',
      history: Boolean(presentation.history),
      severity: String(event?.severity || 'info'),
    } : null;
    const skillValue = subject.kind === 'skill' ? subject : skill;
    // Historical workers did not declare presentation but persisted public
    // Skill metadata. Preserve that tag-only projection without recreating
    // legacy progress text or lifecycle inference.
    const legacySkillBadge = !declaredTargets.length
      && (type === 'skill.loaded' || type === 'skill.resource_loaded');
    const skillBadge = (targets.includes('skill_badge') || legacySkillBadge) && skillValue.name ? {
      name: String(skillValue.name), version: String(skillValue.version || ''),
    } : null;
    const refreshCanvas = targets.includes('canvas_refresh') || payload.canvas_version != null ? {
      version: Number(payload.canvas_version || 0),
    } : null;
    const notice = targets.includes('system_notice') && payload.message ? {
      message: String(payload.message), severity: String(event?.severity || 'info'),
    } : null;
    return { type, payload, progress, skillBadge, refreshCanvas, notice };
  }
  function isConversationEvent(event) {
    return Boolean(project(typeof event === 'string' ? { type: event } : event).progress);
  }
  window.CanvasAgentEventProjector = { normalizeType, payloadOf, project, isConversationEvent };
})();
