import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.resolve(__dirname, '../src/canvas/agent/agent-event-projector.js'),
    'utf8',
);

function createProjector({ fetch = () => ({ catch: () => {} }), warn = () => {} } = {}) {
    const context = {
        window: {},
        console: { warn },
        fetch,
        Set,
        Array,
        Boolean,
        Number,
        Object,
        String,
        JSON,
    };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'agent-event-projector.js' });
    return context.window.CanvasAgentEventProjector;
}

describe('CanvasAgentEventProjector', () => {
    it('projects declared progress by presentation, not by event type', () => {
        const projector = createProjector();
        const projection = projector.project({
            type: 'skill.loaded',
            payload: {
                message: '已读取分镜技能',
                skill: { name: 'shot-list' },
                presentation: {
                    targets: ['conversation_progress', 'skill_badge'],
                    group_id: 'tool:call-1',
                    state: 'succeeded',
                },
            },
        });

        expect(projection.progress).toMatchObject({ groupId: 'tool:call-1', state: 'succeeded' });
        expect(projection.skillBadge).toEqual({ name: 'shot-list', version: '' });
    });

    it('keeps legacy Skill metadata as a tag without recreating progress', () => {
        const projector = createProjector();
        const projection = projector.project({
            type: 'skill.resource_loaded',
            payload: { skill: { name: 'shot-list', version: '1' } },
        });

        expect(projection.progress).toBeNull();
        expect(projection.skillBadge).toEqual({ name: 'shot-list', version: '1' });
        expect(projector.isConversationEvent({ type: 'skill.resource_loaded', payload: {} })).toBe(false);
    });

    it('keeps concurrent tool calls in independent progress groups', () => {
        const projector = createProjector();
        const started = projector.project({
            type: 'progress.tool_started',
            payload: {
                message: '正在读取 A',
                presentation: { targets: ['conversation_progress'], group_id: 'tool:call-a', state: 'started' },
            },
        });
        const completed = projector.project({
            type: 'progress.tool_completed',
            payload: {
                message: '已完成 B',
                presentation: { targets: ['conversation_progress'], group_id: 'tool:call-b', state: 'succeeded', history: true },
            },
        });

        expect(started.progress).toMatchObject({ groupId: 'tool:call-a', state: 'started', history: false });
        expect(completed.progress).toMatchObject({ groupId: 'tool:call-b', state: 'succeeded', history: true });
        expect(started.progress.groupId).not.toBe(completed.progress.groupId);
    });

    it('projects identical progress for realtime and historical envelopes', () => {
        const projector = createProjector();
        const event = {
            type: 'agent.skill.rejected',
            severity: 'warning',
            payload_json: {
                message: '读取技能被拒绝',
                presentation: { targets: ['conversation_progress'], group_id: 'tool:call-1', state: 'rejected', history: true },
            },
        };

        const realtime = projector.project({ ...event, payload: event.payload_json });
        const historical = projector.project(event);
        expect(realtime.progress).toEqual(historical.progress);
        expect(historical.progress).toMatchObject({ state: 'rejected', severity: 'warning', history: true });
    });

    it('uses canvas refresh declarations or a version without task-type inference', () => {
        const projector = createProjector();
        expect(projector.project({
            type: 'task.queued',
            payload: { presentation: { targets: ['canvas_refresh'] }, canvas_version: 7 },
        }).refreshCanvas).toEqual({ version: 7 });
        expect(projector.project({
            type: 'unrecognized.event',
            payload: { canvas_version: 8 },
        }).refreshCanvas).toEqual({ version: 8 });
        expect(projector.project({ type: 'task.succeeded', payload: {} }).refreshCanvas).toBeNull();
    });

    it('degrades unknown targets and reports each target once', () => {
        const reports = [];
        const warnings = [];
        const projector = createProjector({
            fetch: (url, options) => {
                reports.push({ url, body: JSON.parse(options.body) });
                return { catch: () => {} };
            },
            warn: (...args) => warnings.push(args),
        });
        const event = {
            type: 'future.event',
            payload: { message: 'ignored', presentation: { targets: ['future_surface'] } },
        };

        expect(projector.project(event).progress).toBeNull();
        projector.project(event);
        expect(reports).toEqual([{
            url: '/api/canvas-agent/presentation-diagnostics',
            body: { target: 'future_surface' },
        }]);
        expect(warnings).toHaveLength(1);
    });
});
