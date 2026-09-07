const workflowList = document.getElementById('workflowList');
const workflowCount = document.getElementById('workflowCount');
let workflowItems = [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const savedMeta = () => { try { return JSON.parse(localStorage.getItem('workflow_settings_meta') || '{}'); } catch { return {}; } };
const mediaFor = (source, id, persisted) => persisted === 'video' || persisted === 'image'
    ? persisted : (savedMeta()[`${source}:${id}`]?.media || 'image');
const coverFor = (source, id, persisted) => {
    const cover = persisted && typeof persisted === 'object' ? persisted : savedMeta()[`${source}:${id}`]?.cover;
    if(!cover || typeof cover !== 'object') return {};
    if(cover.url) return cover;
    return cover.file_id ? {...cover, url:`/api/files/${encodeURIComponent(cover.file_id)}/preview`} : {};
};

function openConfig(source='comfyui', id='', title=''){
    const query = new URLSearchParams({source});
    if(id) query.set('id', id);
    const item = workflowItems.find(value => value.source === source && String(value.id) === String(id));
    if(item?.resourceId) query.set('resourceId', item.resourceId);
    if(title) query.set('title', title);
    window.location.href = `/static/workflow-config.html?${query}`;
}
async function loadWorkflows(){
    workflowList.innerHTML = '<div class="loading-state">正在读取工作流…</div>';
    try {
        const [comfyRes, configurationRes] = await Promise.all([fetch('/api/workflows'), fetch('/api/ai/configuration')]);
        const comfy = comfyRes.ok ? await comfyRes.json() : {workflows:[]};
        const configuration = configurationRes.ok ? await configurationRes.json() : {resources:[]};
        const comfyItems = (comfy.workflows || []).map(item => ({source:'comfyui', id:item.name, title:item.title || item.name, description:'本地 ComfyUI 工作流', media:mediaFor('comfyui', item.name, item.media), cover:coverFor('comfyui', item.name, item.cover), enabled:item.enabled !== false}));
        const rhItems = (configuration.resources || []).filter(item => item.kind === 'runninghub_app' && item.settings?.app_id).map(item => ({source:'runninghub', id:item.settings.app_id, resourceId:item.id, title:item.settings?.title || item.name || `RH 应用 ${String(item.settings.app_id).slice(-6)}`, description:item.settings?.note || 'RunningHub AI 应用', media:mediaFor('runninghub', item.settings.app_id, item.settings?.media), cover:coverFor('runninghub', item.settings.app_id, item.settings?.cover), enabled:item.enabled !== false}));
        const aiComfyItems = (configuration.resources || []).filter(item => item.kind === 'comfyui_workflow').map(item => ({source:'comfyui_resource', id:item.id, resourceId:item.id, title:item.settings?.title || item.name, description:item.settings?.note || 'ComfyUI 工作流', media:mediaFor('comfyui_resource', item.id, item.settings?.media), cover:coverFor('comfyui_resource', item.id, item.settings?.cover), enabled:item.enabled !== false}));
        workflowItems = [...comfyItems, ...aiComfyItems, ...rhItems].filter(item => item.id);
        workflowCount.textContent = `${workflowItems.length} 个`;
        workflowList.innerHTML = workflowItems.map(item => { const cover = item.cover?.url ? ` style="background-image:linear-gradient(180deg,transparent 20%,rgba(5,8,14,.88)),url('${esc(item.cover.url)}')"` : ''; return `<article class="workflow-row ${item.enabled ? '' : 'is-disabled'} ${item.cover?.url ? 'has-cover' : ''}" data-source="${esc(item.source)}" data-id="${esc(item.id)}" data-resource-id="${esc(item.resourceId || '')}"${cover}><button class="workflow-row-main" type="button"><span class="workflow-row-icon ${item.source === 'comfyui_resource' ? 'comfyui' : item.source}">${item.source === 'runninghub' ? 'RH' : 'C'}</span><span class="workflow-row-copy"><strong>${esc(item.title)}</strong><small>${esc(item.description)}</small></span><span class="workflow-row-tags"><em>${item.source === 'runninghub' ? 'RH 应用' : 'ComfyUI'}</em><em>${item.media === 'video' ? '视频' : '图片'}</em></span><span class="row-arrow">›</span></button><div class="workflow-row-control"><span class="workflow-status">${item.enabled ? '已启用' : '已停用'}</span><button class="workflow-switch" type="button" role="switch" aria-checked="${item.enabled ? 'true' : 'false'}" aria-label="${esc(item.enabled ? '停用' : '启用')} ${esc(item.title)}"><span></span></button><button class="workflow-delete" type="button" title="删除工作流" aria-label="删除 ${esc(item.title)}"><i data-lucide="trash-2"></i></button></div></article>`; }).join('');
        workflowList.querySelectorAll('.workflow-row-main').forEach(row => row.addEventListener('click', () => { const item=row.closest('.workflow-row'); const data=workflowItems.find(value => value.source===item.dataset.source && String(value.id)===String(item.dataset.id)); openConfig(item.dataset.source, item.dataset.id, data?.title || ''); }));
        workflowList.querySelectorAll('.workflow-switch').forEach(toggle => toggle.addEventListener('click', async event => { event.stopPropagation(); const row=toggle.closest('.workflow-row'); const item=workflowItems.find(value => value.source===row.dataset.source && value.id===row.dataset.id); if(item) await toggleWorkflow(item, toggle); }));
        workflowList.querySelectorAll('.workflow-delete').forEach(button => button.addEventListener('click', async event => { event.stopPropagation(); const row=button.closest('.workflow-row'); const item=workflowItems.find(value => value.source===row.dataset.source && value.id===row.dataset.id && (!value.resourceId || value.resourceId===row.dataset.resourceId)); if(item) await deleteWorkflow(item, button); }));
        window.lucide?.createIcons();
    } catch { workflowList.innerHTML = '<div class="error-state">工作流读取失败，请稍后重试。</div>'; }
}
async function deleteWorkflow(item, button){
    if(!window.confirm(`确认删除“${item.title}”吗？此操作不可恢复。`)) return;
    button.disabled = true;
    try {
        if(item.source === 'comfyui'){
            const response = await fetch(`/api/workflows/${encodeURIComponent(item.id)}`, {method:'DELETE'});
            if(!response.ok){ const data=await response.json().catch(() => ({})); throw new Error(data.detail || '删除工作流失败'); }
        } else {
            const response = await fetch('/api/ai/configuration');
            const config = await response.json();
            if(!response.ok) throw new Error(config.detail || '读取资源失败');
            const resources = (config.resources || []).filter(resource => resource.id !== item.resourceId);
            const saved = await fetch('/api/ai/configuration', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...config, resources})});
            if(!saved.ok){ const data=await saved.json().catch(() => ({})); throw new Error(data.detail || '删除工作流失败'); }
        }
        const meta = savedMeta();
        delete meta[`${item.source}:${item.id}`];
        localStorage.setItem('workflow_settings_meta', JSON.stringify(meta));
        await loadWorkflows();
    } catch(error) {
        button.disabled = false;
        alert(error.message || '删除工作流失败');
    }
}
async function toggleWorkflow(item, toggle){
    const next = !item.enabled;
    toggle.disabled = true;
    try {
        if(item.source === 'comfyui'){
            const current = await fetch(`/api/workflows/${encodeURIComponent(item.id)}`).then(r => r.ok ? r.json() : Promise.reject(new Error('读取工作流失败')));
            const response = await fetch(`/api/workflows/${encodeURIComponent(item.id)}/config`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...current.config, enabled:next})});
            if(!response.ok) throw new Error('保存启用状态失败');
        } else {
            const response = await fetch('/api/ai/configuration');
            const config = await response.json();
            if(!response.ok) throw new Error(config.detail || '读取资源失败');
            const resources = (config.resources || []).map(resource => {
                return resource.id === item.resourceId ? {...resource, enabled:next} : resource;
            });
            const saved = await fetch('/api/ai/configuration',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,resources})});
            if(!saved.ok) throw new Error('保存启用状态失败');
        }
        item.enabled=next;
        await loadWorkflows();
    } catch(error) {
        toggle.disabled=false;
        alert(error.message || '保存启用状态失败');
    }
}
document.getElementById('newWorkflowBtn').addEventListener('click', () => openConfig());
document.getElementById('refreshWorkflowsBtn').addEventListener('click', loadWorkflows);
if(window.StudioTheme) window.StudioTheme.apply();
loadWorkflows();
