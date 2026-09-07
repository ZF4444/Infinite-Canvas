const query = new URLSearchParams(location.search);
const sourceSelect = document.getElementById('workflowSource');
const frame = document.getElementById('workflowConfigFrame');
const title = document.getElementById('configTitle');
const hint = document.getElementById('configHint');
const comfyUpload = document.getElementById('comfyUploadMeta');
const rhIdMeta = document.getElementById('rhUrlMeta');
const fileInput = document.getElementById('workflowUploadInput');
const rhAppId = document.getElementById('rhAppUrlInput');
const coverInput = document.getElementById('workflowCoverInput');
const coverPicker = document.getElementById('workflowCoverPicker');
const removeCoverBtn = document.getElementById('removeWorkflowCoverBtn');

let current = {
    source: ['runninghub', 'comfyui_resource'].includes(query.get('source')) ? query.get('source') : 'comfyui',
    id: query.get('id') || '',
    resourceId: query.get('resourceId') || '',
    title: query.get('title') || '',
    media: 'image',
    cover: {},
    enabled: true,
};

const metas = () => {
    try { return JSON.parse(localStorage.getItem('workflow_settings_meta') || '{}'); }
    catch { return {}; }
};
function validCover(value){
    return value && typeof value === 'object' && (value.url || value.file_id) ? value : {};
}
function coverUrl(cover=current.cover){
    if(cover?.url) return cover.url;
    return cover?.file_id ? `/api/files/${encodeURIComponent(cover.file_id)}/preview` : '';
}
function persist(){
    const all = metas();
    all[`${current.source}:${current.id}`] = {media: current.media, cover: current.cover, enabled: current.enabled};
    localStorage.setItem('workflow_settings_meta', JSON.stringify(all));
}
function setEnabled(value){
    current.enabled = value !== false;
}
function syncFrame(persistValue=false){
    frame.contentWindow?.postMessage({type:'workflow-media', media:current.media, persist:persistValue}, location.origin);
    frame.contentWindow?.postMessage({type:'workflow-cover', cover:current.cover || {}}, location.origin);
}
function renderCover(){
    const url = coverUrl();
    coverPicker.classList.toggle('has-cover', Boolean(url));
    coverPicker.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
    coverPicker.querySelector('span').textContent = url ? '更换封面' : '添加封面';
    removeCoverBtn.hidden = !url;
}
async function persistBackend(){
    if(!current.id) return;
    if(current.source === 'comfyui'){
        const res = await fetch(`/api/workflows/${encodeURIComponent(current.id)}`);
        if(!res.ok) throw Error('读取工作流配置失败');
        const data = await res.json();
        const saved = await fetch(`/api/workflows/${encodeURIComponent(current.id)}/config`, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...data.config, title:current.title || data.config?.title || '', media:current.media, cover:current.cover, enabled:current.enabled})
        });
        if(!saved.ok) throw Error('保存工作流配置失败');
        return;
    }
    const response = await fetch('/api/ai/configuration');
    const config = await response.json();
    if(!response.ok) throw Error(config.detail || '读取资源失败');
    const resources = (config.resources || []).map(resource => {
        if(resource.id !== current.resourceId) return resource;
        const existingCover = validCover(resource.settings?.cover);
        const nextCover = Object.keys(validCover(current.cover)).length ? current.cover : existingCover;
        return {...resource, enabled:current.enabled, settings:{...(resource.settings || {}), title:current.title || resource.name, media:current.media, cover:nextCover}};
    });
    const saved = await fetch('/api/ai/configuration', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...config, resources})});
    if(!saved.ok) throw Error('保存工作流配置失败');
}
async function saveEmbeddedConfig(){
    if(!current.id) return;
    if(current.source === 'runninghub') frame.contentWindow?.setRhWorkflowMedia?.(current.media);
    else syncFrame(false);
    const save = current.source === 'comfyui' ? frame.contentWindow?.onSave : frame.contentWindow?.saveRhWorkflowEditor;
    if(typeof save !== 'function') throw Error('配置页尚未加载完成');
    const saved = await save();
    if(saved === false) throw Error('保存工作流配置失败');
}
function setMedia(value){
    current.media = value === 'video' ? 'video' : 'image';
    document.querySelectorAll('[data-media]').forEach(button => button.classList.toggle('active', button.dataset.media === current.media));
    if(current.id){ persist(); syncFrame(); }
}
function load(){
    sourceSelect.value = current.source;
    comfyUpload.hidden = current.source !== 'comfyui';
    rhIdMeta.hidden = current.source !== 'runninghub';
    title.textContent = current.title || current.id || '新建工作流';
    hint.textContent = current.source === 'runninghub' ? '输入 RH应用ID 后打开并配置参数和封面。' : '配置节点字段和封面，保存后即可在画布中使用。';
    rhAppId.value = current.source === 'runninghub' ? current.id : '';
    renderCover();
    const suffix = current.source === 'runninghub'
        ? (current.id ? `?embedded=1&appId=${encodeURIComponent(current.id)}&resourceId=${encodeURIComponent(current.resourceId || '')}&title=${encodeURIComponent(current.title || '')}` : '?embedded=1')
        : `?embedded=1&workflow=${encodeURIComponent(current.id)}`;
    frame.src = `/static/${current.source === 'runninghub' ? 'rh-workflow-settings.html' : 'comfyui-settings.html'}${suffix}`;
}
async function uploadCover(file){
    if(!file) return;
    if(!file.type.startsWith('image/')) throw Error('请上传静态图片或 GIF 动图');
    coverPicker.classList.add('is-uploading');
    try {
        const body = new FormData();
        body.append('files', file);
        const response = await fetch('/api/local-assets/upload', {method:'POST', body});
        const payload = await response.json().catch(() => ({}));
        if(!response.ok || !payload.files?.[0]) throw Error(payload.detail || '封面上传失败');
        const item = payload.files[0];
        current.cover = {url:item.url || '', file_id:item.file_id || '', kind:'image', name:item.name || file.name};
        renderCover();
        persist();
        hint.textContent = '封面已更新，点击保存设置后发布。';
    } finally {
        coverPicker.classList.remove('is-uploading');
        coverInput.value = '';
    }
}

