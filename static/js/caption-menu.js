/**
 * 图像反推系统 - 右键菜单（多面板式，每级向右展开独立面板）
 */
(function(){
'use strict';

const CAPTION_RULES_KEY = 'caption_rules_v1';
const CAPTION_SETTINGS_KEY = 'caption_settings_v1';

const DEFAULT_RULES = [
    {id:'rule_detail_zh', name:'像素级描述', category:'', content:'请逐区域（前景、中景、背景）精细描述这张图片的所有视觉元素，包括构图、颜色、光影、材质、人物动作表情和环境氛围。输出纯文本描述。'},
    {id:'rule_tag_zh', name:'Tag 风格', category:'', content:'请用逗号分隔的英文标签描述这张图片，包括画面风格、构图、主体、颜色、光线、环境、情绪等要素。示例格式：1girl, long hair, sunset, warm lighting, field, soft focus'},
    {id:'rule_short_zh', name:'简洁描述', category:'', content:'用一段简洁的文字描述这张图片的主要内容和风格，适合用作文生图提示词。50字以内。'},
    {id:'rule_edit_zh', name:'图像编辑指令', category:'编辑类', content:'分析这张图片的内容，然后生成一条适合用于图像编辑模型的英文编辑指令。格式："Make it ..."'},
    {id:'rule_video_zh', name:'图生视频提示词', category:'视频类', content:'描述这张图片的画面内容，并以动态镜头语言补充合理的运动趋势，生成适合用于图生视频的英文提示词。'}
];

function loadRules(){ try { const d=JSON.parse(localStorage.getItem(CAPTION_RULES_KEY)); return Array.isArray(d)&&d.length?d:[...DEFAULT_RULES]; } catch(_){ return [...DEFAULT_RULES]; } }
function saveRules(r){ localStorage.setItem(CAPTION_RULES_KEY, JSON.stringify(r)); }
function loadSettings(){ try { return JSON.parse(localStorage.getItem(CAPTION_SETTINGS_KEY)||'{}'); } catch(_){ return {}; } }
function saveSettings(s){ localStorage.setItem(CAPTION_SETTINGS_KEY, JSON.stringify(s)); }

let captionRules = loadRules();
let captionCfg = loadSettings();

function esc(s){ return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function uid(){ return 'rule_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

// ========== 多面板菜单 ==========
let container = null; // 包裹所有面板的容器
let panels = [];      // 当前显示的面板列表
let menuCtx = null;
let outsideHandler = null;

function closeMenu(){
    if(container){ container.remove(); container=null; }
    panels=[];
    if(outsideHandler){ document.removeEventListener('mousedown',outsideHandler); outsideHandler=null; }
    menuCtx=null;
}
function onOutside(e){ if(!e.target.closest('.caption-menu-container')) closeMenu(); }

function openCaptionMenu(e, ctx){
    e.preventDefault(); e.stopPropagation();
    closeMenu();
    menuCtx = ctx;
    container = document.createElement('div');
    container.className = 'caption-menu-container';
    container.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;display:flex;align-items:flex-start;gap:4px`;
    document.body.appendChild(container);
    showRootPanel();
    requestAnimationFrame(()=>{
        const rect = container.getBoundingClientRect();
        if(rect.right > window.innerWidth-8) container.style.left = Math.max(8,window.innerWidth-rect.width-8)+'px';
        if(rect.bottom > window.innerHeight-8) container.style.top = Math.max(8,window.innerHeight-rect.height-8)+'px';
    });
    setTimeout(()=>{ outsideHandler=onOutside; document.addEventListener('mousedown',outsideHandler); },0);
}

function createPanel(html, level){
    // 移除当前 level 及之后的所有面板
    while(panels.length > level){
        const old = panels.pop();
        old.el.remove();
    }
    const panel = document.createElement('div');
    panel.className = 'caption-ctx-panel';
    panel.innerHTML = html;
    container.appendChild(panel);
    panels.push({el:panel, level});
    // 重新检查位置
    requestAnimationFrame(()=>{
        const rect = container.getBoundingClientRect();
        if(rect.right > window.innerWidth-8) container.style.left = Math.max(8,window.innerWidth-rect.width-8)+'px';
    });
    return panel;
}

// --- Level 0: 根菜单 ---
function showRootPanel(){
    const rules = captionRules;
    const activeId = captionCfg.activeRuleId || rules[0]?.id || '';
    let html = '';
    rules.forEach(r => {
        html += `<button class="ctx-item ${r.id===activeId?'active':''}" data-pick-rule="${esc(r.id)}"><span class="ctx-dot ${r.id===activeId?'on':''}"></span>${esc(r.name)}</button>`;
    });
    html += `<div class="ctx-sep"></div>`;
    html += `<button class="ctx-item" data-open-manage><span class="ctx-icon">✏️</span>${esc(menuCtx.tr('caption.ruleManage'))}</button>`;
    html += `<button class="ctx-item ctx-service-trigger" data-open-services><span class="ctx-icon">✦</span>${esc(menuCtx.tr('caption.selectService'))}<span class="ctx-arrow">></span></button>`;
    const panel = createPanel(html, 0);
    panel.addEventListener('click', ev=>{
        const ruleBtn = ev.target.closest('[data-pick-rule]');
        if(ruleBtn){
            captionCfg.activeRuleId = ruleBtn.dataset.pickRule;
            saveSettings(captionCfg);
            closeMenu();
            menuCtx?.toast(menuCtx.tr('caption.ruleSwitched'));
            return;
        }
        if(ev.target.closest('[data-open-manage]')){
            closeMenu();
            openRuleManager(menuCtx);
            return;
        }
        if(ev.target.closest('[data-open-services]')){
            showServicesPanel();
        }
    });
}

// --- Level 1: 服务商列表 ---
function showServicesPanel(){
    const providers = menuCtx.providers();
    const currentProvider = menuCtx.resolveProvider(captionCfg.provider||'');
    let html = '';
    providers.forEach(p => {
        const cur = p.id===currentProvider;
        html += `<button class="ctx-item ${cur?'active':''}" data-open-models="${esc(p.id)}"><span class="ctx-dot ${cur?'on':''}"></span>${esc(p.name||p.id)}<span class="ctx-arrow">></span></button>`;
    });
    const panel = createPanel(html, 1);
    panel.addEventListener('click', ev=>{
        const btn = ev.target.closest('[data-open-models]');
        if(btn) showModelsPanel(btn.dataset.openModels);
    });
}

// --- Level 2: 模型列表 ---
function showModelsPanel(providerId){
    const models = menuCtx.getModels(providerId);
    const currentProvider = menuCtx.resolveProvider(captionCfg.provider||'');
    const currentModel = menuCtx.resolveModel(captionCfg.model||'', currentProvider);
    let html = '';
    models.forEach(m => {
        const cur = providerId===currentProvider && m===currentModel;
        const label = menuCtx.modelDisplayName ? menuCtx.modelDisplayName(m, providerId) : m;
        html += `<button class="ctx-item ${cur?'active':''}" data-pick-model="${esc(m)}" data-provider="${esc(providerId)}"><span class="ctx-dot ${cur?'on':''}"></span>${esc(label)}</button>`;
    });
    const panel = createPanel(html, 2);
    panel.addEventListener('click', ev=>{
        const btn = ev.target.closest('[data-pick-model]');
        if(btn){
            captionCfg.provider = btn.dataset.provider;
            captionCfg.model = btn.dataset.pickModel;
            saveSettings(captionCfg);
            closeMenu();
            menuCtx?.toast(menuCtx.tr('caption.modelSwitched'));
        }
    });
}

// ========== 规则管理弹窗（表格式，参考 ComfyUI-Prompt-Assistant） ==========
function openRuleManager(ctx){
    document.getElementById('captionRuleManagerModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'captionRuleManagerModal';
    modal.className = 'caption-rule-modal-overlay';
    document.body.appendChild(modal);
    const activeId = () => captionCfg.activeRuleId || captionRules[0]?.id || '';

    function renderList(){
        const rows = captionRules.map((r,i) => {
            const isActive = r.id === activeId();
            const preview = r.content.length > 60 ? r.content.slice(0,60) + '...' : r.content;
            return `<div class="crm-row" data-idx="${i}">
                <div class="crm-col crm-col-status"><span class="crm-status ${isActive?'on':''}" data-action="activate" data-idx="${i}" title="${isActive?'当前使用中':'点击激活'}"></span></div>
                <div class="crm-col crm-col-name" title="${esc(r.name)}">${esc(r.name)}${r.category?` <span class="crm-cat">[${esc(r.category)}]</span>`:''}</div>
                <div class="crm-col crm-col-content" title="${esc(r.content)}">${esc(preview)}</div>
                <div class="crm-col crm-col-actions"><button data-action="edit" data-idx="${i}" title="编辑">✏️</button><button data-action="del" data-idx="${i}" title="删除">🗑️</button></div>
            </div>`;
        }).join('');
        modal.innerHTML = `<div class="caption-rule-modal">
            <div class="crm-header">
                <span class="crm-title">${esc(ctx.tr('caption.ruleManage'))}</span>
                <div class="crm-header-actions"><button class="crm-btn-add" data-action="add">+ ${esc(ctx.tr('caption.ruleAdd'))}</button><button class="crm-close" data-action="close">✕</button></div>
            </div>
            <div class="crm-body">
                <div class="crm-table">
                    <div class="crm-table-header">
                        <div class="crm-col crm-col-status">状态</div>
                        <div class="crm-col crm-col-name">规则名称</div>
                        <div class="crm-col crm-col-content">规则内容</div>
                        <div class="crm-col crm-col-actions">操作</div>
                    </div>
                    <div class="crm-table-body">${rows}</div>
                </div>
            </div>
            <div class="crm-footer"><button class="crm-btn-reset" data-action="reset">${esc(ctx.tr('caption.ruleReset'))}</button><button class="crm-btn-done" data-action="close">${esc(ctx.tr('caption.ruleDone'))}</button></div>
        </div>`;
    }
    function renderEditor(rule){
        const isNew = !rule;
        const r = rule || {id:uid(), name:'', category:'', content:''};
        modal.innerHTML = `<div class="caption-rule-modal">
            <div class="crm-header"><span class="crm-title">${isNew ? esc(ctx.tr('caption.ruleAdd')) : esc(ctx.tr('caption.ruleEdit'))}</span><button class="crm-close" data-action="back">←</button></div>
            <div class="crm-body crm-editor">
                <label>${esc(ctx.tr('caption.ruleName'))}<input class="crm-input" id="crmName" value="${esc(r.name)}" maxlength="40"></label>
                <label>${esc(ctx.tr('caption.ruleCategory'))}<input class="crm-input" id="crmCat" value="${esc(r.category)}" maxlength="20" placeholder="留空为无分类"></label>
                <label>${esc(ctx.tr('caption.ruleContent'))}<textarea class="crm-textarea" id="crmContent" rows="8">${esc(r.content)}</textarea></label>
            </div>
            <div class="crm-footer"><button class="crm-btn-reset" data-action="back">${esc(ctx.tr('caption.ruleCancel'))}</button><button class="crm-btn-done" data-action="save" data-id="${esc(r.id)}" data-new="${isNew}">${esc(ctx.tr('caption.ruleSave'))}</button></div>
        </div>`;
    }
    renderList();
    modal.addEventListener('click', ev => {
        const a = ev.target.closest('[data-action]')?.dataset.action;
        if(!a) return;
        const idx = Number(ev.target.closest('[data-idx]')?.dataset.idx);
        if(a === 'close') modal.remove();
        else if(a === 'add') renderEditor(null);
        else if(a === 'edit') renderEditor(captionRules[idx]);
        else if(a === 'del'){ captionRules.splice(idx, 1); saveRules(captionRules); renderList(); }
        else if(a === 'activate'){ captionCfg.activeRuleId = captionRules[idx]?.id || ''; saveSettings(captionCfg); renderList(); }
        else if(a === 'reset'){ captionRules = [...DEFAULT_RULES]; saveRules(captionRules); renderList(); }
        else if(a === 'back') renderList();
        else if(a === 'save'){
            const btn = ev.target.closest('[data-action="save"]');
            const id = btn.dataset.id, isNew = btn.dataset.new === 'true';
            const name = (document.getElementById('crmName')?.value || '').trim();
            const cat = (document.getElementById('crmCat')?.value || '').trim();
            const cont = (document.getElementById('crmContent')?.value || '').trim();
            if(!name || !cont){ ctx.toast(ctx.tr('caption.ruleNeedFields')); return; }
            if(isNew) captionRules.push({id, name, category:cat, content:cont});
            else { const ex = captionRules.find(r => r.id === id); if(ex){ ex.name=name; ex.category=cat; ex.content=cont; } }
            saveRules(captionRules); renderList();
        }
    });
    modal.addEventListener('mousedown', ev => { if(ev.target === modal) modal.remove(); });
}

// ========== 导出 ==========
window.CaptionMenu = {
    open: openCaptionMenu,
    close: closeMenu,
    getActiveRulePrompt(fallback){
        const rule = captionRules.find(r=>r.id===(captionCfg.activeRuleId||''));
        return rule?.content || captionRules[0]?.content || fallback || '请详细描述这张图片的内容。';
    },
    getActiveProvider(){ return captionCfg.provider||''; },
    getActiveModel(){ return captionCfg.model||''; }
};
})();
