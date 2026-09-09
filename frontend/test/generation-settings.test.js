// generation-settings.js 回归测试（M10）。
//
// 覆盖范围：
//   1. gcdInt：最大公约数计算（用于化简图片宽高比）。
//   2. imageSizeForRatio：从图片对象提取宽高（兼容多种字段名）。
//   3. reducedRatioForImage：图片宽高化简为最简比例。
//   4. closestStandardRatioKey：按宽高比匹配最接近的标准比例档位。
//   5. parseRatioValue / parseSizeValue：解析用户输入的比例/尺寸字符串。
//   6. ratioIconClass / videoAspectIconClass：比例值到图标 class 的映射。
//   7. ratioLabel：当前设置下的比例展示文案。
//
// renderDynamicParams/bindDynamicParams/loadConfig 等核心函数强依赖真实
// DOM 与网络请求，跟 M5/M7/M8 核心批次一样不适合单元测试，不在本文件
// 覆盖范围内。
import { describe, it, expect } from 'vitest';
import { createGenerationSettingsSandbox } from './generation-settings-sandbox.js';

describe('gcdInt', () => {
    it('计算两个正整数的最大公约数', () => {
        const { gcdInt } = createGenerationSettingsSandbox();
        expect(gcdInt(1920, 1080)).toBe(120);
        expect(gcdInt(16, 9)).toBe(1);
        expect(gcdInt(100, 50)).toBe(50);
    });

    it('输入 0 或非法值时至少返回 1', () => {
        const { gcdInt } = createGenerationSettingsSandbox();
        expect(gcdInt(0, 0)).toBe(1);
        expect(gcdInt(NaN, 5)).toBe(5);
    });

    it('负数按绝对值计算', () => {
        const { gcdInt } = createGenerationSettingsSandbox();
        expect(gcdInt(-12, 8)).toBe(4);
    });
});

describe('workflow media filtering', () => {
    it('图片和视频节点只匹配各自类型，通用工作流节点不筛选', () => {
        const { workflowMatchesNode } = createGenerationSettingsSandbox();
        const imageWorkflow = { name: 'image.json', media: 'image' };
        const videoWorkflow = { name: 'video.json', media: 'video' };

        expect(workflowMatchesNode(imageWorkflow, { genKind: 'image' })).toBe(true);
        expect(workflowMatchesNode(videoWorkflow, { genKind: 'image' })).toBe(false);
        expect(workflowMatchesNode(videoWorkflow, { genKind: 'video' })).toBe(true);
        expect(workflowMatchesNode(imageWorkflow, { genKind: 'video' })).toBe(false);
        expect(workflowMatchesNode(videoWorkflow, { genKind: 'workflow' })).toBe(true);
    });

    it('未标注 media 的旧工作流按图片兼容', () => {
        const { workflowMediaType, workflowMatchesNode } = createGenerationSettingsSandbox();
        const legacyWorkflow = { name: 'legacy.json' };

        expect(workflowMediaType(legacyWorkflow)).toBe('image');
        expect(workflowMatchesNode(legacyWorkflow, { genKind: 'image' })).toBe(true);
        expect(workflowMatchesNode(legacyWorkflow, { genKind: 'video' })).toBe(false);
    });

    it('没有 media 的 RunningHub 视频工作流可从字段和标签识别', () => {
        const { workflowMediaType } = createGenerationSettingsSandbox();

        expect(workflowMediaType({ fields: [{ fieldType: 'VIDEO' }] })).toBe('video');
        expect(workflowMediaType({ raw: { tags: [{ name: '视频生视频' }] } })).toBe('video');
        expect(workflowMediaType({ raw: { tags: [{ nameEn: 'Video-to-Video' }] } })).toBe('video');
    });

    it('已保存的错误类型工作流会回退到当前节点类型的首项', () => {
        const imageSandbox = createGenerationSettingsSandbox({
            settings: { engine: 'comfy', comfyWorkflow: 'video.json' },
            comfyWorkflows: [
                { name: 'image.json', media: 'image' },
                { name: 'video.json', media: 'video' },
            ],
        });
        imageSandbox.normalizeWorkflowSourceForNode({ genKind: 'image' });
        expect(imageSandbox.__state.settings.comfyWorkflow).toBe('image.json');

        const videoSandbox = createGenerationSettingsSandbox({
            settings: { engine: 'comfy', comfyWorkflow: 'image.json' },
            comfyWorkflows: [
                { name: 'image.json', media: 'image' },
                { name: 'video.json', media: 'video' },
            ],
        });
        videoSandbox.normalizeWorkflowSourceForNode({ genKind: 'video' });
        expect(videoSandbox.__state.settings.comfyWorkflow).toBe('video.json');
    });

    it('RunningHub 旧连接条目从资源配置补齐媒体类型', () => {
        const { runningHubEntries } = createGenerationSettingsSandbox({
            aiConnections: [{
                id: 'runninghub',
                enabled: true,
                rh_apps: [{ id: 'video-app', title: 'Video app' }],
            }],
            aiResourceIndex: {
                resources: [{
                    id: 'resource-video-app',
                    kind: 'runninghub_app',
                    enabled: true,
                    settings: { id: 'video-app', media: 'video' },
                }],
            },
        });

        expect(runningHubEntries('app')).toMatchObject([{ id: 'video-app', media: 'video' }]);
    });
});

