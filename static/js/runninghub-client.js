window.RunningHubClient = (function () {
    async function readJson(response) {
        return await response.json();
    }

    function targetParams(target) {
        const source = target || {};
        return {
            connection_id: String(source.connection_id || ''),
            resource_id: String(source.resource_id || '')
        };
    }

    async function resolveTarget(webappId) {
        const appId = String(webappId || '').trim();
        if (!appId) throw new Error('RunningHub 应用 ID 未配置');
        const response = await fetch('/api/ai/resources');
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.detail || '加载 RunningHub 资源失败');
        const resource = (data.resources || []).find(item => {
            const settings = item.settings || {};
            const raw = settings.raw || {};
            const configuredAppId = settings.app_id || settings.webappId || settings.appId || settings.id || raw.webappId || raw.appId || raw.id;
            return item.kind === 'runninghub_app' && String(configuredAppId || '').trim() === appId;
        });
        if (!resource) throw new Error(`未找到已启用的 RunningHub 应用资源：${appId}`);
        return { connection_id: resource.connection_id || '', resource_id: resource.id || '' };
    }

    async function uploadFile(fileOrBlob, name, target) {
        const fd = new FormData();
        fd.append('file', fileOrBlob, name || 'upload.bin');
        const params = targetParams(target);
        if (params.connection_id) fd.append('connection_id', params.connection_id);
        if (params.resource_id) fd.append('resource_id', params.resource_id);
        const response = await fetch('/api/runninghub/upload-asset-file', {
            method: 'POST',
            body: fd
        });
        const data = await readJson(response);
        if (!response.ok || data.success === false) {
            throw new Error(data.detail || 'RunningHub 上传失败');
        }
        const fileName = (data.data || data).fileName;
        if (!fileName) {
            throw new Error('RunningHub 上传未返回 fileName');
        }
        return fileName;
    }

    async function submitTask(payload) {
        const response = await fetch('/api/runninghub/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await readJson(response);
        if (!response.ok || data.success === false) {
            throw new Error(data.detail || 'RunningHub 提交失败');
        }
        const taskId = (data.data || data).upstream_task_id;
        if (!taskId) {
            throw new Error('RunningHub 未返回 taskId');
        }
        return taskId;
    }

    async function queryTask(taskId, options) {
        const { persistOutputs = true } = options || {};
        const params = new URLSearchParams({ taskId: String(taskId || '') });
        if (!persistOutputs) params.set('persistOutputs', 'false');
        const target = targetParams(options);
        if (target.connection_id) params.set('connection_id', target.connection_id);
        if (target.resource_id) params.set('resource_id', target.resource_id);
        const response = await fetch(`/api/runninghub/query?${params.toString()}`);
        const data = await readJson(response);
        if (!response.ok || data.success === false) {
            throw new Error(data.detail || 'RunningHub 查询失败');
        }
        return data.data || data;
    }

    async function pollTask(taskId, options) {
        const { maxAttempts = 720, intervalMs = 2500, onUpdate = null, persistOutputs = true } = options || {};
        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
            const data = await queryTask(taskId, { persistOutputs, ...targetParams(options) });
            if (typeof onUpdate === 'function') {
                onUpdate(data, i);
            }
            if (data.status === 'SUCCESS') {
                return data;
            }
            if (data.status === 'FAILED') {
                throw new Error(data.failReason || 'RunningHub 任务失败');
            }
        }
        throw new Error('RunningHub 任务超时');
    }

    return {
        uploadFile,
        resolveTarget,
        submitTask,
        queryTask,
        pollTask,
    };
})();
