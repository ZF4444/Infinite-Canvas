(function () {
    const DIALOG_ID = 'storageQuotaExceededDialog';

    function formatGb(bytes) {
        if (bytes === null || bytes === undefined || bytes === '') return '--';
        const size = Number(bytes);
        if (!Number.isFinite(size) || size < 0) return '--';
        const value = size / (1024 * 1024 * 1024);
        return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    async function quotaSnapshot(data) {
        const snapshot = {...(data || {})};
        const hasUsedBytes = snapshot.used_bytes !== null && snapshot.used_bytes !== undefined && snapshot.used_bytes !== '' && Number.isFinite(Number(snapshot.used_bytes));
        if (Number(snapshot.quota_bytes) > 0 && hasUsedBytes) return snapshot;
        try {
            const response = await fetch('/api/storage/usage');
            if (!response.ok) return snapshot;
            const usage = await response.json();
            if (!(Number(snapshot.quota_bytes) > 0)) snapshot.quota_bytes = usage?.quota_bytes;
            if (!hasUsedBytes) snapshot.used_bytes = usage?.used_bytes;
        } catch (_) {}
        return snapshot;
    }

    function ensureStyles() {
        if (document.getElementById('storageQuotaDialogStyles')) return;
        const style = document.createElement('style');
        style.id = 'storageQuotaDialogStyles';
        style.textContent = `
            .storage-quota-dialog-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.46);backdrop-filter:blur(8px)}
            .storage-quota-dialog{width:min(440px,calc(100vw - 32px));overflow:hidden;border:1px solid rgba(148,163,184,.3);border-radius:8px;background:var(--surface,#fff);color:var(--text,#172033);box-shadow:0 24px 70px rgba(15,23,42,.28)}
            .storage-quota-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px 12px}
            .storage-quota-dialog-title{font-size:17px;font-weight:750}
            .storage-quota-dialog-close{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
            .storage-quota-dialog-close:hover{background:rgba(148,163,184,.16)}
            .storage-quota-dialog-close svg{width:18px;height:18px}
            .storage-quota-dialog-message{padding:4px 20px 22px;font-size:14px;line-height:1.7;color:var(--muted,#586174)}
            .storage-quota-dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid rgba(148,163,184,.22);background:rgba(148,163,184,.06)}
            .storage-quota-dialog-btn{display:inline-flex;min-height:38px;align-items:center;justify-content:center;gap:7px;padding:0 14px;border:1px solid rgba(148,163,184,.38);border-radius:6px;background:transparent;color:inherit;font-size:13px;font-weight:700;cursor:pointer}
            .storage-quota-dialog-btn.primary{border-color:#2563eb;background:#2563eb;color:#fff}
            .storage-quota-dialog-btn svg{width:16px;height:16px}
            .theme-dark .storage-quota-dialog,body.theme-dark .storage-quota-dialog{background:#111827;color:#f8fafc}
            .theme-dark .storage-quota-dialog-message,body.theme-dark .storage-quota-dialog-message{color:#cbd5e1}
        `;
        document.head.appendChild(style);
    }

    function closeDialog() {
        document.getElementById(DIALOG_ID)?.remove();
    }

    function openStorageManagement() {
        closeDialog();
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({type: 'studio-open-asset-storage'}, location.origin);
            return;
        }
        window.location.href = '/static/storage-manager.html';
    }

    function showQuotaDialog(data) {
        ensureStyles();
        closeDialog();
        const quotaGb = formatGb(data?.quota_bytes);
        const usedGb = formatGb(data?.used_bytes);
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'storage-quota-dialog-overlay';
        overlay.setAttribute('role', 'presentation');
        overlay.innerHTML = `
            <section class="storage-quota-dialog" role="dialog" aria-modal="true" aria-labelledby="storageQuotaDialogTitle">
                <div class="storage-quota-dialog-head">
                    <div id="storageQuotaDialogTitle" class="storage-quota-dialog-title">存储空间不足</div>
                    <button class="storage-quota-dialog-close" type="button" data-quota-close aria-label="关闭" title="关闭"><i data-lucide="x"></i></button>
                </div>
                <div class="storage-quota-dialog-message">
                    存储空间不足: 存储空间 ${quotaGb}GB, 已使用了 ${usedGb}GB<br>
                    可前往空间管理，在条件筛选中勾选“仅未被画布、历史、对话或素材库引用”，删除符合条件的文件<br>
                    如果无引用的文件较少，可以删除无用的画布或画布中的节点，然后再勾选无引用的文件删除。
                </div>
                <div class="storage-quota-dialog-actions">
                    <button class="storage-quota-dialog-btn" type="button" data-quota-close>关闭</button>
                    <button class="storage-quota-dialog-btn primary" type="button" data-quota-manage><i data-lucide="database"></i><span>前往空间管理</span></button>
                </div>
            </section>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-quota-close]')) closeDialog();
            if (event.target.closest('[data-quota-manage]')) openStorageManagement();
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeDialog();
        });
        document.body.appendChild(overlay);
        window.lucide?.createIcons?.();
        overlay.querySelector('[data-quota-manage]')?.focus();
    }

    function showBudgetDialog(data) {
        ensureStyles();
        closeDialog();
        const message = String(data?.message || data?.detail || '本月使用预算已用尽，暂时无法继续执行任务。');
        const overlay = document.createElement('div');
        overlay.id = DIALOG_ID;
        overlay.className = 'storage-quota-dialog-overlay';
        overlay.setAttribute('role', 'presentation');
        overlay.innerHTML = `
            <section class="storage-quota-dialog" role="dialog" aria-modal="true" aria-labelledby="storageQuotaDialogTitle">
                <div class="storage-quota-dialog-head">
                    <div id="storageQuotaDialogTitle" class="storage-quota-dialog-title">预算不足</div>
                    <button class="storage-quota-dialog-close" type="button" data-quota-close aria-label="关闭" title="关闭"><i data-lucide="x"></i></button>
                </div>
                <div class="storage-quota-dialog-message">${escapeHtml(message)}<br>请联系管理员(@飞帆)增加预算或调整预算配置。</div>
                <div class="storage-quota-dialog-actions">
                    <button class="storage-quota-dialog-btn primary" type="button" data-quota-close>我知道了</button>
                </div>
            </section>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-quota-close]')) closeDialog();
        });
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeDialog();
        });
        document.body.appendChild(overlay);
        window.lucide?.createIcons?.();
        overlay.querySelector('[data-quota-close]')?.focus();
    }

    function escapeHtml(value) {
        const node = document.createElement('div');
        node.textContent = String(value || '');
        return node.innerHTML;
    }

    async function upload(form, onProgress) {
        if (typeof onProgress !== 'function') {
            const response = await fetch('/api/ai/upload', {method: 'POST', body: form});
            const text = await response.text();
            let data = {};
            try { data = text ? JSON.parse(text) : {}; }
            catch (_) { data = {detail: text}; }
            if (response.status === 413) {
                showQuotaDialog(await quotaSnapshot(data));
                return {files: [], quota_exceeded: true};
            }
            if (!response.ok) throw new Error(data?.detail || data?.message || '上传失败');
            return data;
        }
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/ai/upload');
            xhr.upload.onprogress = event => {
                if (event.lengthComputable) onProgress(event.loaded, event.total);
            };
            xhr.onload = async () => {
                const text = xhr.responseText || '';
                let data = {};
                try { data = text ? JSON.parse(text) : {}; }
                catch (_) { data = {detail: text}; }
                if (xhr.status === 413) {
                    showQuotaDialog(await quotaSnapshot(data));
                    resolve({files: [], quota_exceeded: true});
                    return;
                }
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error(data?.detail || data?.message || '上传失败'));
                    return;
                }
                resolve(data);
            };
            xhr.onerror = () => reject(new Error('上传失败'));
            xhr.send(form);
        });
    }

    window.MediaForgeUpload = {upload, showQuotaDialog, showBudgetDialog, openStorageManagement};
})();
