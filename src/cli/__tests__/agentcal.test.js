import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    parseArgs,
    readConfig,
    writeConfig,
    normalizeServer,
    toIsoTimestamp,
    normalizeEventType,
    parseIncomingPayload,
    parseMessage,
} from '../../../cli/kronos.js';

describe('parseArgs', () => {
    it('should parse simple arguments', () => {
        const args = ['command', '--token', 'abc', '--server', 'http://example.com'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['command'],
            token: 'abc',
            server: 'http://example.com',
        });
    });

    it('should handle boolean flags', () => {
        const args = ['command', '--verbose', '--alias', 'my-alias'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['command'],
            verbose: true,
            alias: 'my-alias',
        });
    });

    it('should handle flags with inline values', () => {
        const args = ['command', '--token=xyz', '--server=http://localhost'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['command'],
            token: 'xyz',
            server: 'http://localhost',
        });
    });

    it('should handle mixed positional and flag arguments', () => {
        const args = ['login', 'my-token', 'http://new-server.com', '--verbose'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['login', 'my-token', 'http://new-server.com'],
            verbose: true,
        });
    });

    it('should return empty object for no arguments', () => {
        const args = [];
        const result = parseArgs(args);
        expect(result).toEqual({ _: [] });
    });

    it('should handle arguments with spaces in values', () => {
        const args = ['proxy', '--agent', 'my agent with spaces'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['proxy'],
            agent: 'my agent with spaces',
        });
    });

    it('should handle arguments with spaces in inline values', () => {
        const args = ['proxy', '--agent="my agent with spaces"'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['proxy'],
            agent: '"my agent with spaces"', // The quotes are part of the value if provided inline like this
        });
    });

    it('should handle multiple positional arguments', () => {
        const args = ['cmd', 'arg1', 'arg2'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['cmd', 'arg1', 'arg2'],
        });
    });

    it('should handle flags appearing before positional arguments', () => {
        const args = ['--flag', 'value', 'positional'];
        const result = parseArgs(args);
        expect(result).toEqual({
            _: ['positional'],
            flag: 'value',
        });
    });
});

const MOCK_CONFIG_DIR = '/home/testuser/.kronos';
const MOCK_CONFIG_FILE = `${MOCK_CONFIG_DIR}/config.json`;

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

vi.mock('node:os', () => ({
    homedir: vi.fn(),
}));

vi.mock('node:path', () => ({
    join: vi.fn(),
    resolve: vi.fn(),
}));


describe('config functions', () => {
    beforeEach(() => {
        vi.clearAllMocks(); // Clear call history, but maintain mock implementation

        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockReturnValue('');
        fs.writeFileSync.mockReturnValue(undefined);
        fs.mkdirSync.mockReturnValue(undefined);

        os.homedir.mockReturnValue('/home/testuser');
        path.join.mockImplementation((...args) => args.join('/'));
        path.resolve.mockImplementation((...args) => args.join('/'));
    });

    describe('readConfig', () => {
        it('should return empty object if config file does not exist', () => {
            fs.existsSync.mockReturnValue(false);
            expect(readConfig()).toEqual({});
        });

        it('should return empty object if config file is invalid JSON', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('invalid json');
            expect(readConfig()).toEqual({});
        });

        it('should read and parse existing config file', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify({ token: 'test', server: 'http://test.com' }));
            expect(readConfig()).toEqual({ token: 'test', server: 'http://test.com' });
        });
    });

    describe('writeConfig', () => {
        it('should create directory and write config to file', () => {
            const config = { token: 'new', server: 'http://new.com' };
            writeConfig(config);

            expect(fs.mkdirSync).toHaveBeenCalledWith('/home/testuser/.kronos', { recursive: true });
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                '/home/testuser/.kronos/config.json',
                `${JSON.stringify(config, null, 2)}\n`,
                'utf8'
            );
        });
    });
});

