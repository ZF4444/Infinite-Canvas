// index.html（应用外壳/app shell）主体逻辑。
//
// 这是本次会话第一次把"内联 <script>"变成独立外部文件（前四次迁移
// 的 static/js/<page>.js 本来就已经是外部文件），原内容原样从
// static/index.html 的内联 <script> 标签里搬出来，未做任何逻辑改动
// （唯一的例外是顺带修复了一个既存 bug，见
// frontend/src/index/theme-lang-sync.js 顶部注释）。
//
// 范围：唯一客户端 id 生成/持久化（generateUUID/CID）、侧边栏固定/
// 收起状态管理（setSidebarPinned/toggleSidebarPinned/
// restoreSidebarPinned）、本地功能分组折叠状态
// （setLocalNavCollapsed/toggleLocalNav/restoreLocalNav）、核心的
// iframe 页面切换调度（switchUI——处理"离开确认"页面守卫消息、通知
// 被切走的页面、切换 active 类名和加载 iframe src、恢复本地导航折叠
// 状态）、跨 iframe 广播供应商/工作流/ComfyUI 实例变更消息
// （forwardStudioApiChange）、页面刷新后恢复上次激活的页面
// （restoreActivePage）、按登录用户的权限裁剪侧边栏可见入口
// （applyAccessControl）、到 `/ws/stats` 的 WebSocket 连接（云端状态/
// 画布更新/资产库更新等消息的接收和跨 iframe 转发）。
//
// 经典 <script>，非 ES module：跟其它四个页面同样的方法论（见
// frontend/README.md），本页面有内联 onclick 直接引用顶层函数
// （比如导航菜单项的 onclick="switchUI(this, 'canvas')"）。
//
// **`switchUI` 是整个应用最核心的调度函数，判断为不拆**：它是这个
// "应用外壳"页面唯一真正意义上的调度中枢——负责 iframe 切换的全部
// 副作用（激活态切换/离开确认/通知子页面/恢复导航折叠状态/画布刷新
// 通知），跟 asset-manager 的 handleClick、api-settings 的
// syncEditor/renderEditor 是完全相同的角色。
//
// window.__pageLeaveGuards（各子页面通过 postMessage 声明"离开前需要
// 确认"的守卫状态）和 WebSocket 连接（ws 变量）都是这个文件独有的
// 全局可变状态，没有被拆分到任何模块。
//
// 依赖 frontend/src/index/ 下几个模块提供的函数：window.closeHelpDrawer
// （由 help-feedback.js 的 initHelpDrawer IIFE 显式挂到 window，
// switchUI 切换页面时调用它收起帮助面板）、showAnnouncementModal
// （由 help-feedback.js 提供，WebSocket 收到 announcement 类型消息时
// 调用）。

        function generateUUID() {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                try { return crypto.randomUUID(); } catch (e) { }
            }
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        const CID = localStorage.getItem("client_id") || generateUUID();
        localStorage.setItem("client_id", CID);
        const ACTIVE_PAGE_KEY = 'studio_active_page';
        const LOCAL_NAV_COLLAPSED_KEY = 'studio_local_nav_collapsed';
        const SIDEBAR_PINNED_KEY = 'studio_sidebar_pinned';
        const DEFAULT_PAGE_ID = 'canvas';
        const PAGE_IDS = ['angle','gaussian','pose-studio','gpt-chat','canvas','asset-manager','my-account','api-settings','comfyui-settings','user-management','user-data-migration','feedback-admin','broadcast-admin'];
        const LEGACY_USER_MANAGEMENT_TABS = {'access-control':'access','storage-quota':'quota'};
        const LOCAL_PAGE_IDS = ['angle','gaussian','pose-studio'];
        const PAGE_META = {
            canvas: ['无限画布', '就绪'],
            'gpt-chat': ['GPT 对话', '准备开始对话'],
            'asset-manager': ['素材库', '浏览与整理素材'],
            'api-settings': ['API 设置', '管理 Connections 与 Models'],
            'comfyui-settings': ['工作流设置', '配置工作流节点'],
            'my-account': ['我的账户', '账户设置'],
            'user-management': ['用户管理', '管理团队成员'],
            'user-data-migration': ['数据迁移', '迁移本地数据'],
            angle: ['视角粗调', '定制工具'], gaussian: ['视角微调', '定制工具'], 'pose-studio': ['姿势编辑', '定制工具'],
            'feedback-admin': ['反馈管理', '管理用户反馈'], 'broadcast-admin': ['全局广播', '发布通知']
        };

        function updateWorkbenchMeta(id) {
            const meta = PAGE_META[id] || [id, ''];
            const title = document.getElementById('workbenchTitle');
            const status = document.getElementById('workbenchStatus');
            if (title) title.textContent = meta[0];
            if (status) status.textContent = meta[1];
            document.title = `${meta[0]} · MediaForge`;
        }

        function pageTriggers(pageId) {
            const expected = `switchUI(this, '${pageId}')`;
            return Array.from(document.querySelectorAll('[onclick]')).filter(el =>
                (el.getAttribute('onclick') || '').includes(expected)
            );
        }

        function pageTrigger(pageId) {
            return pageTriggers(pageId)[0] || null;
        }

        function setSidebarPinned(pinned, options = {}) {
            const sidebar = document.getElementById('studioSidebar');
            const logo = document.getElementById('sidebarLogoToggle');
            if(!sidebar) return;
            sidebar.classList.toggle('is-pinned', pinned);
            if(!pinned) {
                sidebar.classList.remove('is-touch-expanded');
                sidebar.classList.add('is-collapsing');
                // Keep the collapsed state stable until the pointer leaves the
                // sidebar. Otherwise :hover can immediately re-expand it.
                sidebar.classList.add('is-hover-suppressed');
                window.setTimeout(() => sidebar.classList.remove('is-collapsing'), 360);
            } else {
                sidebar.classList.remove('is-collapsing');
                sidebar.classList.remove('is-hover-suppressed');
            }
            if(logo) {
                logo.setAttribute('aria-pressed', pinned ? 'true' : 'false');
                logo.setAttribute('aria-label', pinned ? '收起导航栏' : '展开导航栏');
                logo.title = pinned ? '收起导航栏' : '展开导航栏';
            }
            if(!options.skipRemember) localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? '1' : '0');
        }

        function toggleSidebarPinned(event) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            const sidebar = document.getElementById('studioSidebar');
            if (!sidebar) return;
            if (sidebar.classList.contains('is-pinned') || sidebar.classList.contains('is-touch-expanded')) {
                setSidebarPinned(false);
            } else {
                setSidebarPinned(true);
            }
        }

        function restoreSidebarPinned() {
            setSidebarPinned(localStorage.getItem(SIDEBAR_PINNED_KEY) === '1', { skipRemember:true });
        }

        function bindSidebarTouchExpand() {
            const sidebar = document.getElementById('studioSidebar');
            if(!sidebar || sidebar.dataset.touchExpandBound === '1') return;
            sidebar.dataset.touchExpandBound = '1';
            const expand = event => {
                if(event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
                if(!sidebar.classList.contains('is-pinned')) sidebar.classList.add('is-touch-expanded');
            };
            const collapseOutside = event => {
                if(event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
                if(!sidebar.contains(event.target) && !sidebar.classList.contains('is-pinned')) sidebar.classList.remove('is-touch-expanded');
            };
            sidebar.addEventListener('pointerdown', expand, { passive:true });
            sidebar.addEventListener('touchstart', expand, { passive:true });
            document.addEventListener('pointerdown', collapseOutside, { passive:true });
            document.addEventListener('touchstart', collapseOutside, { passive:true });
        }

        function setLocalNavCollapsed(collapsed, options = {}) {
            const group = document.getElementById('local-nav-group');
            const toggle = document.getElementById('local-nav-toggle');
            if(group) group.classList.toggle('is-collapsed', collapsed);
            if(toggle) {
                toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                toggle.title = collapsed ? '展开定制功能' : '折叠定制功能';
            }
            if(!options.skipRemember) localStorage.setItem(LOCAL_NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
        }

        function toggleLocalNav() {
            const group = document.getElementById('local-nav-group');
            setLocalNavCollapsed(!group?.classList.contains('is-collapsed'));
        }

        function restoreLocalNav(id) {
            const savedCollapsed = localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) === '1';
            setLocalNavCollapsed(savedCollapsed && !LOCAL_PAGE_IDS.includes(id), { skipRemember:true });
        }

        function resetStudioRootScroll() {
            try {
                window.scrollTo(0, 0);
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
            } catch(e) {}
        }

        // 声明了"离开需确认"的页面集合（由子页面通过 page-guard 消息维护）
        window.__pageLeaveGuards = window.__pageLeaveGuards || {};

        function switchUI(el, id, options = {}) {
            resetStudioRootScroll();
            const legacyUserTab = LEGACY_USER_MANAGEMENT_TABS[id] || '';
            if(legacyUserTab) id = 'user-management';
            if(!PAGE_IDS.includes(id)) id = DEFAULT_PAGE_ID;
            updateWorkbenchMeta(id);
            document.querySelectorAll('[data-mobile-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.mobilePage === id));

            // 离开前确认：若当前激活页声明了守卫且非强制切换，则先询问该页能否离开
            try {
                const prevFrame = document.querySelector('.stage iframe.active');
                if (!options.force && prevFrame && prevFrame.id !== ('frame-' + id) && prevFrame.contentWindow) {
                    const prevId = prevFrame.id.replace('frame-', '');
                    if (window.__pageLeaveGuards[prevId]) {
                        // 交给子页面弹确认框；用户确认后会回传 page-leave-allow，再由宿主 force 切换
                        prevFrame.contentWindow.postMessage({ type: 'page-leave-check', from: prevId, target: id }, '*');
                        return; // 暂不切换，等待子页面回复
                    }
                }
            } catch(e) {}

            // 通知被切走的当前激活页面（用于自重置等）
            try {
                const prevFrame = document.querySelector('.stage iframe.active');
                if (prevFrame && prevFrame.id !== ('frame-' + id) && prevFrame.contentWindow) {
                    const prevId = prevFrame.id.replace('frame-', '');
                    prevFrame.contentWindow.postMessage({ type: 'page-hidden', page: prevId }, '*');
                }
            } catch(e) {}
            document.querySelectorAll('.nav-item,.side-pill').forEach(n => n.classList.remove('active'));
            if(el) el.classList.add('active');
            document.querySelectorAll('iframe').forEach(f => f.classList.remove('active'));
            const target = document.getElementById('frame-' + id);
            // 子页面中的普通链接可能曾把 iframe 导航到别的页面；恢复入口时
            // 必须把它指回该 iframe 声明的页面，否则只切换 active 类不会恢复画布。
            if (target && target.dataset.src) {
                const expectedSrc = new URL(target.dataset.src, location.href).href;
                if (target.src && target.src !== expectedSrc) target.src = target.dataset.src;
            }
            if(id === 'user-management' && legacyUserTab && !target.src) target.dataset.src = `/static/user-management.html#${legacyUserTab}`;
            target.classList.add('active');
            // 切换功能页面时自动收起帮助面板：不同页面的帮助内容互相独立，
            // 避免面板停留在旧页面的内容上造成误解。
            if (typeof window.closeHelpDrawer === 'function') window.closeHelpDrawer();
            const notifyAccountFocus = () => {
                if (id !== 'my-account') return;
                try { target.contentWindow?.postMessage({ type: 'account-focus' }, '*'); } catch(e) {}
            };
            if (!target.src) {
                target.addEventListener('load', notifyAccountFocus, { once:true });
                target.src = target.dataset.src;
            } else {
                notifyAccountFocus();
            }
            if(!options.skipRemember) localStorage.setItem(ACTIVE_PAGE_KEY, id);
            // sync theme to newly activated iframe
            syncThemeToFrame(target);
            if(LOCAL_PAGE_IDS.includes(id)) {
                setLocalNavCollapsed(false, { skipRemember:true });
            } else {
                setLocalNavCollapsed(localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) === '1', { skipRemember:true });
            }
            // 切换到画布时通知刷新工作流列表（防止在 comfyui-settings 修改后画布未及时更新）
            if (id === 'canvas' && target.src) {
                try { target.contentWindow?.postMessage({ type: 'canvas-focus' }, '*'); } catch(e) {}
            }
            resetStudioRootScroll();
        }

        function forwardStudioApiChange(data) {
            if(!data || !['providers-changed','workflows-changed','comfy-instances-changed'].includes(data.type)) return;
            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(data, '*');
                } catch(e) {}
            });
        }

        window.addEventListener('message', event => {
            if (event.origin && event.origin !== location.origin) return;
            const d = event.data || {};
            if (d.type === 'studio-open-asset-storage') {
                try { localStorage.setItem('asset_manager_requested_tab', 'storage'); } catch(e) {}
                const trigger = pageTrigger('asset-manager');
                const frame = document.getElementById('frame-asset-manager');
                const notifyStorageTab = () => {
                    try { frame?.contentWindow?.postMessage({type:'asset-manager-open-tab', tab:'storage'}, location.origin); } catch(e) {}
                };
                if(frame && !frame.src) frame.addEventListener('load', notifyStorageTab, {once:true});
                switchUI(trigger, 'asset-manager');
                notifyStorageTab();
                return;
            }
            if (d.type === 'studio-open-account') {
                switchUI(pageTrigger('my-account'), 'my-account');
                return;
            }
            // 子页面声明/取消"离开需确认"守卫
            if (d.type === 'page-guard' && d.page) {
                window.__pageLeaveGuards[d.page] = !!d.active;
                return;
            }
            // 子页面确认离开后，宿主强制切换到目标页
            if (d.type === 'page-leave-allow' && d.target) {
                window.__pageLeaveGuards[d.from] = false; // 放行后解除守卫，避免再次拦截
                const trigger = pageTrigger(d.target);
                switchUI(trigger, d.target, { force: true });
                return;
            }
            forwardStudioApiChange(event.data);
        });

        try {
            const studioApiChannel = new BroadcastChannel('studio-api');
            studioApiChannel.onmessage = event => forwardStudioApiChange(event.data);
        } catch(e) {}

        function restoreActivePage() {
            restoreSidebarPinned();
            const savedId = localStorage.getItem(ACTIVE_PAGE_KEY);
            const id = PAGE_IDS.includes(savedId) || LEGACY_USER_MANAGEMENT_TABS[savedId] ? savedId : DEFAULT_PAGE_ID;
            if(LEGACY_USER_MANAGEMENT_TABS[id]) localStorage.setItem(ACTIVE_PAGE_KEY, 'user-management');
            restoreLocalNav(id);
            const trigger = LEGACY_USER_MANAGEMENT_TABS[id] ? document.getElementById('nav-user-management') : pageTrigger(id);
            switchUI(trigger, id, { skipRemember:true });
            document.documentElement.classList.remove('studio-route-booting');
        }
        document.addEventListener('DOMContentLoaded', restoreActivePage, { once:true });
        document.addEventListener('DOMContentLoaded', bindSidebarTouchExpand, { once:true });
        document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('studioSidebar')?.addEventListener('pointerleave', () => {
                document.getElementById('studioSidebar')?.classList.remove('is-hover-suppressed');
            });
        }, { once:true });
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    const match = (item.getAttribute('onclick') || '').match(/'([^']+)'/);
                    if (match) switchUI(item, match[1]);
                });
            });
        }, { once:true });

        // --- 访问控制：按当前用户权限过滤侧边栏页面入口 ---
        async function applyAccessControl() {
            let me;
            try {
                const res = await fetch('/api/access-control/me', { credentials:'same-origin' });
                if (!res.ok) return;            // 未登录/异常时不做裁剪，保持默认全开
                me = await res.json();
            } catch(e) { return; }

            const allowed = new Set(me && Array.isArray(me.pages) ? me.pages : []);
            let hidActive = false;
            PAGE_IDS.forEach(pid => {
                pageTriggers(pid).forEach(el => {
                    const visible = allowed.has(pid);
                    el.style.display = visible ? '' : 'none';
                    if (!visible && el.classList.contains('active')) hidActive = true;
                });
            });
            // 若当前激活页被裁剪，回退到第一个允许的页面
            if (hidActive) {
                const fallback = PAGE_IDS.find(p => allowed.has(p)) || DEFAULT_PAGE_ID;
                const trigger = pageTrigger(fallback);
                switchUI(trigger, fallback);
            }
        }
        document.addEventListener('DOMContentLoaded', applyAccessControl, { once:true });


        const host = window.location.host;
        if (host) {
            const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
            const ws = new WebSocket(`${protocol}://${host}/ws/stats?client_id=${CID}`);
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'cloud_status') {
                    const iframe = document.querySelector('iframe.active');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage(data, '*');
                    }
                } else if (data.type === 'canvas_updated') {
                    const iframe = document.querySelector('iframe.active');
                    if (iframe && iframe.contentWindow) {
                        iframe.contentWindow.postMessage(data, '*');
                    }
                } else if (data.type === 'asset_library_updated') {
                    document.querySelectorAll('iframe').forEach(iframe => {
                        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(data, '*');
                    });
                } else if (data.type === 'announcement') {
                    showAnnouncementModal(data.data);
                }
            };
        }