describe('RunningHub text parameters', () => {
    it('保留多段提示词和空行，只统一换行符', () => {
        const { normalizeRhTextValue } = createGenerationSettingsSandbox();
        expect(normalizeRhTextValue('第一段\r\n\r\n第二段\r第三段')).toBe('第一段\n\n第二段\n第三段');
    });
});

describe('imageSizeForRatio', () => {
    it('兼容 natural_w/natural_h 字段', () => {
        const { imageSizeForRatio } = createGenerationSettingsSandbox();
        expect(imageSizeForRatio({ natural_w: 1920, natural_h: 1080 })).toEqual({ w: 1920, h: 1080 });
    });

    it('兼容 width/height 字段', () => {
        const { imageSizeForRatio } = createGenerationSettingsSandbox();
        expect(imageSizeForRatio({ width: 800, height: 600 })).toEqual({ w: 800, h: 600 });
    });

    it('兼容 w/h 字段', () => {
        const { imageSizeForRatio } = createGenerationSettingsSandbox();
        expect(imageSizeForRatio({ w: 400, h: 300 })).toEqual({ w: 400, h: 300 });
    });

    it('缺少尺寸信息时返回 null', () => {
        const { imageSizeForRatio } = createGenerationSettingsSandbox();
        expect(imageSizeForRatio({})).toBe(null);
        expect(imageSizeForRatio(null)).toBe(null);
    });
});

describe('reducedRatioForImage', () => {
    it('化简为最简整数比', () => {
        const { reducedRatioForImage } = createGenerationSettingsSandbox();
        expect(reducedRatioForImage({ natural_w: 1920, natural_h: 1080 })).toEqual({ w: 16, h: 9 });
        expect(reducedRatioForImage({ natural_w: 800, natural_h: 600 })).toEqual({ w: 4, h: 3 });
    });

    it('图片没有尺寸信息时返回 null', () => {
        const { reducedRatioForImage } = createGenerationSettingsSandbox();
        expect(reducedRatioForImage({})).toBe(null);
    });
});

describe('closestStandardRatioKey', () => {
    it('精确匹配标准比例', () => {
        const { closestStandardRatioKey } = createGenerationSettingsSandbox();
        expect(closestStandardRatioKey(1024, 1024)).toBe('1:1');
        expect(closestStandardRatioKey(1920, 1080)).toBe('16:9');
        expect(closestStandardRatioKey(1080, 1920)).toBe('9:16');
        expect(closestStandardRatioKey(2, 3)).toBe('2:3');
        expect(closestStandardRatioKey(3, 2)).toBe('3:2');
    });

    it('非标准比例匹配最接近的档位', () => {
        const { closestStandardRatioKey } = createGenerationSettingsSandbox();
        // 略偏离 1:1 但仍最接近 1:1。
        expect(closestStandardRatioKey(1000, 1010)).toBe('1:1');
    });

    it('宽高为 0 或非法值时返回 1:1', () => {
        const { closestStandardRatioKey } = createGenerationSettingsSandbox();
        expect(closestStandardRatioKey(0, 100)).toBe('1:1');
        expect(closestStandardRatioKey(100, 0)).toBe('1:1');
    });
});

