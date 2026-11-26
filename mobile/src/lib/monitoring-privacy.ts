import type { ErrorEvent, Exception, StackFrame } from '@sentry/react-native';

const BUNDLE_FILES = new Set(['app:///index.android.bundle', 'app:///main.jsbundle']);
const EXCEPTION_TYPES = new Set([
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'TRPCClientError',
]);
const DEBUG_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function isBundleFile(filename: unknown): filename is string {
  return typeof filename === 'string' && BUNDLE_FILES.has(filename);
}

function cleanFrame(frame: StackFrame): StackFrame[] {
  if (!isBundleFile(frame.filename))
    return [];
  return [{ filename: frame.filename, lineno: frame.lineno, colno: frame.colno }];
}

function cleanException(exception: Exception): Exception {
  const frames = exception.stacktrace?.frames?.flatMap(cleanFrame);
  const handled = exception.mechanism?.handled;
  return {
    type: exception.type && EXCEPTION_TYPES.has(exception.type) ? exception.type : 'Error',
    ...(typeof handled === 'boolean' && { mechanism: { type: 'generic', handled } }),
    ...(frames?.length && { stacktrace: { frames } }),
  };
}

export function cleanErrorEvent(event: ErrorEvent, build: { environment: string; release: string }): ErrorEvent | null {
  const exceptions = event.exception?.values?.map(cleanException);
  if (!exceptions?.length)
    return null;

  const images = event.debug_meta?.images?.flatMap((image) => {
    if (image.type !== 'sourcemap' || !isBundleFile(image.code_file) || !DEBUG_ID.test(image.debug_id))
      return [];
    return [{ type: image.type, code_file: image.code_file, debug_id: image.debug_id }];
  });

  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    ...build,
    platform: 'javascript',
    ...(event.level === 'fatal' && { level: event.level }),
    exception: { values: exceptions },
    ...(images?.length && { debug_meta: { images } }),
  };
}