describe('normalizeServer', () => {
    it('should return default server if input is null or empty', () => {
        expect(normalizeServer(null)).toBe('http://localhost:3737');
        expect(normalizeServer('')).toBe('http://localhost:3737');
        expect(normalizeServer(undefined)).toBe('http://localhost:3737');
    });

    it('should trim whitespace and remove trailing slashes', () => {
        expect(normalizeServer('  http://example.com/  ')).toBe('http://example.com');
        expect(normalizeServer('http://example.com///')).toBe('http://example.com');
    });

    it('should return the server as is if already normalized', () => {
        expect(normalizeServer('http://example.com')).toBe('http://example.com');
    });
});

describe('toIsoTimestamp', () => {
    beforeEach(() => {
        vi.useFakeTimers(); // Use fake timers to control Date
    });

    afterEach(() => {
        vi.useRealTimers(); // Restore real timers
    });

    it('should return current ISO timestamp if value is null or empty', () => {
        // Create date in UTC
        vi.setSystemTime(new Date(Date.UTC(2026, 1, 28, 10, 0, 0))); // Feb 28, 2026 10:00:00 UTC
        expect(toIsoTimestamp(null)).toBe('2026-02-28T10:00:00.000Z');
        expect(toIsoTimestamp('')).toBe('2026-02-28T10:00:00.000Z');
        expect(toIsoTimestamp(undefined)).toBe('2026-02-28T10:00:00.000Z');
    });

    it('should return ISO timestamp for valid date string', () => {
        expect(toIsoTimestamp('2025-01-15T12:30:00.000Z')).toBe('2025-01-15T12:30:00.000Z');
        // Test with local date string, still expecting UTC output
        vi.setSystemTime(new Date(Date.UTC(2024, 2, 1, 0, 0, 0))); // March 1, 2024 00:00:00 UTC
        expect(toIsoTimestamp('2024-03-01')).toBe('2024-03-01T00:00:00.000Z');
    });

    it('should return current ISO timestamp for invalid date string', () => {
        vi.setSystemTime(new Date(Date.UTC(2026, 1, 28, 10, 0, 0))); // Feb 28, 2026 10:00:00 UTC
        expect(toIsoTimestamp('invalid date')).toBe('2026-02-28T10:00:00.000Z');
    });
});

describe('normalizeEventType', () => {
    it('should normalize known event types', () => {
        expect(normalizeEventType('session/new')).toBe('session/new');
        expect(normalizeEventType('session.new')).toBe('session/new');
        expect(normalizeEventType('new')).toBe('session/new');

        expect(normalizeEventType('session/pause')).toBe('session/pause');
        expect(normalizeEventType('session.pause')).toBe('session/pause');
        expect(normalizeEventType('pause')).toBe('session/pause');
        expect(normalizeEventType('permission')).toBe('session/pause');
        expect(normalizeEventType('permission-request')).toBe('session/pause');

        expect(normalizeEventType('session/resume')).toBe('session/resume');
        expect(normalizeEventType('session.resume')).toBe('session/resume');
        expect(normalizeEventType('resume')).toBe('session/resume');

        expect(normalizeEventType('session/end')).toBe('session/end');
        expect(normalizeEventType('session.end')).toBe('session/end');
        expect(normalizeEventType('end')).toBe('session/end');
        expect(normalizeEventType('complete')).toBe('session/end');
        expect(normalizeEventType('completed')).toBe('session/end');
        expect(normalizeEventType('done')).toBe('session/end');

        expect(normalizeEventType('session/prompt')).toBe('session/prompt');
        expect(normalizeEventType('session.prompt')).toBe('session/prompt');
        expect(normalizeEventType('prompt')).toBe('session/prompt');
    });

    it('should return null for unknown event types', () => {
        expect(normalizeEventType('unknown')).toBeNull();
        expect(normalizeEventType('  foo  ')).toBeNull();
        expect(normalizeEventType(null)).toBeNull();
        expect(normalizeEventType(undefined)).toBeNull();
        expect(normalizeEventType('')).toBeNull();
    });

    it('should be case-insensitive', () => {
        expect(normalizeEventType('Session/New')).toBe('session/new');
        expect(normalizeEventType('SESSION.END')).toBe('session/end');
    });
});

