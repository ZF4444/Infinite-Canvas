import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { createRhWorkflowEditorSandbox } from './rh-workflow-editor-sandbox.js';

function run(ctx, expr) {
    return vm.runInContext(expr, ctx);
}

describe('parseRunningHubRunRef', () => {
    it('识别 /run/ai-app/xxx 路径', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "parseRunningHubRunRef('https://www.runninghub.cn/run/ai-app/abc123')");
        expect(result).toEqual({ type: 'app', id: 'abc123' });
    });

    it('识别纯数字 id（8位以上）', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "parseRunningHubRunRef('123456789')");
        expect(result).toEqual({ type: 'app', id: '123456789' });
    });

    it('无法识别时返回 null', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "parseRunningHubRunRef('not-a-valid-ref')")).toBeNull();
        expect(run(ctx, "parseRunningHubRunRef('')")).toBeNull();
    });
});

describe('rhWorkflowFieldKey / rhWorkflowGroupKey', () => {
    it('用 nodeId::fieldName 组合成唯一 key', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhWorkflowFieldKey({nodeId:'node1', fieldName:'prompt'})");
        expect(result).toBe('node1::prompt');
    });

    it('缺省字段时用空字符串兜底', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, 'rhWorkflowFieldKey({})')).toBe('::');
    });

    it('rhWorkflowGroupKey 用 nodeId::group 组合', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhWorkflowGroupKey({nodeId:'node1', group:'basic'})");
        expect(result).toBe('node1::basic');
    });
});

describe('rhWorkflowFieldKind', () => {
    it('识别显式 fieldType', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "rhWorkflowFieldKind({fieldType:'IMAGE'})")).toBe('IMAGE');
        expect(run(ctx, "rhWorkflowFieldKind({fieldType:'boolean'})")).toBe('BOOLEAN');
    });

    it('FLOAT/INT/INTEGER 归一化为 NUMBER', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "rhWorkflowFieldKind({fieldType:'FLOAT'})")).toBe('NUMBER');
        expect(run(ctx, "rhWorkflowFieldKind({fieldType:'INT'})")).toBe('NUMBER');
    });

    it('没有 fieldType 时按字段名/值关键字猜测类型', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "rhWorkflowFieldKind({fieldName:'input_image', fieldValue:''})")).toBe('IMAGE');
        expect(run(ctx, "rhWorkflowFieldKind({fieldName:'bgm', fieldValue:'test.mp3'})")).toBe('AUDIO');
        expect(run(ctx, "rhWorkflowFieldKind({fieldName:'seed', fieldValue:'12345'})")).toBe('NUMBER');
        expect(run(ctx, "rhWorkflowFieldKind({fieldName:'prompt', fieldValue:'hello'})")).toBe('TEXT');
    });
});

describe('rhWorkflowFieldTypeLabel', () => {
    it('映射已知类型到中文标签', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "rhWorkflowFieldTypeLabel('IMAGE')")).toBe('图片');
        expect(run(ctx, "rhWorkflowFieldTypeLabel('number')")).toBe('数字');
    });

    it('未知类型原样返回', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "rhWorkflowFieldTypeLabel('WEIRD')")).toBe('WEIRD');
    });
});

describe('rhKnownOptionsForField', () => {
    it('已知字段名（如 sampler_name）返回预设选项列表', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhKnownOptionsForField({fieldName:'sampler_name'})");
        expect(result).toContain('euler');
        expect(result).toContain('ddim');
    });

    it('大小写不敏感匹配', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhKnownOptionsForField({fieldName:'Scheduler'})");
        expect(result).toContain('karras');
    });

    it('未知字段名返回空数组', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "rhKnownOptionsForField({fieldName:'unknown_field'})")).toEqual([]);
    });
});

describe('normalizeRhWorkflowField', () => {
    it('有选项时归一化 fieldType 为 SELECT（非媒体/滑块类型）', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "JSON.stringify(normalizeRhWorkflowField({fieldName:'sampler_name', fieldType:'TEXT'}))");
        expect(JSON.parse(result).fieldType).toBe('SELECT');
    });

    it('IMAGE/VIDEO/AUDIO/SLIDER 类型即使有选项也保持原类型', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "JSON.stringify(normalizeRhWorkflowField({fieldName:'photo', fieldType:'IMAGE', options:['a','b']}))");
        expect(JSON.parse(result).fieldType).toBe('IMAGE');
    });

    it('sourceFromUpstream 未指定时默认为 false', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "JSON.stringify(normalizeRhWorkflowField({fieldName:'x'}))");
        expect(JSON.parse(result).sourceFromUpstream).toBe(false);
    });

    it('sourceFromUpstream 显式为 false 时保留 false，其余视为 true', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const a = JSON.parse(run(ctx, "JSON.stringify(normalizeRhWorkflowField({fieldName:'x', sourceFromUpstream:false}))"));
        const b = JSON.parse(run(ctx, "JSON.stringify(normalizeRhWorkflowField({fieldName:'x', sourceFromUpstream:true}))"));
        expect(a.sourceFromUpstream).toBe(false);
        expect(b.sourceFromUpstream).toBe(true);
    });
});

