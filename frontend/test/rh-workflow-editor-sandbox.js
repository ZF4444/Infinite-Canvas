// 测试辅助：把经典 <script> 形式的 rh-workflow-editor.js（api-settings 页面）
// 加载进模拟全局作用域，供 vitest 测试用例调用其中定义的纯逻辑函数。
//
// 注意：本模块里绝大部分函数强依赖真实 DOM（rhWorkflowEditorNodeList 等
// 共享 DOM 引用）/网络请求（fetchRhAppEditor/testRhMappedPreview）/
// main.js 的 provider()/saveProviders() 核心状态，不适合单元测试。
// 本 sandbox 只覆盖可独立验证的纯函数：parseRunningHubRunRef/
// rhWorkflowFieldKey/rhWorkflowFieldKind/rhWorkflowFieldTypeLabel/
// rhKnownOptionsForField/normalizeRhWorkflowField/rhWorkflowGroupKey/
// rhEditorSortedFields/mediaAcceptForRhKind/rhPreviewRandomValue。
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const RH_WORKFLOW_EDITOR_SRC = fs.readFileSync(
    path.resolve(repoRoot, 'frontend/src/workflow-settings/rh-workflow-editor.js'),
    'utf8'
);

export function createRhWorkflowEditorSandbox(overrides = {}) {
    const sandbox = {
        window: {...(overrides.window ?? {}), dispatchEvent: overrides.window?.dispatchEvent || (() => {})},
        location: { origin: 'http://test.local' },
        Event: class Event { constructor(type) { this.type = type; } },
        console, Date, Math, Array, Object, Number, String, Boolean, Set, Map, Promise, RegExp, JSON,

        // 这些函数内部依赖的共享状态/DOM/main.js 函数，纯函数测试用不到，
        // 这里只给最基本的占位，避免报未定义。
        rhWorkflowEditorState: overrides.rhWorkflowEditorState ?? { open:false, index:-1, entry:null, config:null, expanded:{}, activeNodeId:'', graph:{k:1,x:0,y:0,w:0,h:0}, pan:null, bound:false, previewParams:{}, previewRunning:false, previewStatus:'', previewOutputs:[] },
        rhWorkflowEditorNodeList: overrides.rhWorkflowEditorNodeList ?? null,
        rhWorkflowEditorGraphWrap: overrides.rhWorkflowEditorGraphWrap ?? null,
        rhWorkflowEditorOverlay: overrides.rhWorkflowEditorOverlay ?? null,
        rhWorkflowEditorTitle: overrides.rhWorkflowEditorTitle ?? null,
        rhWorkflowEditorSub: overrides.rhWorkflowEditorSub ?? null,
        rhWorkflowSaveBtn: overrides.rhWorkflowSaveBtn ?? null,
        rhWorkflowEditName: overrides.rhWorkflowEditName ?? null,
        rhWorkflowEditNote: overrides.rhWorkflowEditNote ?? null,
        rhWorkflowEditorSummary: overrides.rhWorkflowEditorSummary ?? null,
        rhAppsList: overrides.rhAppsList ?? null,
        rhAppsCount: overrides.rhAppsCount ?? null,
        rhPasteInput: overrides.rhPasteInput ?? null,
        provider: overrides.fns?.provider || (() => null),
        setStatus: overrides.fns?.setStatus || (() => {}),
        refreshIcons: overrides.fns?.refreshIcons || (() => {}),
        broadcastStudioApiChange: overrides.fns?.broadcastStudioApiChange || (() => {}),
        saveProviders: overrides.fns?.saveProviders || (() => Promise.resolve(true)),
        escapeHtml: overrides.fns?.escapeHtml || (s => String(s ?? '')),
        escapeAttr: overrides.fns?.escapeAttr || (s => String(s ?? '')),
        document: {
            getElementById: overrides.fns?.getElementById || (() => null),
            querySelectorAll: overrides.fns?.querySelectorAll || (() => []),
            createElement: overrides.fns?.createElement || (() => ({})),
            body: { appendChild: () => {} },
        },
        fetch: overrides.fns?.fetch || (() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })),
        setTimeout, clearTimeout, requestAnimationFrame: cb => { cb(); return 0; },
    };

    vm.createContext(sandbox);
    vm.runInContext(RH_WORKFLOW_EDITOR_SRC, sandbox, { filename: 'rh-workflow-editor.js' });
    return sandbox;
}