describe('parseIncomingPayload', () => {
    beforeEach(() => {
        vi.clearAllMocks(); // Clear all mocks
        // Explicitly mock toIsoTimestamp and normalizeEventType for this suite
        // These are imported directly from the module being tested, so their *mocked* version needs to be set.
        // This relies on the fact that vi.mock('../../../cli/kronos') above has already created mocks for them.
        vi.mocked(toIsoTimestamp).mockImplementation((val) => val || 'mock-timestamp');
        vi.mocked(normalizeEventType).mockImplementation((type) => {
            if (['new', 'pause', 'resume', 'end', 'prompt'].includes(type.toLowerCase())) {
                return `session/${type.toLowerCase()}`;
            }
            return null;
        });
    });

    it('should return null for payloads without a recognizable event type', () => {
        expect(parseIncomingPayload({})).toBeNull();
        expect(parseIncomingPayload({ method: 'unknown' })).toBeNull();
    });

    it('should parse a simple session/new event', () => {
        const payload = {
            method: 'new',
            sessionId: 'test-session-123',
            status: 'running',
            timestamp: '2026-02-28T10:30:00.000Z',
        };
        const result = parseIncomingPayload(payload);
        expect(result).toEqual({
            eventType: 'session/new',
            sessionId: 'test-session-123',
            status: 'running',
            failureReason: null,
            timestamp: '2026-02-28T10:30:00.000Z',
        });
    });

    it('should derive eventType from eventType, type, or event fields', () => {
        expect(parseIncomingPayload({ eventType: 'new', sessionId: '1' })).toEqual(expect.objectContaining({ eventType: 'session/new' }));
        expect(parseIncomingPayload({ type: 'pause', sessionId: '1' })).toEqual(expect.objectContaining({ eventType: 'session/pause' }));
        expect(parseIncomingPayload({ event: 'end', sessionId: '1' })).toEqual(expect.objectContaining({ eventType: 'session/end' }));
    });

    it('should derive sessionId from sessionId, params.sessionId, params.id, or id fields', () => {
        expect(parseIncomingPayload({ method: 'new', sessionId: 'sid1' })).toEqual(expect.objectContaining({ sessionId: 'sid1' }));
        expect(parseIncomingPayload({ method: 'new', params: { sessionId: 'sid2' } })).toEqual(expect.objectContaining({ sessionId: 'sid2' }));
        expect(parseIncomingPayload({ method: 'new', params: { id: 'sid3' } })).toEqual(expect.objectContaining({ sessionId: 'sid3' }));
        expect(parseIncomingPayload({ method: 'new', id: 'sid4' })).toEqual(expect.objectContaining({ sessionId: 'sid4' }));
    });

    it('should derive status from status, result.status, or params.status fields', () => {
        expect(parseIncomingPayload({ method: 'end', status: 'completed' })).toEqual(expect.objectContaining({ status: 'completed' }));
        expect(parseIncomingPayload({ method: 'end', result: { status: 'failed' } })).toEqual(expect.objectContaining({ status: 'failed' }));
        expect(parseIncomingPayload({ method: 'end', params: { status: 'timed_out' } })).toEqual(expect.objectContaining({ status: 'timed_out' }));
    });

    it('should derive failureReason from failureReason, params.failureReason, or error.message fields', () => {
        expect(parseIncomingPayload({ method: 'end', failureReason: 'oops' })).toEqual(expect.objectContaining({ failureReason: 'oops' }));
        expect(parseIncomingPayload({ method: 'end', params: { failureReason: 'fail' } })).toEqual(expect.objectContaining({ failureReason: 'fail' }));
        expect(parseIncomingPayload({ method: 'end', error: { message: 'err' } })).toEqual(expect.objectContaining({ failureReason: 'err' }));
    });

    it('should use current timestamp if none provided', () => {
        vi.mocked(toIsoTimestamp).mockImplementationOnce(() => 'current-mock-timestamp');
        expect(parseIncomingPayload({ method: 'new', sessionId: '1' })).toEqual(expect.objectContaining({ timestamp: 'current-mock-timestamp' }));
    });

    it('should handle complex payload structures', () => {
        const payload = {
            event: 'end',
            id: 'complex-session',
            result: { status: 'completed' },
            params: { failureReason: 'intentional' },
            error: { message: 'top-level error' },
            timestamp: '2026-02-28T11:00:00.000Z',
        };
        const result = parseIncomingPayload(payload);
        expect(result).toEqual({
            eventType: 'session/end',
            sessionId: 'complex-session',
            status: 'completed',
            failureReason: 'intentional',
            timestamp: '2026-02-28T11:00:00.000Z',
        });
    });
});

