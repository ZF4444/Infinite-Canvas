// candidate-pool.js 回归测试（M12）。
//
// 覆盖范围：
//   1. normalizeGeneratedCandidateImage：归一化候选图（补充 generatedResult
//      标记，非图片类型被过滤掉）。
//   2. candidateImageKey：候选图去重用的 key（按 URL）。
//   3. candidateImageHasRunMeta：判断候选图是否携带运行元信息。
//   4. mergeCandidateImages：多组候选图合并去重，重复 URL 时优先保留
//      带运行元信息的版本。
//   5. isMaskImageItem：遮罩图识别（role=mask 或 _mask.png 后缀）。
//   6. shouldUseCandidatePoolForImages：节点是否应该使用候选池模式
//      （多张图 + 至少一张带生成元信息）。
//   7. nodeCandidateImages / candidateCountForNode：节点候选图列表读取。
//
// candidateOverlayHtml/expandedCandidateGridHtml 等 HTML 渲染函数、
// setNodeMainCandidate/addGeneratedCandidatesToNode 等直接修改 node 对象
// 的函数不在本文件覆盖范围内（跟 M5/M7/M8 核心批次同类，更适合集成测试
// 或人工浏览器回归）。
import { describe, it, expect } from 'vitest';
import { createCandidatePoolSandbox } from './candidate-pool-sandbox.js';

describe('normalizeGeneratedCandidateImage', () => {
    it('图片类型的候选图会被打上 generatedResult 标记', () => {
        const { normalizeGeneratedCandidateImage } = createCandidatePoolSandbox();
        const result = normalizeGeneratedCandidateImage({ url: 'https://x.com/a.png' });
        expect(result).toMatchObject({ url: 'https://x.com/a.png', generatedResult: true, kind: 'image' });
    });

    it('没有 url 的候选图返回 null', () => {
        const { normalizeGeneratedCandidateImage } = createCandidatePoolSandbox();
        expect(normalizeGeneratedCandidateImage({})).toBe(null);
        expect(normalizeGeneratedCandidateImage(null)).toBe(null);
    });

    it('视频类型也可作为候选素材', () => {
        const { normalizeGeneratedCandidateImage } = createCandidatePoolSandbox();
        expect(normalizeGeneratedCandidateImage({ url: 'https://x.com/a.mp4' })).toMatchObject({
            url: 'https://x.com/a.mp4', kind: 'video', generatedResult: true,
        });
    });

    it('会清除 runInputRefs 字段', () => {
        const { normalizeGeneratedCandidateImage } = createCandidatePoolSandbox();
        const result = normalizeGeneratedCandidateImage({ url: 'https://x.com/a.png', runInputRefs: ['x'] });
        expect(result.runInputRefs).toBeUndefined();
    });
});

describe('candidateImageKey', () => {
    it('按 URL 生成 key', () => {
        const { candidateImageKey } = createCandidatePoolSandbox();
        expect(candidateImageKey({ url: 'https://x.com/a.png' })).toBe('https://x.com/a.png');
    });

    it('缺少 url 时返回空字符串', () => {
        const { candidateImageKey } = createCandidatePoolSandbox();
        expect(candidateImageKey({})).toBe('');
        expect(candidateImageKey(null)).toBe('');
    });
});

describe('candidateImageHasRunMeta', () => {
    it('携带任意一个运行元信息字段即返回 true', () => {
        const { candidateImageHasRunMeta } = createCandidatePoolSandbox();
        expect(candidateImageHasRunMeta({ runPrompt: 'a cat' })).toBe(true);
        expect(candidateImageHasRunMeta({ sourceNodeId: 'n1' })).toBe(true);
        expect(candidateImageHasRunMeta({ promptDraftHtml: '<p>x</p>' })).toBe(true);
    });

    it('没有任何运行元信息字段时返回 false', () => {
        const { candidateImageHasRunMeta } = createCandidatePoolSandbox();
        expect(candidateImageHasRunMeta({ url: 'https://x.com/a.png' })).toBe(false);
        expect(candidateImageHasRunMeta(null)).toBe(false);
    });
});

