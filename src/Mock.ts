import calledWithFn from './CalledWithFn';
import { MatchersOrLiterals } from './Matchers';
import { DeepPartial } from 'ts-essentials';
import { Mock } from "bun:test";

type ProxiedProperty = string | number | symbol;

export interface GlobalConfig {
    // ignoreProps is required when we don't want to return anything for a mock (for example, when mocking a promise).
    ignoreProps?: ProxiedProperty[];
}

const DEFAULT_CONFIG: GlobalConfig = {
    ignoreProps: ['then'],
};

let GLOBAL_CONFIG = DEFAULT_CONFIG;

export const BunMockExtended = {
    DEFAULT_CONFIG,
    configure: (config: GlobalConfig) => {
        // Shallow merge so they can override anything they want.
        GLOBAL_CONFIG = { ...DEFAULT_CONFIG, ...config };
    },
    resetConfig: () => {
        GLOBAL_CONFIG = DEFAULT_CONFIG;
    },
};

export interface CalledWithMock<T, Y extends any[]> extends Mock<(...args: Y) => T> {
    calledWith: (...args: Y | MatchersOrLiterals<Y>) => Mock<(...args: Y) => T>;
}

export type _MockProxy<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer B ? T[K] & CalledWithMock<B, A> : T[K];
};

export type MockProxy<T> = _MockProxy<T> & T;

export type _DeepMockProxy<T> = {
    // This supports deep mocks in the else branch
    [K in keyof T]: T[K] extends (...args: infer A) => infer B ? T[K] & CalledWithMock<B, A> : T[K] & _DeepMockProxy<T[K]>;
};

// we intersect with T here instead of on the mapped type above to
// prevent immediate type resolution on a recursive type, this will
// help to improve performance for deeply nested recursive mocking
// at the same time, this intersection preserves private properties
export type DeepMockProxy<T> = _DeepMockProxy<T> & T;

export type _DeepMockProxyWithFuncPropSupport<T> = {
    // This supports deep mocks in the else branch
    [K in keyof T]: T[K] extends (...args: infer A) => infer B ? CalledWithMock<B, A> & DeepMockProxy<T[K]> : DeepMockProxy<T[K]>;
};

export type DeepMockProxyWithFuncPropSupport<T> = _DeepMockProxyWithFuncPropSupport<T> & T;

export interface MockOpts {
    deep?: boolean;
    fallbackMockImplementation?: (...args: any[]) => any;
}

export const mockClear = (mock: MockProxy<any>) => {
    for (let key of Object.keys(mock)) {
        if (mock[key] === null || mock[key] === undefined) {
            continue;
        }

        if (mock[key]._isMockObject) {
            mockClear(mock[key]);
        }

        if (mock[key]._isMockFunction) {
            mock[key].mockClear();
        }
    }

    if (!mock._isMockObject) {
        return mock.mockClear();
    }
};

export const mockReset = (mock: MockProxy<any>) => {
    for (let key of Object.keys(mock)) {
        if (mock[key] === null || mock[key] === undefined) {
            continue;
        }

        if (mock[key]._isMockObject) {
            mockReset(mock[key]);
        }
        if (mock[key]._isMockFunction) {
            mock[key].mockReset();
        }
    }

    if (!mock._isMockObject) {
        return mock.mockReset();
    }
};

export function mockDeep<T>(
    opts: { funcPropSupport?: true; fallbackMockImplementation?: MockOpts['fallbackMockImplementation'] },
    mockImplementation?: DeepPartial<T>
): DeepMockProxyWithFuncPropSupport<T>;
export function mockDeep<T>(mockImplementation?: DeepPartial<T>): DeepMockProxy<T>;
export function mockDeep(arg1: any, arg2?: any) {
    const [opts, mockImplementation] =
        typeof arg1 === 'object' && (typeof arg1.fallbackMockImplementation === 'function' || arg1.funcPropSupport === true)
            ? [arg1, arg2]
            : [{}, arg1];
    return mock(mockImplementation, { deep: true, fallbackMockImplementation: opts.fallbackMockImplementation });
}

const overrideMockImp = (obj: DeepPartial<any>, opts?: MockOpts) => {
    const proxy = new Proxy<MockProxy<any>>(obj, handler(opts));
    for (let name of Object.keys(obj)) {
        if (typeof obj[name] === 'object' && obj[name] !== null) {
            proxy[name] = overrideMockImp(obj[name], opts);
        } else {
            proxy[name] = obj[name];
        }
    }

    return proxy;
};

const handler = (opts?: MockOpts) => ({
    ownKeys(target: MockProxy<any>) {
        return Reflect.ownKeys(target);
    },

    set: (obj: MockProxy<any>, property: ProxiedProperty, value: any) => {
        // @ts-ignore All of these ignores are due to https://github.com/microsoft/TypeScript/issues/1863
        obj[property] = value;
        return true;
    },

    get: (obj: MockProxy<any>, property: ProxiedProperty) => {
        let fn = calledWithFn({ fallbackMockImplementation: opts?.fallbackMockImplementation });

        // @ts-ignore
        if (!(property in obj)) {
            if (GLOBAL_CONFIG.ignoreProps?.includes(property)) {
                return undefined;
            }
            if (property === Symbol.iterator) {
                // @ts-ignore
                return obj[property];
            }
            if (opts?.deep && property !== 'calls') {
                // @ts-ignore
                obj[property] = new Proxy<MockProxy<any>>(fn, handler(opts));
                // @ts-ignore
                obj[property]._isMockObject = true;
            } else {
                // @ts-ignore
                obj[property] = calledWithFn({ fallbackMockImplementation: opts?.fallbackMockImplementation });
            }
        }

        // @ts-ignore
        if (obj instanceof Date && typeof obj[property] === 'function') {
            // @ts-ignore
            return obj[property].bind(obj);
        }

        // @ts-ignore
        return obj[property];
    },
});

const mock = <T, MockedReturn extends MockProxy<T> & T = MockProxy<T> & T>(
    mockImplementation: DeepPartial<T> = {} as DeepPartial<T>,
    opts?: MockOpts
): MockedReturn => {
    // @ts-ignore private
    mockImplementation!._isMockObject = true;
    return overrideMockImp(mockImplementation, opts);
};

export const mockFn = <
    T extends Function,
    A extends any[] = T extends (...args: infer AReal) => any ? AReal : any[],
    R = T extends (...args: any) => infer RReal ? RReal : any
>(): CalledWithMock<R, A> & T => {
    // @ts-ignore
    return calledWithFn();
};

export const stub = <T extends object>(): T => {
    return new Proxy<T>({} as T, {
        get: (obj, property: ProxiedProperty) => {
            if (property in obj) {
                // @ts-ignore
                return obj[property];
            }
            return mock();
        },
    });
};

export default mock;
