import { CalledWithMock } from './Mock';
import { Matcher, MatchersOrLiterals } from './Matchers';
import { Mock, mock } from 'bun:test';

interface CalledWithStackItem<T, Y extends any[]> {
    args: MatchersOrLiterals<Y>;
    calledWithFn: any;
}

interface BunAsymmetricMatcher {
    asymmetricMatch(...args: any[]): boolean;
}
function isBunAsymmetricMatcher(obj: any): obj is BunAsymmetricMatcher {
    return !!obj && typeof obj === 'object' && 'asymmetricMatch' in obj && typeof obj.asymmetricMatch === 'function';
}

const checkCalledWith = <T, Y extends any[]>(
    calledWithStack: CalledWithStackItem<T, Y>[],
    actualArgs: Y,
    fallbackMockImplementation?: (...args: Y) => T
): T => {
    const calledWithInstance = calledWithStack.find((instance) =>
        instance.args.every((matcher, i) => {
            if (matcher instanceof Matcher) {
                return matcher.asymmetricMatch(actualArgs[i]);
            }

            if (isBunAsymmetricMatcher(matcher)) {
                return matcher.asymmetricMatch(actualArgs[i]);
            }

            return actualArgs[i] === matcher;
        })
    );

    // @ts-ignore cannot return undefined, but this will fail the test if there is an expectation which is what we want
    return calledWithInstance
        ? calledWithInstance.calledWithFn(...actualArgs)
        : fallbackMockImplementation && fallbackMockImplementation(...actualArgs);
};

export const calledWithFn = <T, Y extends any[]>({
    fallbackMockImplementation,
}: { fallbackMockImplementation?: (...args: Y) => T } = {}): CalledWithMock<T, Y> => {
    const fn = mock(fallbackMockImplementation) as any;
    let calledWithStack: CalledWithStackItem<T, Y>[] = [];

    fn.calledWith = (...args: any) => {
        const calledWithFn = mock(fallbackMockImplementation);
        const mockImplementation = fn.getMockImplementation();
        if (!mockImplementation || mockImplementation === fallbackMockImplementation) {
            // Our original function gets a mock implementation which handles the matching
            fn.mockImplementation((...args: Y) => checkCalledWith(calledWithStack, args, fallbackMockImplementation));
            calledWithStack = [];
        }
        calledWithStack.unshift({ args, calledWithFn });

        return calledWithFn;
    };

    return fn as any;
};

export default calledWithFn;