describe('updateRhWorkflowEditorMeta', () => {
    it('编辑名称时通知嵌入式工作流配置页', () => {
        const messages = [];
        const parent = { postMessage: (message, origin) => messages.push({ message, origin }) };
        const ctx = createRhWorkflowEditorSandbox({
            window: { parent },
            rhWorkflowEditorState: { config: { title: '旧名称', description: '', fields: [] } },
        });

        run(ctx, "updateRhWorkflowEditorMeta('title', '新名称')");

        expect(messages).toEqual([{
            message: { type: 'workflow-title', title: '新名称' },
            origin: 'http://test.local',
        }]);
    });
});

describe('RH 参数 JSON 导入导出', () => {
    it('导出完整的应用配置', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = JSON.parse(run(ctx, `JSON.stringify(rhWorkflowParameterExportPayload({appId:'app-1', title:'测试', description:'应用备注', fields:[{nodeId:'n1', fieldName:'prompt', fieldValue:'cat'}]}))`));
        expect(result.format).toBe('mediaforge-rh-parameters');
        expect(result.appId).toBe('app-1');
        expect(result.title).toBe('测试');
        expect(result.description).toBe('应用备注');
        expect(result.fields[0].fieldName).toBe('prompt');
    });

    it('兼容导出对象和直接 fields 数组', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "parseRhWorkflowParameterImport('{\"fields\":[{\"fieldName\":\"seed\"}]}').fields.length")).toBe(1);
        expect(run(ctx, "parseRhWorkflowParameterImport('[{\"fieldName\":\"prompt\"}]').fields.length")).toBe(1);
    });

    it('导入标准导出文件时恢复名称和备注', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = JSON.parse(run(ctx, "JSON.stringify(parseRhWorkflowParameterImport('{\"title\":\"导入名称\",\"description\":\"导入备注\",\"fields\":[{\"fieldName\":\"prompt\"}]}'))"));
        expect(result.title).toBe('导入名称');
        expect(result.description).toBe('导入备注');
        expect(result.fields).toHaveLength(1);
    });

    it('拒绝缺少 fields 或 fieldName 的 JSON', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(() => run(ctx, "parseRhWorkflowParameterImport('{}')")).toThrow('fields');
        expect(() => run(ctx, "parseRhWorkflowParameterImport('{\"fields\":[{}]}')")).toThrow('fieldName');
    });
});

describe('rhEditorSortedFields', () => {
    it('IMAGE 类型字段排在前面，按 imageOrder 排序', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, `JSON.stringify(rhEditorSortedFields([
            {nodeId:'a', fieldName:'text1', fieldType:'TEXT'},
            {nodeId:'b', fieldName:'img2', fieldType:'IMAGE', imageOrder:2},
            {nodeId:'c', fieldName:'img1', fieldType:'IMAGE', imageOrder:1}
        ]))`);
        const parsed = JSON.parse(result);
        expect(parsed.map(f => f.fieldName)).toEqual(['img1', 'img2', 'text1']);
    });
});

describe('renderRhMappedPreviewHtml', () => {
    it('能渲染包含图片字段的预览统计', () => {
        const ctx = createRhWorkflowEditorSandbox({
            rhWorkflowEditorState: {previewStatus:'', previewOutputs:[], previewRunning:false, previewParams:{}}
        });
        const html = run(ctx, "renderRhMappedPreviewHtml({title:'测试应用', appId:'12345678', fields:[{nodeId:'1', fieldName:'image', fieldType:'IMAGE', enabled:true}]})");
        expect(html).toContain('图片 1');
    });
});

describe('mediaAcceptForRhKind', () => {
    it('按媒体类型返回对应的 accept 字符串', () => {
        const ctx = createRhWorkflowEditorSandbox();
        expect(run(ctx, "mediaAcceptForRhKind('VIDEO')")).toBe('video/*');
        expect(run(ctx, "mediaAcceptForRhKind('AUDIO')")).toBe('audio/*');
        expect(run(ctx, "mediaAcceptForRhKind('IMAGE')")).toBe('image/*');
        expect(run(ctx, "mediaAcceptForRhKind('UNKNOWN')")).toBe('image/*');
    });
});

describe('rhPreviewRandomValue', () => {
    it('整数字段（step 未指定）返回整数', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhPreviewRandomValue({min:0, max:10})");
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(10);
    });

    it('看起来像 seed 的字段，未指定范围时使用较大的默认上限', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhPreviewRandomValue({fieldName:'seed'})");
        expect(result).toBeGreaterThanOrEqual(1);
    });

    it('浮点 step 字段返回浮点数且遵循精度', () => {
        const ctx = createRhWorkflowEditorSandbox();
        const result = run(ctx, "rhPreviewRandomValue({min:0, max:1, step:0.01})");
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
    });
});
