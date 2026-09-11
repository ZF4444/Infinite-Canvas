// 测试辅助：把经典 <script> 形式的 candidate-pool.js（M12）加载进模拟
// 全局作用域，供 vitest 测试用例调用其中定义的纯逻辑函数（候选图归一化/
// 合并/去重、候选池读取判断等）。原理跟其它 xxx-sandbox.js 一致，
// 见 loop-node-sandbox.js 顶部注释。
//
// 注意：candidateOverlayHtml/expandedCandidateGridHtml 等 HTML 渲染函数、
// setNodeMainCandidate/addGeneratedCandidatesToNode 等直接修改 node 对象
// 并依赖多个外部函数（mediaNodeDefaultScale 等）的函数，跟 M5/M7/M8 核心
// 批次同类不易做干净的单元测试，因此本 sandbox 主要覆盖归一化/合并/
// 类型判断这类纯逻辑：normalizeGeneratedCandidateImage / candidateImageKey /
// candidateImageHasRunMeta / mergeCandidateImages / isMaskImageItem /
// shouldUseCandidatePoolForImages / nodeCandidateImages / candidateCountForNode。
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function readSrc(name) {
    return fs.readFileSync(
        path.resolve(repoRoot, `frontend/src/canvas/${name}`),
        'utf8'
    );
}

const CANDIDATE_POOL_SRC = readSrc('candidate-pool.js');

export function createCandidatePoolSandbox(overrides = {}) {
    const sandbox = {
        window: {},
        console, Date, Math, Array, Object, Number, String, Boolean, Set, Map, Promise, RegExp,

        // mediaKindForItem 正常在 media-display.js 里定义，本 sandbox 单独
        // 加载 candidate-pool.js 时需要提供最小可用的替代实现。
        mediaKindForItem: overrides.fns?.mediaKindForItem || ((img) => {
            const url = String(img?.url || '').toLowerCase();
            if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(url)) return 'video';
            if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(url)) return 'audio';
            return 'image';
        }),
        isSmartImageNode: overrides.fns?.isSmartImageNode || ((node) => !node?.type || node.type === 'smart-image' || node.type === 'smart-asset-image'),
        isHistoryGroupNode: overrides.fns?.isHistoryGroupNode || (() => false),
        settingsForStorage: overrides.fns?.settingsForStorage || ((s) => ({ ...s })),
        cloneSmartSettings: overrides.fns?.cloneSmartSettings || ((s) => ({ ...s })),
        mediaNodeDefaultScale: overrides.fns?.mediaNodeDefaultScale || (() => 1),
        promptDraftHtmlFromRunMeta: overrides.fns?.promptDraftHtmlFromRunMeta || (() => ''),
    };

    vm.createContext(sandbox);
    vm.runInContext(CANDIDATE_POOL_SRC, sandbox, { filename: 'candidate-pool.js' });
    return sandbox;
}
