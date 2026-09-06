#!/usr/bin/env node
/**
 * 通用多页面构建脚本（取代原来只服务画布的 build-canvas.mjs）。
 *
 * 背景：画布重构（M1-M22）验证出一套"经典 <script> 手写模块拆分"
 * 方法论——不用 ES module/import，不用 Rollup/Vite 打包，只是把单体
 * 文件物理拆分成多个文件，用 <script src> 顺序加载，靠经典脚本的
 * 共享顶层作用域语义保证跨文件函数调用/状态读写正常工作。这个方法论
 * 现在要复用到 asset-manager.js 页面，所以把
 * 构建脚本从"只认识 canvas 一个页面"泛化成"认识一份页面注册表"。
 *
 * 每个页面在 PAGES 里注册：
 *   - page: 页面标识（对应 frontend/src/<page>/ 和 static/dist/<page>/）
 *   - mainSrc: 该页面的唯一源码文件路径。画布源码位于
 *     frontend/src/canvas/main.js；尚未完成迁移的页面仍暂时使用
 *     static/js/<xxx>.js。
 *   - handwrittenFiles: 已经物理拆分出来的模块文件名列表，顺序即
 *     <script src> 加载顺序（越靠前越先加载）
 *
 * 为什么还是不用 export/import：
 *   见 frontend/README.md 的"为什么不用 ES module"一节——这几个页面
 *   的 html 都有内联 onclick="xxx()" 或者跨文件直接读写共享 let 状态
 *   的场景，classic script 顶层声明自动挂到 window/共享顶层作用域，
 *   ES module 的具名 import 是只读绑定，二者语义不兼容。
 *
 * 输出目录选择 static/dist/ 而不是 frontend/dist/ 的原因同画布：
 *   main.py 的 /static 挂载和版本号注入逻辑（app/routers/pages.py::
 *   versioned_static_html）只认 /static/ 开头的路径。
 */
import { copyFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, '..');
const repoRoot = resolve(frontendRoot, '..');

const PAGES = [
  {
    // 画布（M1-M22 已完成的拆分，21 个模块 + main.js）
    page: 'canvas',
    mainSrc: 'frontend/src/canvas/main.js',
    handwrittenFiles: [
      'state.js', 'utils.js', 'loop-node.js', 'node-layout.js', 'node-model.js',
      'connections.js', 'cascade-run.js', 'upload.js', 'media-display.js',
      'candidate-pool.js', 'clipboard.js', 'node-context-ui.js', 'workflow-transfer.js',
      'canvas-sync.js', 'prompt-templates.js', 'prompt-task-rules.js', 'mention-composer.js', 'canvas-render.js',
      'image-editor.js', 'asset-library.js', 'generation-settings.js',
      'agent/agent-state.js', 'agent/agent-bridge.js', 'agent/agent-client.js',
      'agent/agent-plan.js', 'agent/agent-artifacts.js', 'agent/agent-event-projector.js',
      'agent/agent-events.js', 'agent/agent-panel.js',
    ],
  },
  {
    // 素材库管理页（迁移中，见 frontend/README.md 的 asset-manager 章节）
    page: 'asset-manager',
    mainSrc: 'static/js/asset-manager.js',
    handwrittenFiles: ['storage-manager.js', 'local-assets.js', 'asset-library.js', 'prompt-library.js', 'avatar-registration.js', 'detail-lightbox.js'],
  },
  {
    // ComfyUI 设置页（迁移中，见 frontend/README.md 的 comfyui-settings 章节）
    page: 'comfyui-settings',
    mainSrc: 'static/js/comfyui-settings.js',
    handwrittenFiles: ['node-graph-editor.js', 'field-editor.js', 'preview-panel.js', 'mini-canvas.js'],
  },
  {
    // 工作流设置父页：承载 ComfyUI 工作流与 RH 应用两个同源子页。
    page: 'workflow-settings',
    mainSrc: 'static/js/workflow-settings.js',
    handwrittenFiles: ['rh-workflow-editor.js'],
  },
  {
    // 应用外壳/app shell（迁移中，见 frontend/README.md 的 index 章节）
    page: 'index',
    mainSrc: 'static/js/index.js',
    handwrittenFiles: ['help-feedback.js', 'theme-lang-sync.js', 'version-check.js'],
  },
];

function buildPage({ page, mainSrc, handwrittenFiles }) {
  const mainSrcAbs = resolve(repoRoot, mainSrc);
  const outDir = resolve(repoRoot, 'static/dist', page);
  const mainDest = resolve(outDir, 'main.js');

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // main.js：始终从页面源码目录单向生成发布产物。
  copyFileSync(mainSrcAbs, mainDest);
  console.log(`[build:${page}] copied ${mainSrcAbs} -> ${mainDest}`);

  // 手写源码文件（经典脚本，各自独立拆出的模块），直接复制，顺序即
  // <script src> 加载顺序。
  for (const name of handwrittenFiles) {
    const src = resolve(frontendRoot, 'src', page, name);
    const dest = resolve(outDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    console.log(`[build:${page}] copied ${src} -> ${dest}`);
  }
}

for (const pageConfig of PAGES) {
  buildPage(pageConfig);
}