describe('mergeCandidateImages', () => {
    it('多组候选图合并为一个去重列表，保持先出现顺序', () => {
        const { mergeCandidateImages } = createCandidatePoolSandbox();
        const groupA = [{ url: 'https://x.com/a.png' }];
        const groupB = [{ url: 'https://x.com/b.png' }];
        const merged = mergeCandidateImages(groupA, groupB);
        expect(merged.map(img => img.url)).toEqual(['https://x.com/a.png', 'https://x.com/b.png']);
    });

    it('重复 URL 时，若后出现的版本携带运行元信息而先出现的没有，则合并补充元信息', () => {
        const { mergeCandidateImages } = createCandidatePoolSandbox();
        const withoutMeta = [{ url: 'https://x.com/a.png' }];
        const withMeta = [{ url: 'https://x.com/a.png', runPrompt: 'a cat' }];
        const merged = mergeCandidateImages(withoutMeta, withMeta);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ url: 'https://x.com/a.png', runPrompt: 'a cat' });
    });

    it('重复 URL 且先出现的已有运行元信息时，不会被后出现的覆盖', () => {
        const { mergeCandidateImages } = createCandidatePoolSandbox();
        const withMeta = [{ url: 'https://x.com/a.png', runPrompt: 'original' }];
        const withOtherMeta = [{ url: 'https://x.com/a.png', runPrompt: 'other' }];
        const merged = mergeCandidateImages(withMeta, withOtherMeta);
        expect(merged).toHaveLength(1);
        expect(merged[0].runPrompt).toBe('original');
    });

    it('过滤掉没有 url 的无效项', () => {
        const { mergeCandidateImages } = createCandidatePoolSandbox();
        const merged = mergeCandidateImages([{ url: '' }, { url: 'https://x.com/a.png' }]);
        expect(merged).toHaveLength(1);
    });
});

describe('isMaskImageItem', () => {
    it('role 为 mask（大小写不敏感）时判定为遮罩图', () => {
        const { isMaskImageItem } = createCandidatePoolSandbox();
        expect(isMaskImageItem({ role: 'mask' })).toBe(true);
        expect(isMaskImageItem({ role: 'MASK' })).toBe(true);
    });

    it('文件名以 _mask.png 结尾时判定为遮罩图', () => {
        const { isMaskImageItem } = createCandidatePoolSandbox();
        expect(isMaskImageItem({ name: 'photo_mask.png' })).toBe(true);
        expect(isMaskImageItem({ name: 'PHOTO_MASK.PNG' })).toBe(true);
    });

    it('普通图片不判定为遮罩图', () => {
        const { isMaskImageItem } = createCandidatePoolSandbox();
        expect(isMaskImageItem({ name: 'photo.png' })).toBe(false);
        expect(isMaskImageItem(null)).toBe(false);
    });
});

describe('shouldUseCandidatePoolForImages', () => {
    it('单张图片或非图片节点不使用候选池', () => {
        const { shouldUseCandidatePoolForImages } = createCandidatePoolSandbox();
        expect(shouldUseCandidatePoolForImages({ images: [{ url: 'a.png' }] })).toBe(false);
        expect(shouldUseCandidatePoolForImages({ type: 'smart-prompt', images: [{ url: 'a.png' }, { url: 'b.png' }] })).toBe(false);
    });

    it('多张图片且至少一张带生成元信息时使用候选池', () => {
        const { shouldUseCandidatePoolForImages } = createCandidatePoolSandbox();
        const node = { images: [{ url: 'a.png', generatedResult: true }, { url: 'b.png' }] };
        expect(shouldUseCandidatePoolForImages(node)).toBe(true);
    });

    it('多张图片但都没有任何生成元信息时不使用候选池（如手动上传的多图）', () => {
        const { shouldUseCandidatePoolForImages } = createCandidatePoolSandbox();
        const node = { images: [{ url: 'a.png' }, { url: 'b.png' }] };
        expect(shouldUseCandidatePoolForImages(node)).toBe(false);
    });

    it('工作流的混合媒体生成结果也使用候选池', () => {
        const { shouldUseCandidatePoolForImages } = createCandidatePoolSandbox();
        const node = { images: [{ url: 'a.png', generatedResult: true }, { url: 'b.mp4' }] };
        expect(shouldUseCandidatePoolForImages(node)).toBe(true);
    });
});