describe('parseMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks(); // Clear all mocks
        // Explicitly mock parseIncomingPayload for this suite
        vi.mocked(parseIncomingPayload).mockImplementation((payload) => {
            if (payload.event === 'valid') {
                return { eventType: 'session/new', sessionId: payload.sessionId || 'mock-session-id' };
            }
            return null;
        });
    });

    it('should return empty array for null or undefined input', () => {
        expect(parseMessage(null)).toEqual([]);
        expect(parseMessage(undefined)).toEqual([]);
    });

    it('should return empty array for non-string/buffer input', () => {
        expect(parseMessage(123)).toEqual([]);
        expect(parseMessage({ a: 1 })).toEqual([]);
    });

    it('should return empty array for empty or whitespace string', () => {
        expect(parseMessage('')).toEqual([]);
        expect(parseMessage('   ')).toEqual([]);
    });

    it('should parse a single valid JSON line', () => {
        vi.mocked(parseIncomingPayload).mockReturnValueOnce({ eventType: 'session/new', sessionId: 'single' });
        const message = '{"event": "valid", "sessionId": "single"}';
        expect(parseMessage(message)).toEqual([{ eventType: 'session/new', sessionId: 'single' }]);
        expect(parseIncomingPayload).toHaveBeenCalledTimes(1);
    });

    it('should parse multiple valid JSON objects in an array', () => {
        vi.mocked(parseIncomingPayload)
            .mockReturnValueOnce({ eventType: 'session/new', sessionId: 'array1' })
            .mockReturnValueOnce({ eventType: 'session/end', sessionId: 'array2' });
        const message = '[{"event": "valid", "sessionId": "array1"}, {"event": "valid", "sessionId": "array2"}]';
        expect(parseMessage(message)).toEqual([
            { eventType: 'session/new', sessionId: 'array1' },
            { eventType: 'session/end', sessionId: 'array2' },
        ]);
        expect(parseIncomingPayload).toHaveBeenCalledTimes(2);
    });

    it('should ignore invalid JSON lines', () => {
        const message = '{"event": "valid"}invalid json'; // Malformed JSON
        expect(parseMessage(message)).toEqual([]);
        expect(parseIncomingPayload).not.toHaveBeenCalled();
    });

    it('should ignore JSON that does not produce a valid incoming payload', () => {
        const message = '{"event": "invalid"}';
        expect(parseMessage(message)).toEqual([]);
        expect(parseIncomingPayload).toHaveBeenCalledTimes(1); // parseIncomingPayload is called but returns null
        expect(parseIncomingPayload).toHaveBeenCalledWith({ event: 'invalid' });
    });

    it('should handle Buffer input', () => {
        vi.mocked(parseIncomingPayload).mockReturnValueOnce({ eventType: 'session/new', sessionId: 'buffer' });
        const message = Buffer.from('{"event": "valid", "sessionId": "buffer"}', 'utf8');
        expect(parseMessage(message)).toEqual([{ eventType: 'session/new', sessionId: 'buffer' }]);
        expect(parseIncomingPayload).toHaveBeenCalledTimes(1);
    });

    it('should handle ArrayBuffer input', () => {
        vi.mocked(parseIncomingPayload).mockReturnValueOnce({ eventType: 'session/new', sessionId: 'arraybuffer' });
        const rawString = '{"event": "valid", "sessionId": "arraybuffer"}';
        const buffer = Buffer.from(rawString, 'utf8');
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        expect(parseMessage(arrayBuffer)).toEqual([{ eventType: 'session/new', sessionId: 'arraybuffer' }]);
        expect(parseIncomingPayload).toHaveBeenCalledTimes(1);
    });
});