sourceSelect.onchange = () => { current = {source:sourceSelect.value, id:'', resourceId:'', title:'', media:'image', cover:{}, enabled:true}; setEnabled(true); load(); };
document.querySelectorAll('[data-media]').forEach(button => button.onclick = () => setMedia(button.dataset.media));
document.getElementById('backToListBtn').onclick = () => location.href = '/static/workflow-settings.html';
document.getElementById('saveMetaBtn').onclick = async () => {
    persist();
    try { await saveEmbeddedConfig(); await persistBackend(); hint.textContent = '设置已保存'; }
    catch(error) { hint.textContent = error.message || '保存失败，请重试'; }
};
frame.addEventListener('load', () => syncFrame());
document.getElementById('openRhUrlBtn').onclick = () => {
    const appId = rhAppId.value.trim();
    if(!/^[\w-]{6,}$/.test(appId)) return alert('请输入有效的 RH应用ID');
    current = {source:'runninghub', id:appId, resourceId:`legacy:runninghub:runninghub_app:${encodeURIComponent(appId)}`, title:'', media:current.media, cover:current.cover, enabled:true};
    setEnabled(true); persist(); load();
};
fileInput.onchange = async event => {
    const file = event.target.files?.[0];
    if(!file) return;
    try {
        const workflow = JSON.parse(await file.text());
        const name = file.name.replace(/\.json$/i, '') || 'workflow';
        const res = await fetch('/api/workflows', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, workflow})});
        const data = await res.json();
        if(!res.ok) throw Error(data.detail || '工作流上传失败');
        current = {source:'comfyui', id:data.name || `${name}.json`, resourceId:'', title:'', media:current.media, cover:current.cover, enabled:true};
        setEnabled(true); persist(); load(); hint.textContent = '工作流已上传，请继续配置节点字段和封面。';
    } catch(error) { alert(error.message); }
    event.target.value = '';
};
coverInput.onchange = async event => {
    try { await uploadCover(event.target.files?.[0]); }
    catch(error) { hint.textContent = error.message || '封面上传失败'; }
};
removeCoverBtn.onclick = () => { current.cover = {}; renderCover(); persist(); hint.textContent = '封面已移除，点击保存设置后发布。'; };

window.addEventListener('message', event => {
    if(event.data?.type !== 'workflow-title') return;
    current.title = String(event.data.title || '');
    title.textContent = current.title || current.id || '工作流';
});

(async () => {
    try {
        if(!current.id) return;
        if(current.source === 'comfyui'){
            const data = await fetch(`/api/workflows/${encodeURIComponent(current.id)}`).then(response => response.json());
            current.title = data.config?.title || current.title;
            setMedia(data.config?.media);
            current.cover = validCover(data.config?.cover);
            setEnabled(data.config?.enabled !== false);
        } else {
            const data = await fetch('/api/ai/configuration').then(response => response.json());
            const app = (data.resources || []).find(item => item.kind === 'runninghub_app' && item.id === current.resourceId);
            setMedia(app?.settings?.media);
            current.cover = validCover(app?.settings?.cover);
            if(!Object.keys(current.cover).length) current.cover = validCover(metas()[`${current.source}:${current.id}`]?.cover);
            setEnabled(app?.enabled !== false);
        }
    } catch {
        const stored = metas()[`${current.source}:${current.id}`] || {};
        setMedia(stored.media || 'image');
        current.cover = validCover(stored.cover);
        setEnabled(stored.enabled !== false);
    } finally { load(); }
})();