describe('nodeCandidateImages / candidateCountForNode', () => {
    it('合并 explicit candidateImages 与已生成的 images', () => {
        const sandbox = createCandidatePoolSandbox();
        const node = {
            type: 'smart-image',
            candidateImages: [{ url: 'https://x.com/a.png' }],
            images: [{ url: 'https://x.com/b.png', generatedResult: true }],
        };
        const pool = sandbox.nodeCandidateImages(node);
        expect(pool.map(img => img.url)).toEqual(['https://x.com/a.png', 'https://x.com/b.png']);
        expect(sandbox.candidateCountForNode(node)).toBe(2);
    });

    it('非生成节点返回空数组', () => {
        const { nodeCandidateImages } = createCandidatePoolSandbox();
        expect(nodeCandidateImages({ type: 'smart-prompt' })).toEqual([]);
    });

    it('视频生成节点读取视频候选素材', () => {
        const { nodeCandidateImages } = createCandidatePoolSandbox();
        const node = {
            type: 'smart-image',
            genKind: 'video',
            candidateImages: [{ url: 'https://x.com/a.mp4', kind: 'video' }],
            images: [{ url: 'https://x.com/b.mp4', kind: 'video', generatedResult: true }],
        };
        expect(nodeCandidateImages(node).map(item => item.url)).toEqual(['https://x.com/a.mp4', 'https://x.com/b.mp4']);
    });
});

describe('syncCandidateImageDimensions', () => {
    it('用实际加载尺寸同步候选项与当前主图，覆盖过时元数据', () => {
        const { syncCandidateImageDimensions } = createCandidatePoolSandbox();
        const candidate = { url: 'https://x.com/portrait.png', natural_w: 1600, natural_h: 900 };
        const displayed = { url: 'https://x.com/portrait.png', natural_w: 1600, natural_h: 900, generatedResult: true };
        const node = {
            candidateImages: [candidate, { url: 'https://x.com/landscape.png' }],
            images: [displayed],
        };

        expect(syncCandidateImageDimensions(node, candidate, 768, 1365)).toBe(true);
        expect(candidate).toMatchObject({ natural_w: 768, natural_h: 1365 });
        expect(displayed).toMatchObject({ natural_w: 768, natural_h: 1365 });
    });
});

describe('removeCandidateFromNode', () => {
    it('删除当前主素材后切换到相邻候选，并同步候选池', () => {
        const { removeCandidateFromNode } = createCandidatePoolSandbox();
        const node = {
            type: 'smart-image',
            candidateImages: [
                { url: 'https://x.com/a.png' },
                { url: 'https://x.com/b.png' },
                { url: 'https://x.com/c.png' },
            ],
            images: [{ url: 'https://x.com/b.png', generatedResult: true }],
            candidateIndex: 1,
        };

        expect(removeCandidateFromNode(node, 1).url).toBe('https://x.com/b.png');
        expect(node.candidateImages.map(item => item.url)).toEqual(['https://x.com/a.png', 'https://x.com/c.png']);
        expect(node.candidateIndex).toBe(1);
        expect(node.images[0].url).toBe('https://x.com/c.png');
    });

    it('删除最后候选时清掉主图但保留遮罩输入', () => {
        const { removeCandidateFromNode } = createCandidatePoolSandbox();
        const mask = { url: 'https://x.com/a_mask.png', role: 'mask' };
        const node = {
            type: 'smart-image',
            candidateImages: [{ url: 'https://x.com/a.png' }],
            images: [{ url: 'https://x.com/a.png', generatedResult: true }, mask],
            candidateIndex: 0,
        };

        removeCandidateFromNode(node, 0);
        expect(node.candidateImages).toEqual([]);
        expect(node.images).toEqual([mask]);
        expect(node.candidateIndex).toBe(0);
    });
});