describe('parseRatioValue', () => {
    it('解析 "宽:高" 格式', () => {
        const { parseRatioValue } = createGenerationSettingsSandbox();
        expect(parseRatioValue('16:9')).toBeCloseTo(16 / 9);
        expect(parseRatioValue('1:1')).toBe(1);
    });

    it('解析 "宽x高"/"宽X高"/"宽*高" 格式', () => {
        const { parseRatioValue } = createGenerationSettingsSandbox();
        expect(parseRatioValue('16x9')).toBeCloseTo(16 / 9);
        expect(parseRatioValue('16X9')).toBeCloseTo(16 / 9);
        expect(parseRatioValue('16*9')).toBeCloseTo(16 / 9);
    });

    it('无法解析或非正数时返回 0', () => {
        const { parseRatioValue } = createGenerationSettingsSandbox();
        expect(parseRatioValue('')).toBe(0);
        expect(parseRatioValue('abc')).toBe(0);
        expect(parseRatioValue('16:9:1')).toBe(0);
        expect(parseRatioValue('-1:9')).toBe(0);
    });
});

describe('parseSizeValue', () => {
    it('解析 "宽x高" 格式的尺寸字符串', () => {
        const { parseSizeValue } = createGenerationSettingsSandbox();
        expect(parseSizeValue('1024x768')).toEqual({ width: '1024', height: '768' });
        expect(parseSizeValue('1024X768')).toEqual({ width: '1024', height: '768' });
        expect(parseSizeValue('1024*768')).toEqual({ width: '1024', height: '768' });
        expect(parseSizeValue(' 1024 x 768 ')).toEqual({ width: '1024', height: '768' });
    });

    it('无法解析时返回 null', () => {
        const { parseSizeValue } = createGenerationSettingsSandbox();
        expect(parseSizeValue('')).toBe(null);
        expect(parseSizeValue('16:9')).toBe(null);
        expect(parseSizeValue('abc')).toBe(null);
    });
});

describe('ratioIconClass', () => {
    it('按比例值映射到对应图标 class', () => {
        const { ratioIconClass } = createGenerationSettingsSandbox();
        expect(ratioIconClass('2:3')).toBe('r-portrait');
        expect(ratioIconClass('3:4')).toBe('r-portrait43');
        expect(ratioIconClass('3:2')).toBe('r-landscape');
        expect(ratioIconClass('4:3')).toBe('r-landscape43');
        expect(ratioIconClass('16:9')).toBe('r-wide');
        expect(ratioIconClass('21:9')).toBe('r-wide');
        expect(ratioIconClass('9:16')).toBe('r-story');
        expect(ratioIconClass('9:21')).toBe('r-story');
        expect(ratioIconClass('source')).toBe('r-source');
        expect(ratioIconClass('custom')).toBe('r-custom');
    });

    it('未知值返回空字符串', () => {
        const { ratioIconClass } = createGenerationSettingsSandbox();
        expect(ratioIconClass('unknown')).toBe('');
        expect(ratioIconClass('square')).toBe('');
    });
});

describe('videoAspectIconClass', () => {
    it('按视频比例文案映射到对应图标 class', () => {
        const { videoAspectIconClass } = createGenerationSettingsSandbox();
        expect(videoAspectIconClass('16:9')).toBe('r-wide');
        expect(videoAspectIconClass('21:9')).toBe('r-wide');
        expect(videoAspectIconClass('9:16')).toBe('r-story');
        expect(videoAspectIconClass('9:21')).toBe('r-story');
        expect(videoAspectIconClass('4:3')).toBe('r-landscape43');
        expect(videoAspectIconClass('3:4')).toBe('r-portrait43');
        expect(videoAspectIconClass('keep_ratio')).toBe('r-source');
        expect(videoAspectIconClass('adaptive')).toBe('r-source');
    });

    it('未知值返回空字符串', () => {
        const { videoAspectIconClass } = createGenerationSettingsSandbox();
        expect(videoAspectIconClass('1:1')).toBe('');
    });
});

describe('ratioLabel', () => {
    it('按 settings.ratio 映射到展示文案（默认 1:1）', () => {
        const { ratioLabel } = createGenerationSettingsSandbox({ settings: {} });
        expect(ratioLabel()).toBe('1:1');
    });

    it('按 prefix 读取对应字段（如 outpaintRatio）', () => {
        const { ratioLabel } = createGenerationSettingsSandbox({
            settings: { outpaintRatio: '16:9' },
        });
        expect(ratioLabel('outpaint')).toBe('16:9');
    });

    it('custom 比例使用 customRatio 字段的值', () => {
        const { ratioLabel } = createGenerationSettingsSandbox({
            settings: { ratio: 'custom', customRatio: '5:7' },
        });
        expect(ratioLabel()).toBe('5:7');
    });
});
